from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

router = APIRouter(tags=["metrics"])


# Fuera del esquema de Swagger: no es parte de la API del servicio, es el
# punto que consulta Prometheus. No exige autenticación.
@router.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    """Métricas en el formato de Prometheus: peticiones HTTP y proceso (CPU, memoria)."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
