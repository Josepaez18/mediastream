"""
Tablas de Analytics-Service (diagrama entidad-relación del documento):
hours_watched_daily, abandonment_by_episode y popularity_by_region.

Dos tablas de apoyo, no incluidas en el diagrama original:
  · title_dim: nombre, tipo y categoría de cada título, copiados de la réplica
    de Catalog en cada ETL. Permite mostrar nombres en el panel sin repetirlos
    en cada fila de métricas (sigue en 3FN) y sin consultar a Catalog en vivo.
  · etl_run: registro de cada ejecución del ETL (cuándo, cuántas filas, si
    falló), para saber qué tan actualizados están los KPIs.

Ninguna tiene llaves foráneas hacia otros servicios: profile_id, title_id y
episode_id son referencias lógicas alimentadas por el ETL.
"""
from sqlalchemy import JSON, BigInteger, Column, Date, DateTime, Integer, Numeric, String, Text, func

from app.database import Base


class HoursWatchedDaily(Base):
    __tablename__ = "hours_watched_daily"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # Playback guarda profile_id como texto; se conserva igual.
    profile_id = Column(String(64), nullable=False)
    date = Column(Date, nullable=False)
    hours = Column(Numeric(10, 2), nullable=False)


class AbandonmentByEpisode(Base):
    __tablename__ = "abandonment_by_episode"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    title_id = Column(BigInteger, nullable=False)
    # NULL para películas: el título completo cuenta como un único "episodio".
    episode_id = Column(BigInteger, nullable=True)
    viewers = Column(Integer, nullable=False)
    abandoned = Column(Integer, nullable=False)
    abandonment_rate = Column(Numeric(5, 4), nullable=False)


class PopularityByRegion(Base):
    __tablename__ = "popularity_by_region"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    title_id = Column(BigInteger, nullable=False)
    region = Column(String(16), nullable=False)
    views = Column(Integer, nullable=False)


class TitleDim(Base):
    __tablename__ = "title_dim"

    title_id = Column(BigInteger, primary_key=True)
    name = Column(String(255), nullable=False)
    type = Column(String(16), nullable=True)
    category = Column(String(100), nullable=True)


class EtlRun(Base):
    __tablename__ = "etl_run"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(16), nullable=False)  # success | failed
    rows_loaded = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
