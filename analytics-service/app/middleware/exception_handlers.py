import logging
import traceback
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("exceptions")


def register_exception_handlers(app: FastAPI) -> None:
    """
    Equivalente al AllExceptionsFilter de los servicios NestJS: captura
    cualquier excepción no manejada, la registra con el request_id y el
    traceback completo en el log del servidor, y responde SIEMPRE un JSON
    consistente al cliente — nunca el "Internal Server Error" genérico y
    sin contexto que da FastAPI por defecto.
    """

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "statusCode": exc.status_code,
                "path": request.url.path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": exc.detail,
                "request_id": request_id,
            },
            headers={"x-request-id": request_id} if request_id else None,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=422,
            content={
                "statusCode": 422,
                "path": request.url.path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": exc.errors(),
                "request_id": request_id,
            },
            headers={"x-request-id": request_id} if request_id else None,
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", None)

        # El detalle completo (traceback) SIEMPRE queda en el log del
        # servidor con su request_id, aunque al cliente solo se le
        # devuelva un mensaje genérico. Esto es lo que hay que mirar en
        # la terminal de `docker compose up` cuando algo falla.
        logger.error(
            "Excepción no manejada [request_id=%s] en %s:\n%s",
            request_id,
            request.url.path,
            "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
        )

        return JSONResponse(
            status_code=500,
            content={
                "statusCode": 500,
                "path": request.url.path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": "Error interno del servidor",
                "request_id": request_id,
            },
            headers={"x-request-id": request_id} if request_id else None,
        )
