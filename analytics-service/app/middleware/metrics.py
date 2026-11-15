import time

from prometheus_client import Counter, Histogram
from starlette.types import ASGIApp, Message, Receive, Scope, Send

METRICS_PATH = "/metrics"

REQUESTS = Counter(
    "http_requests_total",
    "Peticiones HTTP atendidas",
    ["method", "route", "status"],
)
DURATION = Histogram(
    "http_request_duration_seconds",
    "Tiempo de respuesta de las peticiones HTTP, en segundos",
    ["method", "route", "status"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)


class PrometheusMiddleware:
    """
    Cuenta y cronometra cada petición HTTP para Prometheus (sección 9,
    Observabilidad), con las mismas métricas y etiquetas que los servicios
    NestJS de MediaStream:

      http_requests_total             por method, route y status
      http_request_duration_seconds   histograma, mismas etiquetas

    La disponibilidad (up) la calcula Prometheus en cada consulta a /metrics
    y la tasa de errores sale de las peticiones con status 5xx.

    La etiqueta route es la ruta declarada (p. ej. /api/analytics/kpis)
    y no la URL recibida: un id distinto en cada petición no crea una serie
    nueva. Lo que no coincide con ninguna ruta de la API (archivos estáticos,
    404) se agrupa en "other". Las consultas a /metrics no se cuentan.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] == METRICS_PATH:
            await self.app(scope, receive, send)
            return

        # Si la aplicación falla antes de responder, la respuesta 500 la
        # escribe una capa más externa: se cuenta como error del servidor.
        status = 500
        start = time.perf_counter()

        async def send_and_capture_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_capture_status)
        finally:
            route = getattr(scope.get("route"), "path", "other")
            labels = (scope["method"], route, str(status))
            REQUESTS.labels(*labels).inc()
            DURATION.labels(*labels).observe(time.perf_counter() - start)
