from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

# Base PROPIA de Analytics: la única en la que este servicio escribe.
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependencia de FastAPI: entrega una sesión y siempre la cierra."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def read_only_engine(url: str) -> Engine:
    """
    Conexión a una réplica de otro servicio (Playback-DB o Catalog-DB).

    Toda transacción se abre en modo solo lectura (default_transaction_read_only):
    aunque por error se intentara un INSERT o un UPDATE, PostgreSQL lo
    rechaza. Así Analytics nunca puede modificar los datos de otro servicio,
    aun cuando en desarrollo la "réplica" sea la base original. NullPool: el
    ETL corre cada varios minutos, no tiene sentido mantener conexiones
    abiertas contra bases que no son suyas.
    """
    return create_engine(
        url,
        poolclass=NullPool,
        pool_pre_ping=True,
        connect_args={"options": "-c default_transaction_read_only=on", "connect_timeout": 5},
    )
