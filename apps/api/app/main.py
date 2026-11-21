from contextlib import asynccontextmanager
from secrets import token_urlsafe

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.client import LLMGateway, ModelConfigurationError
from app.ai.serving import model_clients, model_http
from app.core.auth import RateLimiter, password_hash
from app.core.clock import DemoClock, SystemClock
from app.core.config import Settings
from app.core.errors import configure_errors
from app.db.migrate import initialize_schema
from app.db.seed import import_bank, read_seed
from app.db.session import build_database
from app.documents.storage import ObjectStore
from app.routers import analytics, attempts, bank, course_assistant, dev, documents, identity, lessons, quizzes
from app.schemas.common import Health
from app.services.demo_seed import seed_demo
from app.services.teaching import backfill_teaching
from app.services.access import start_write


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine, sessions = build_database(settings.db_url)
        try:
            initialize_schema(engine)
            app.state.sessions = sessions
            app.state.object_store = ObjectStore(settings) if settings.document_s3_endpoint else None
            app.state.dummy_hash = password_hash.hash(token_urlsafe(32))
            app.state.rate_limiter = RateLimiter()
            app.state.system_clock = SystemClock()
            app.state.clock = DemoClock() if settings.demo_mode else app.state.system_clock
            with sessions.begin() as db:
                start_write(db)
                import_bank(db, read_seed())
                if settings.demo_mode:
                    seed_demo(db, app.state.system_clock.now())
                backfill_teaching(db)
            with model_http(settings) as http:
                client, app.state.document_models = model_clients(http, settings)
                app.state.gateway = LLMGateway(client, settings, sessions)
                try:
                    yield
                finally:
                    if close := getattr(client, "close", None):
                        close()
        finally:
            engine.dispose()

    app = FastAPI(
        title="FAHM API", version="1.0.0", lifespan=lifespan,
        description="Diagnostic, MindMirror, remédiation et assistant documentaire pédagogique.",
    )
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Demo-Secret"],
    )
    configure_errors(app)

    @app.exception_handler(ModelConfigurationError)
    async def model_configuration_error(request, exc):
        return JSONResponse({"error": {"code": "MODEL_CONFIGURATION_ERROR", "message": str(exc)}}, 503)

    @app.get("/health", response_model=Health, tags=["Système"])
    def health():
        return Health()

    for router in (identity, lessons, bank, quizzes, attempts, analytics, dev, documents, course_assistant):
        app.include_router(router.router, prefix="/api/v1")
    return app


app = create_app()
