"""
Sincronización periódica con Catalog-Service (REST).

El filtrado basado en contenido tiene una ventaja clave: puede recomendar
un título que nadie ha visto todavía (un estreno). Para eso este servicio
necesita conocer los títulos antes de que llegue el primer evento de
reproducción. Cada CATALOG_SYNC_INTERVAL_SECONDS se piden a Catalog los
títulos disponibles en las regiones configuradas y se calcula su embedding.

Si Catalog está caído, la sincronización se salta y se reintenta en el
siguiente ciclo: las recomendaciones se siguen sirviendo con los vectores
que ya estaban guardados (consistencia eventual).
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import func, select

from app.config import get_settings
from app.database import SessionLocal
from app.models import ContentEmbedding
from app.services import event_log
from app.services.catalog_client import CatalogUnavailable, catalog_client
from app.services.profile_model import ensure_content

logger = logging.getLogger(__name__)
settings = get_settings()


def sync_catalog() -> dict:
    state = event_log.catalog_sync_state
    seen: dict[int, dict] = {}
    try:
        for region in settings.sync_regions:
            for title in catalog_client.list_titles(region):
                seen[int(title["id"])] = title
    except CatalogUnavailable as exc:
        state.update(
            lastRunAt=event_log.now(),
            ok=False,
            detail=f"Catalog-Service no responde: {str(exc)[:120]}",
        )
        return dict(state)

    db = SessionLocal()
    try:
        for title_id, meta in seen.items():
            ensure_content(db, title_id, meta)
        db.commit()
        total = db.execute(select(func.count()).select_from(ContentEmbedding)).scalar_one()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.exception("Error sincronizando el catálogo")
        state.update(lastRunAt=event_log.now(), ok=False, detail=str(exc)[:200])
        return dict(state)
    finally:
        db.close()

    state.update(
        lastRunAt=event_log.now(),
        ok=True,
        titlesSeen=len(seen),
        titlesWithEmbedding=int(total),
        detail=f"Regiones: {', '.join(settings.sync_regions)}",
    )
    logger.info("Catálogo sincronizado: %d títulos vistos, %d con embedding", len(seen), total)
    return dict(state)


async def run_catalog_sync() -> None:
    # Pequeña espera inicial: en docker compose, Catalog puede estar
    # terminando de arrancar al mismo tiempo que este servicio.
    await asyncio.sleep(5)
    while True:
        await asyncio.to_thread(sync_catalog)
        await asyncio.sleep(settings.catalog_sync_interval_seconds)
