"""Integración con PostgreSQL real: crea la base propia y aplica las
migraciones, corre el ETL contra "réplicas" de Playback y Catalog, comprueba
que la conexión a ellas es de solo lectura y consulta el panel de KPIs.

Solo corre si TEST_ADMIN_DATABASE_URL está definida (el pipeline de CI
levanta PostgreSQL como servicio). En local se omite.
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL")
ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_ADMIN_DATABASE_URL no definida")

PLAYBACK_SCHEMA = """
CREATE TABLE watch_progress (
  id BIGSERIAL PRIMARY KEY, profile_id TEXT NOT NULL, title_id BIGINT NOT NULL, episode_id BIGINT,
  position_seconds INT NOT NULL, duration_seconds INT, completed BOOLEAN NOT NULL DEFAULT false,
  device_id TEXT, updated_at TIMESTAMP(3) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT now()
);
INSERT INTO watch_progress (profile_id, title_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
VALUES ('1', 1, NULL, 5400, 5400, true, '2026-10-01 20:00'),
       ('2', 1, NULL, 1800, 5400, false, '2026-10-01 21:00'),
       ('1', 2, 7, 1200, 2400, false, '2026-10-02 19:00');
"""

CATALOG_SCHEMA = """
CREATE TYPE "TitleType" AS ENUM ('MOVIE', 'SERIES');
CREATE TABLE title (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, type "TitleType" NOT NULL, category TEXT);
CREATE TABLE availability (id BIGSERIAL PRIMARY KEY, title_id BIGINT NOT NULL, region TEXT NOT NULL);
INSERT INTO title (id, name, type, category) VALUES (1, 'El Último Meridiano', 'MOVIE', 'Acción'),
                                                    (2, 'Mareas', 'SERIES', 'Drama');
INSERT INTO availability (title_id, region) VALUES (1, 'CO'), (1, 'MX'), (2, 'CO');
"""


def _url(name: str) -> str:
    return ADMIN_URL.rsplit("/", 1)[0] + "/" + name


def _admin(sql: str) -> None:
    conn = psycopg2.connect(ADMIN_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.close()


@pytest.fixture
def databases():
    suffix = uuid.uuid4().hex[:8]
    names = {k: f"{k}_ci_{suffix}" for k in ("analytics", "playback", "catalog")}
    for key, schema in (("playback", PLAYBACK_SCHEMA), ("catalog", CATALOG_SCHEMA)):
        _admin(f'CREATE DATABASE "{names[key]}"')
        conn = psycopg2.connect(_url(names[key]))
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(schema)
        conn.close()
    yield names
    for name in names.values():
        _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_migra_corre_el_etl_y_sirve_los_kpis(databases):
    target = _url(databases["analytics"])
    env = {
        **os.environ,
        "DATABASE_ADMIN_URL": ADMIN_URL,
        "DATABASE_NAME": databases["analytics"],
        "DATABASE_URL": target,
    }
    for cmd in ([sys.executable, "scripts/ensure_database.py"], [sys.executable, "-m", "alembic", "upgrade", "head"]):
        result = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr

    from app.database import get_db, read_only_engine
    from app.etl.pipeline import run_etl
    from app.main import app
    from fastapi.testclient import TestClient

    playback = read_only_engine(_url(databases["playback"]))
    catalog = read_only_engine(_url(databases["catalog"]))
    analytics = create_engine(target)

    summary = run_etl(playback_engine=playback, catalog_engine=catalog, target_engine=analytics)
    assert summary["rowsLoaded"] == {
        "hours_watched_daily": 3,
        "abandonment_by_episode": 2,
        "popularity_by_region": 3,
        "title_dim": 2,
    }

    # La "réplica" es de solo lectura: un intento de escritura falla.
    with pytest.raises(DBAPIError):
        with playback.begin() as conn:
            conn.execute(text("DELETE FROM watch_progress"))

    Session = sessionmaker(bind=analytics)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    try:
        body = TestClient(app).get("/api/analytics/kpis", params={"region": "co"}).json()
    finally:
        app.dependency_overrides.clear()

    assert body["totals"] == {"hoursWatched": 2.33, "activeProfiles": 2, "titlesWatched": 2}
    assert body["regions"] == ["CO", "MX"]
    assert [(p["titleName"], p["views"]) for p in body["popularityByRegion"]] == [
        ("El Último Meridiano", 2),
        ("Mareas", 1),
    ]
    assert body["abandonmentByEpisode"][0]["titleName"] == "Mareas"
    assert body["lastEtl"]["status"] == "success"
