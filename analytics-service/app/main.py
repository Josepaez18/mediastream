import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.middleware.exception_handlers import register_exception_handlers
from app.middleware.request_id import RequestIdMiddleware
from app.routers import analytics, health
from app.workers.etl_scheduler import run_scheduler

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ETL periódico en segundo plano, independiente de las peticiones HTTP.
    task = asyncio.create_task(run_scheduler(), name="etl-scheduler")
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(
    title="Analytics-Service",
    description=(
        "MediaStream — Panel de KPIs de audiencia: horas totales vistas, tasa de abandono por "
        "episodio y popularidad de cada título por región, calculados con un ETL periódico sobre "
        "réplicas de solo lectura de Playback-DB y Catalog-DB."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Request-id propagado/generado y log JSON por request, igual que el resto
# de microservicios de MediaStream.
app.add_middleware(RequestIdMiddleware)
register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analytics.router)
app.include_router(health.router)
