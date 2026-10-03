from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.etl.pipeline import EtlNotConfigured, run_etl
from app.models import AbandonmentByEpisode, EtlRun, HoursWatchedDaily, PopularityByRegion, TitleDim

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _float(value) -> float:
    return float(value) if value is not None else 0.0


def _last_run(db: Session, status: str | None = None) -> dict | None:
    query = select(EtlRun).order_by(EtlRun.started_at.desc()).limit(1)
    if status:
        query = query.where(EtlRun.status == status)
    run = db.execute(query).scalar_one_or_none()
    if not run:
        return None
    return {
        "status": run.status,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "rowsLoaded": run.rows_loaded,
        "error": run.error,
    }


@router.get("/kpis")
def kpis(
    region: str | None = Query(None, description="Filtra la popularidad por región (p. ej. CO)"),
    limit: int = Query(10, ge=1, le=100, description="Filas por ranking"),
    days: int = Query(30, ge=1, le=365, description="Días de la serie de horas vistas"),
    db: Session = Depends(get_db),
):
    """
    Indicadores agregados de audiencia (sección 3 del documento): horas
    totales vistas, tasa de abandono por episodio y popularidad de cada
    título por región. Se leen de las tablas que llena el ETL, nunca de las
    bases de otros servicios en vivo.
    """
    total_hours, active_profiles = db.execute(
        select(
            func.coalesce(func.sum(HoursWatchedDaily.hours), 0),
            func.count(func.distinct(HoursWatchedDaily.profile_id)),
        )
    ).one()
    titles_watched = db.execute(select(func.count(func.distinct(AbandonmentByEpisode.title_id)))).scalar_one()

    daily = db.execute(
        select(HoursWatchedDaily.date, func.sum(HoursWatchedDaily.hours).label("hours"))
        .group_by(HoursWatchedDaily.date)
        .order_by(HoursWatchedDaily.date.desc())
        .limit(days)
    ).all()

    abandonment = db.execute(
        select(AbandonmentByEpisode, TitleDim.name)
        .outerjoin(TitleDim, TitleDim.title_id == AbandonmentByEpisode.title_id)
        .order_by(AbandonmentByEpisode.abandonment_rate.desc(), AbandonmentByEpisode.viewers.desc())
        .limit(limit)
    ).all()

    popularity_query = (
        select(PopularityByRegion, TitleDim.name, TitleDim.category)
        .outerjoin(TitleDim, TitleDim.title_id == PopularityByRegion.title_id)
        .order_by(PopularityByRegion.views.desc(), PopularityByRegion.title_id)
        .limit(limit)
    )
    if region:
        popularity_query = popularity_query.where(PopularityByRegion.region == region.strip().upper())
    popularity = db.execute(popularity_query).all()

    regions = db.execute(select(PopularityByRegion.region).distinct().order_by(PopularityByRegion.region)).scalars()

    return {
        "totals": {
            "hoursWatched": round(_float(total_hours), 2),
            "activeProfiles": active_profiles,
            "titlesWatched": titles_watched,
        },
        "hoursWatchedDaily": [{"date": d.isoformat(), "hours": round(_float(h), 2)} for d, h in reversed(daily)],
        "abandonmentByEpisode": [
            {
                "titleId": str(row.title_id),
                "titleName": name,
                "episodeId": str(row.episode_id) if row.episode_id is not None else None,
                "viewers": row.viewers,
                "abandoned": row.abandoned,
                "abandonmentRate": _float(row.abandonment_rate),
            }
            for row, name in abandonment
        ],
        "popularityByRegion": [
            {
                "titleId": str(row.title_id),
                "titleName": name,
                "category": category,
                "region": row.region,
                "views": row.views,
            }
            for row, name, category in popularity
        ],
        "regions": list(regions),
        "lastEtl": _last_run(db),
        "lastSuccessfulEtl": _last_run(db, "success"),
    }


@router.post("/etl/run")
def run_now():
    """Ejecuta el ETL ahora mismo, sin esperar al ciclo periódico (útil en la demo)."""
    try:
        return run_etl()
    except EtlNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"No se pudo ejecutar el ETL: {exc}")
