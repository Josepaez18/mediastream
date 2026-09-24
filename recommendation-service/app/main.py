import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.middleware.exception_handlers import register_exception_handlers
from app.middleware.request_id import RequestIdMiddleware
from app.routers import console_config, debug, health, recommendations
from app.workers.catalog_sync import run_catalog_sync
from app.workers.playback_events import run_subscriber

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dos procesos en segundo plano, independientes de las peticiones HTTP:
    #  · el suscriptor de Redis que actualiza el modelo con cada evento, y
    #  · la sincronización periódica de títulos con Catalog-Service.
    # Si cualquiera de sus dependencias falla, reintentan solos; la API de
    # recomendaciones sigue respondiendo con lo que ya está en la base.
    tasks = [
        asyncio.create_task(run_subscriber(), name="playback-events"),
        asyncio.create_task(run_catalog_sync(), name="catalog-sync"),
    ]
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="Recommendation-Service",
    description=(
        "MediaStream — Sugerencias personalizadas por perfil combinando filtrado "
        "colaborativo y filtrado basado en contenido, con embeddings en PostgreSQL + pgvector."
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

# Rutas de la API primero; la consola estática al final para no taparlas.
app.include_router(debug.router)
app.include_router(recommendations.router)
app.include_router(health.router)
app.include_router(console_config.router)
app.mount("/", StaticFiles(directory="app/static", html=True), name="console")
