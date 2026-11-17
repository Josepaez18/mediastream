"""Pruebas unitarias con mocks del ETL: run_etl corre de verdad (extracción,
transformación y carga) y solo se simulan las conexiones a PostgreSQL: las
réplicas de Playback-DB y Catalog-DB y la base propia de Analytics."""
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.sql.dml import Delete, Insert

from app.etl.pipeline import run_etl

DIA = datetime(2026, 11, 10, 21, 0, tzinfo=timezone.utc)

# Filas tal como las devuelven las réplicas.
PROGRESO = [
    SimpleNamespace(profile_id=1, title_id=10, episode_id=None, position_seconds=5400,
                    duration_seconds=7200, completed=False, updated_at=DIA),
    SimpleNamespace(profile_id=2, title_id=10, episode_id=None, position_seconds=7200,
                    duration_seconds=7200, completed=True, updated_at=DIA),
]
TITULOS = [SimpleNamespace(id=10, name="El Último Meridiano", type="MOVIE", category="Acción")]
DISPONIBILIDAD = [SimpleNamespace(title_id=10, region="co"), SimpleNamespace(title_id=10, region="MX")]


def _replica(*consultas):
    """Engine de una réplica: cada conn.execute devuelve las filas de una consulta."""
    engine = MagicMock()
    conn = engine.connect.return_value.__enter__.return_value
    conn.execute.side_effect = [iter(filas) for filas in consultas]
    return engine


def _base_propia():
    engine = MagicMock()
    return engine, engine.begin.return_value.__enter__.return_value


def _operacion(stmt):
    tipo = "DELETE" if isinstance(stmt, Delete) else "INSERT" if isinstance(stmt, Insert) else "?"
    return tipo, stmt.table.name


def test_etl_lee_las_replicas_transforma_y_reemplaza_los_kpis_en_una_transaccion():
    playback = _replica(PROGRESO)
    catalog = _replica(TITULOS, DISPONIBILIDAD)
    destino, conn = _base_propia()

    resumen = run_etl(playback_engine=playback, catalog_engine=catalog, target_engine=destino)

    filas = {
        "hours_watched_daily": 2,
        "abandonment_by_episode": 1,
        "popularity_by_region": 2,
        "title_dim": 1,
    }
    assert resumen["status"] == "success"
    assert resumen["rowsLoaded"] == filas
    assert resumen["sourceRows"] == {"watch_progress": 2, "title": 1}

    # Las réplicas solo se leen; la carga es UNA transacción en la base propia.
    playback.begin.assert_not_called()
    catalog.begin.assert_not_called()
    destino.begin.assert_called_once()

    llamadas = conn.execute.call_args_list
    assert [_operacion(c.args[0]) for c in llamadas] == [
        ("DELETE", "hours_watched_daily"), ("INSERT", "hours_watched_daily"),
        ("DELETE", "abandonment_by_episode"), ("INSERT", "abandonment_by_episode"),
        ("DELETE", "popularity_by_region"), ("INSERT", "popularity_by_region"),
        ("DELETE", "title_dim"), ("INSERT", "title_dim"),
        ("INSERT", "etl_run"),
    ]
    # Se insertan las filas ya transformadas.
    assert llamadas[1].args[1] == [
        {"profile_id": "1", "date": date(2026, 11, 10), "hours": Decimal("1.50")},
        {"profile_id": "2", "date": date(2026, 11, 10), "hours": Decimal("2.00")},
    ]
    assert llamadas[3].args[1] == [
        {"title_id": 10, "episode_id": None, "viewers": 2, "abandoned": 1, "abandonment_rate": Decimal("0.5000")},
    ]
    assert llamadas[5].args[1] == [
        {"title_id": 10, "region": "CO", "views": 2},
        {"title_id": 10, "region": "MX", "views": 2},
    ]
    registro = llamadas[8].args[0].compile(dialect=postgresql.dialect()).params
    assert registro["status"] == "success"
    assert registro["rows_loaded"] == filas


def test_si_la_replica_no_responde_registra_el_fallo_y_no_borra_los_kpis():
    playback = MagicMock()
    playback.connect.side_effect = OperationalError(
        "SELECT ...", {}, Exception("could not connect to server: Connection refused")
    )
    catalog = _replica(TITULOS, DISPONIBILIDAD)
    destino, conn = _base_propia()

    with pytest.raises(OperationalError):
        run_etl(playback_engine=playback, catalog_engine=catalog, target_engine=destino)

    catalog.connect.assert_not_called()
    # Solo se registra el fallo: ningún DELETE, el panel conserva los KPIs anteriores.
    assert [_operacion(c.args[0]) for c in conn.execute.call_args_list] == [("INSERT", "etl_run")]
    registro = conn.execute.call_args.args[0].compile(dialect=postgresql.dialect()).params
    assert registro["status"] == "failed"
    assert "could not connect to server" in registro["error"]
