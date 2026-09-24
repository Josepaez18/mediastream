from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.events import event_publisher

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """El proceso está vivo."""
    return {"status": "ok", "service": "media-processing-service"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    """
    Puede atender tráfico. La base de datos es obligatoria (sin ella no se
    pueden crear jobs). RabbitMQ se reporta pero no bloquea: sin broker se
    siguen aceptando ingests, solo se retrasa la notificación a Catalog.
    """
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False

    checks = {"database": db_ok, "rabbitmq": event_publisher.is_connected()}
    if not db_ok:
        raise HTTPException(status_code=503, detail={"status": "unavailable", "checks": checks})
    return {"status": "ready", "checks": checks}
