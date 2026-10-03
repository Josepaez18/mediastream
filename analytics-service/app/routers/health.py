from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EtlRun

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """El proceso está vivo."""
    return {"status": "ok", "service": "analytics-service"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    """
    Puede atender tráfico. Solo su propia base es obligatoria: con ella se
    siguen sirviendo los últimos KPIs calculados. El estado del último ETL se
    reporta, pero si las réplicas no responden el panel no se cae.
    """
    try:
        db.execute(text("SELECT 1"))
        last = db.execute(select(EtlRun.status).order_by(EtlRun.started_at.desc()).limit(1)).scalar_one_or_none()
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok, last = False, None

    checks = {"database": db_ok, "lastEtl": last}
    if not db_ok:
        raise HTTPException(status_code=503, detail={"status": "unavailable", "checks": checks})
    return {"status": "ready", "checks": checks}
