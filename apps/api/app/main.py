from contextlib import asynccontextmanager
from secrets import token_urlsafe

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.client import LLMGateway, OllamaClient
from app.core.auth import RateLimiter, password_hash
from app.core.clock import DemoClock, SystemClock
from app.core.config import Settings
from app.core.errors import configure_errors
from app.db.base import Base
from app.db.seed import import_bank, read_seed
from app.db.session import build_database
from app.routers import dev, identity, lessons, mock
from app.schemas.common import Health
from app.services.demo_seed import seed_demo
from app.services.mock_workflow import MockWorkflow


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine, sessions = build_database(settings.sqlite_url)
        try:
            seed = read_seed()
            Base.metadata.create_all(engine)
            app.state.sessions = sessions
            app.state.dummy_hash = password_hash.hash(token_urlsafe(32))
            app.state.rate_limiter = RateLimiter()
            app.state.system_clock = SystemClock()
            app.state.clock = DemoClock() if settings.demo_mode else app.state.system_clock
            with sessions.begin() as db:
                import_bank(db, seed)
                if settings.demo_mode:
                    seed_demo(db, app.state.system_clock.now())
                    app.state.mock = MockWorkflow(app.state.clock.now())
            with httpx.Client(
                base_url=settings.llm_base_url, trust_env=False,
                timeout=httpx.Timeout(settings.llm_timeout_s, connect=min(3, settings.llm_timeout_s)),
            ) as http:
                app.state.gateway = LLMGateway(OllamaClient(http, settings), settings, sessions)
                yield
        finally:
            engine.dispose()

    app = FastAPI(
        title="FAHM API", version="0.1.0", lifespan=lifespan,
        description="Phase 0. Identité, classes et séances sur SQLite. Les workflows F2–F5 "
                    "étiquetés « mock » utilisent exclusivement le scénario synthétique de démonstration.",
    )
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Demo-Secret"],
    )
    configure_errors(app)

    @app.get("/health", response_model=Health, tags=["Système"])
    def health():
        return Health()

    for router in (identity.router, lessons.router, mock.teacher_router, mock.student_router, dev.router):
        app.include_router(router, prefix="/api/v1")
    return app


app = create_app()
