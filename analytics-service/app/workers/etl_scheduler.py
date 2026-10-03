import asyncio
import logging

from app.config import get_settings
from app.etl.pipeline import run_etl

logger = logging.getLogger("etl-scheduler")


async def run_scheduler() -> None:
    """
    ETL periódico (sección 3 del documento). Corre en un hilo aparte para no
    bloquear la API; si falla (por ejemplo, porque Playback-DB no responde),
    queda registrado en etl_run y se reintenta en el siguiente ciclo. El panel
    sigue mostrando los últimos KPIs calculados.
    """
    settings = get_settings()
    await asyncio.sleep(settings.etl_initial_delay_seconds)
    while True:
        try:
            await asyncio.to_thread(run_etl)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ETL periódico fallido, se reintenta en %ss: %s", settings.etl_interval_seconds, exc)
        await asyncio.sleep(settings.etl_interval_seconds)
