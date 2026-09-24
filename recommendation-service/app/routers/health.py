from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import event_log
from app.services.catalog_client import catalog_client

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """El proceso está vivo."""
    return {"status": "ok", "service": "recommendation-service"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    """
    Puede atender tráfico. Solo la base de datos es obligatoria: con ella se
    siguen sirviendo recomendaciones. Redis y Catalog se reportan, pero su
    caída solo detiene la actualización del modelo, no las respuestas.
    """
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False

    checks = {
        "database": db_ok,
        "redisSubscriber": bool(event_log.subscriber_state.get("connected")),
        "catalogService": catalog_client.is_reachable(),
    }
    if not db_ok:
        raise HTTPException(status_code=503, detail={"status": "unavailable", "checks": checks})
    return {"status": "ready", "checks": checks}
