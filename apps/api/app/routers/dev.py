from hmac import compare_digest

from fastapi import APIRouter, Request, Security
from fastapi.security import APIKeyHeader

from app.core.auth import Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.schemas.common import DemoAdvance, DemoClockView, DemoSeedView
from app.services.demo_seed import CLASSROOM_ID, LESSON_ID, TEACHER_ID, seed_demo
from app.services.access import start_write

router = APIRouter(tags=["Démonstration"], responses=documented_errors(403, 404))
key_header = APIKeyHeader(name="X-Demo-Secret", scheme_name="DemoAdmin", auto_error=False)


def authorize_demo(request: Request, key: str | None = Security(key_header)):
    settings = request.app.state.settings
    if not settings.demo_mode:
        raise error(404)
    secret = settings.demo_admin_secret.get_secret_value() if settings.demo_admin_secret else ""
    if not secret or key is None or not compare_digest(secret.encode(), key.encode()):
        raise error(403)


@router.post("/dev/seed", response_model=DemoSeedView, dependencies=[Security(authorize_demo)])
def load_demo(request: Request, db: Db):
    start_write(db)
    seed_demo(db, request.app.state.system_clock.now())
    db.commit()
    now = request.app.state.clock.now()
    return DemoSeedView(now=now, teacher_id=TEACHER_ID, lesson_id=LESSON_ID, classroom_id=CLASSROOM_ID)


@router.post("/dev/clock/advance", response_model=DemoClockView, dependencies=[Security(authorize_demo)],
             responses=documented_errors(422))
def advance(request: Request, data: DemoAdvance | None = None):
    days = data.days if data else 7
    return DemoClockView(now=request.app.state.clock.advance(days))


@router.post("/dev/clock/reset", response_model=DemoClockView, dependencies=[Security(authorize_demo)])
def reset_clock(request: Request):
    return DemoClockView(now=request.app.state.clock.reset())


@router.post("/demo/advance", response_model=DemoClockView, responses=documented_errors(401))
def simulate_next_week(request: Request, user: Teacher):
    if not request.app.state.settings.demo_mode or not user.is_synthetic or user.id != TEACHER_ID:
        raise error(404)
    return DemoClockView(now=request.app.state.clock.advance(7))
