"""
SOLO PARA OBSERVAR EL SERVICIO EN LA DEMOSTRACIÓN (mismo criterio que
/api/users/debug en User-Service): exponen el estado interno para verlo
desde la consola web. En producción no existirían; la entrada real de
datos a este servicio son los eventos de Redis y la sincronización con
Catalog.
"""
import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ContentEmbedding, ProfileEmbedding, ProfileInteraction
from app.services import event_log
from app.workers.catalog_sync import sync_catalog

router = APIRouter(prefix="/api/recommendations/debug", tags=["debug"])


@router.get("/events", summary="[Solo demo] Últimos eventos consumidos y estado de los procesos.")
def events(db: Session = Depends(get_db)):
    data = event_log.snapshot()
    data["model"] = {
        "titlesWithEmbedding": db.execute(select(func.count()).select_from(ContentEmbedding)).scalar_one(),
        "profilesWithEmbedding": db.execute(select(func.count()).select_from(ProfileEmbedding)).scalar_one(),
        "interactions": db.execute(select(func.count()).select_from(ProfileInteraction)).scalar_one(),
    }
    return data


@router.post("/sync-catalog", summary="[Solo demo] Sincroniza ahora los títulos de Catalog-Service.")
async def sync_now():
    return await asyncio.to_thread(sync_catalog)
