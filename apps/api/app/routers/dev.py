from hmac import compare_digest

from fastapi import APIRouter, Request, Security
from fastapi.security import APIKeyHeader

from app.core.errors import documented_errors, error
from app.db.session import Db
from app.schemas.common import DemoAdvance, DemoClockView, DemoSeedView
from app.services.demo_seed import CLASSROOM_ID, LESSON_ID, TEACHER_ID, seed_demo
from app.services.mock_workflow import MockWorkflow

router = APIRouter(prefix="/dev", tags=["Démonstration"], responses=documented_errors(403, 404))
key_header = APIKeyHeader(name="X-Demo-Secret", scheme_name="DemoAdmin", auto_error=False)


def authorize_demo(request: Request, key: str | None = Security(key_header)):
    settings = request.app.state.settings
    if not settings.demo_mode:
        raise error(404)
    secret = settings.demo_admin_secret.get_secret_value() if settings.demo_admin_secret else ""
    if not secret or key is None or not compare_digest(secret.encode(), key.encode()):
        raise error(403)


@router.post("/seed", response_model=DemoSeedView, dependencies=[Security(authorize_demo)])
async def reset_demo(request: Request, db: Db):
    now = request.app.state.clock.reset()
    seed_demo(db, request.app.state.system_clock.now())
    db.commit()
    request.app.state.mock = MockWorkflow(now)
    return DemoSeedView(now=now, teacher_id=TEACHER_ID, lesson_id=LESSON_ID, classroom_id=CLASSROOM_ID)


@router.post("/clock/advance", response_model=DemoClockView, dependencies=[Security(authorize_demo)],
             responses=documented_errors(422))
async def advance(request: Request, data: DemoAdvance | None = None):
    days = data.days if data else 7
    return DemoClockView(now=request.app.state.clock.advance(days))


@router.post("/clock/reset", response_model=DemoClockView, dependencies=[Security(authorize_demo)])
async def reset_clock(request: Request):
    return DemoClockView(now=request.app.state.clock.reset())
