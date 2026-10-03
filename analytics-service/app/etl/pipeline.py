"""
ETL completo: extrae de las réplicas, transforma y carga en la base propia.

La carga reemplaza las tablas de KPIs dentro de UNA transacción: quien
consulta el panel mientras corre el ETL ve los KPIs anteriores completos,
nunca una mezcla a medias. Con el volumen de MediaStream, recalcular todo es
más simple y seguro que un ETL incremental.
"""
import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import delete, insert
from sqlalchemy.engine import Engine

from app.config import get_settings
from app.database import engine as analytics_engine
from app.database import read_only_engine
from app.etl import transform
from app.etl.extract import extract_catalog, extract_playback
from app.models import AbandonmentByEpisode, EtlRun, HoursWatchedDaily, PopularityByRegion, TitleDim

logger = logging.getLogger("etl")

# Dos ETL a la vez (el periódico y uno pedido a mano) se pisarían la carga.
_lock = threading.Lock()


class EtlNotConfigured(RuntimeError):
    pass


def run_etl(
    playback_engine: Engine | None = None,
    catalog_engine: Engine | None = None,
    target_engine: Engine | None = None,
) -> dict:
    """Ejecuta el ETL y devuelve el resumen. Registra el resultado en etl_run,
    también si falla (y en ese caso vuelve a lanzar la excepción)."""
    settings = get_settings()
    target = target_engine or analytics_engine

    with _lock:
        started_at = datetime.now(timezone.utc)
        try:
            if playback_engine is None or catalog_engine is None:
                if not settings.playback_source_url or not settings.catalog_source_url:
                    raise EtlNotConfigured(
                        "Faltan las réplicas: define PLAYBACK_REPLICA_URL y CATALOG_REPLICA_URL "
                        "(o *_REPLICA_DATABASE_NAME en Render)."
                    )
            playback = playback_engine or read_only_engine(settings.playback_source_url)
            catalog = catalog_engine or read_only_engine(settings.catalog_source_url)

            progress = extract_playback(playback)
            titles, availability = extract_catalog(catalog)

            tables = {
                HoursWatchedDaily: transform.hours_watched_daily(progress),
                AbandonmentByEpisode: transform.abandonment_by_episode(progress),
                PopularityByRegion: transform.popularity_by_region(progress, availability),
                TitleDim: transform.title_dim(titles),
            }
            rows_loaded = {model.__tablename__: len(rows) for model, rows in tables.items()}
            finished_at = datetime.now(timezone.utc)

            with target.begin() as conn:
                for model, rows in tables.items():
                    conn.execute(delete(model))
                    if rows:
                        conn.execute(insert(model), rows)
                conn.execute(
                    insert(EtlRun).values(
                        started_at=started_at,
                        finished_at=finished_at,
                        status="success",
                        rows_loaded=rows_loaded,
                    )
                )

            logger.info("ETL completado: %s", rows_loaded)
            return {
                "status": "success",
                "startedAt": started_at.isoformat(),
                "finishedAt": finished_at.isoformat(),
                "rowsLoaded": rows_loaded,
                "sourceRows": {"watch_progress": len(progress), "title": len(titles)},
            }
        except Exception as exc:
            logger.warning("ETL fallido: %s", exc)
            try:
                with target.begin() as conn:
                    conn.execute(
                        insert(EtlRun).values(
                            started_at=started_at,
                            finished_at=datetime.now(timezone.utc),
                            status="failed",
                            error=str(exc)[:2000],
                        )
                    )
            except Exception:  # noqa: BLE001
                logger.exception("No se pudo registrar el ETL fallido")
            raise
