from datetime import UTC, datetime, timedelta
from threading import Lock
from time import monotonic
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from app.core.errors import error
from app.db.session import Db
from app.models import User
from app.models.enums import Role
from app.schemas.common import Token

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False, scheme_name="BearerAuth")
ISSUER = "fahm-api"


class RateLimiter:
    def __init__(self):
        self._windows: dict[tuple[str, str], tuple[float, int]] = {}
        self._lock = Lock()
        self._cleanup_at = 0.0

    def check(self, request: Request, action: str, limit: int, subject: object | None = None) -> None:
        """Allow `limit` calls per minute per client address, or per `subject` (e.g. a user id).

        Authenticated model-backed routes pass the user id: behind the Next.js proxy, every browser shares
        the proxy's address.
        """
        now = monotonic()
        key = (action, str(subject) if subject is not None else
               request.client.host if request.client else "unknown")
        with self._lock:
            if now >= self._cleanup_at:
                self._windows = {
                    key: value for key, value in self._windows.items() if now < value[0]
                }
                self._cleanup_at = now + 60
            end, count = self._windows.get(key, (now + 60, 0))
            if now >= end:
                end, count = now + 60, 0
            if count >= limit:
                raise error(429)
            self._windows[key] = (end, count + 1)


def issue_token(user: User, request: Request) -> Token:
    settings = request.app.state.settings
    now = datetime.now(UTC)
    lifetime = timedelta(minutes=settings.jwt_expire_minutes)
    token = jwt.encode(
        {"sub": str(user.id), "iat": now, "exp": now + lifetime, "iss": ISSUER},
        settings.jwt_secret.get_secret_value(), algorithm="HS256",
    )
    return Token(access_token=token, expires_in=int(lifetime.total_seconds()))


def current_user(
    request: Request, db: Db,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_scheme)],
) -> User:
    if credentials is None:
        raise error(401)
    try:
        claims = jwt.decode(
            credentials.credentials, request.app.state.settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"], issuer=ISSUER, options={"require": ["sub", "exp", "iat", "iss"]},
        )
        user = db.get(User, UUID(claims["sub"]))
    except (jwt.InvalidTokenError, ValueError):
        raise error(401) from None
    if user is None or (user.is_synthetic and not request.app.state.settings.demo_mode):
        raise error(401)
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_teacher(user: CurrentUser) -> User:
    if user.role != Role.teacher:
        raise error(403)
    return user


def require_student(user: CurrentUser) -> User:
    if user.role != Role.student:
        raise error(403)
    return user


Teacher = Annotated[User, Depends(require_teacher)]
Student = Annotated[User, Depends(require_student)]
