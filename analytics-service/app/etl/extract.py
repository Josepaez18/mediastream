"""
Extracción: lee las réplicas de solo lectura de Playback-DB y Catalog-DB.

Es el único punto de MediaStream donde un servicio lee la base de otro, y es
a propósito: el documento define a Analytics como un ETL sobre réplicas de
solo lectura, precisamente para que las consultas pesadas no compitan con
los servicios transaccionales. Las reglas para que siga siendo seguro:
  · conexión en modo solo lectura (app/database.py: read_only_engine),
  · solo SELECT sobre columnas concretas, nunca SELECT *,
  · las consultas viven todas en este archivo: si Playback o Catalog cambian
    su esquema, este es el único lugar que hay que revisar.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.etl.transform import AvailabilityRow, TitleRow, WatchProgressRow

WATCH_PROGRESS_SQL = text(
    """
    SELECT profile_id, title_id, episode_id, position_seconds, duration_seconds,
           completed, updated_at
    FROM watch_progress
    """
)

TITLES_SQL = text("SELECT id, name, type::text AS type, category FROM title")

AVAILABILITY_SQL = text("SELECT DISTINCT title_id, region FROM availability")


def extract_playback(engine: Engine) -> list[WatchProgressRow]:
    with engine.connect() as conn:
        return [
            WatchProgressRow(
                profile_id=str(r.profile_id),
                title_id=int(r.title_id),
                episode_id=int(r.episode_id) if r.episode_id is not None else None,
                position_seconds=int(r.position_seconds),
                duration_seconds=int(r.duration_seconds) if r.duration_seconds is not None else None,
                completed=bool(r.completed),
                updated_at=r.updated_at,
            )
            for r in conn.execute(WATCH_PROGRESS_SQL)
        ]


def extract_catalog(engine: Engine) -> tuple[list[TitleRow], list[AvailabilityRow]]:
    with engine.connect() as conn:
        titles = [
            TitleRow(id=int(r.id), name=r.name, type=r.type, category=r.category)
            for r in conn.execute(TITLES_SQL)
        ]
        availability = [
            AvailabilityRow(title_id=int(r.title_id), region=r.region) for r in conn.execute(AVAILABILITY_SQL)
        ]
    return titles, availability
