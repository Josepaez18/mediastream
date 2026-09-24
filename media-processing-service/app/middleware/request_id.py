import json
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("http")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Propaga (o genera) el request-id inyectado por el API Gateway, tal como
    describe el documento de arquitectura, para poder rastrear una
    solicitud a través de los logs de varios servicios. Además emite un
    log estructurado en JSON por cada request (método, ruta, código de
    respuesta, latencia), igual que el resto de microservicios de
    MediaStream.
    """

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.perf_counter()

        response = await call_next(request)

        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers["x-request-id"] = request_id

        logger.info(
            json.dumps(
                {
                    "level": "info",
                    "service": "media-processing-service",
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "latency_ms": latency_ms,
                }
            )
        )
        return response
