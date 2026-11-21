from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.schemas.common import ErrorResponse

ERRORS = {
    401: ("UNAUTHENTICATED", "Authentification requise."),
    403: ("UNAUTHORIZED_RESOURCE", "Accès refusé à cette ressource."),
    404: ("RESOURCE_NOT_FOUND", "Ressource introuvable."),
    409: ("CONFLICT", "Action impossible dans l'état actuel."),
    422: ("INVALID_INPUT", "Les données envoyées sont invalides."),
    429: ("RATE_LIMITED", "Trop de tentatives. Réessayez plus tard."),
}


def error(status: int, code: str | None = None, message: str | None = None) -> HTTPException:
    default_code, default_message = ERRORS[status]
    headers = {}
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if status == 429:
        headers["Retry-After"] = "60"
    return HTTPException(
        status, detail={"code": code or default_code, "message": message or default_message},
        headers=headers,
    )


def documented_errors(*statuses: int) -> dict:
    return {
        status: {
            "model": ErrorResponse,
            "description": ERRORS[status][1],
            "content": {"application/json": {"example": {
                "error": {"code": ERRORS[status][0], "message": ERRORS[status][1]},
            }}},
        }
        for status in statuses
    }


def configure_errors(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            payload = exc.detail
        else:
            code, default = ERRORS.get(exc.status_code, ("HTTP_ERROR", HTTPStatus(exc.status_code).phrase))
            payload = {"code": code, "message": default}
        return JSONResponse({"error": payload}, exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Validation details can contain raw passwords or answer keys.
        code, message = ERRORS[422]
        return JSONResponse({"error": {"code": code, "message": message}}, 422)
