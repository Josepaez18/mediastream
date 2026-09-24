"""Integración con PostgreSQL + pgvector real: la base propia en Render y las
migraciones (que crean la extensión vector y el índice HNSW).

Solo corre si TEST_ADMIN_DATABASE_URL apunta a un PostgreSQL con pgvector
(el pipeline de CI levanta uno como servicio). En local se omite.
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL")
ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_ADMIN_DATABASE_URL no definida")


def _run(env_extra, *cmd):
    env = {**os.environ, **env_extra}
    return subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)


def test_crea_la_base_del_servicio_y_aplica_las_migraciones():
    name = f"reco_ci_{uuid.uuid4().hex[:8]}"
    target = ADMIN_URL.rsplit("/", 1)[0] + "/" + name
    env = {"DATABASE_ADMIN_URL": ADMIN_URL, "DATABASE_NAME": name, "DATABASE_URL": target}

    created = _run(env, sys.executable, "scripts/ensure_database.py")
    assert created.returncode == 0, created.stdout + created.stderr

    migrate = _run(env, sys.executable, "-m", "alembic", "upgrade", "head")
    assert migrate.returncode == 0, migrate.stdout + migrate.stderr

    conn = psycopg2.connect(target)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            assert cur.fetchone() == ("vector",)
            cur.execute("SELECT indexdef FROM pg_indexes WHERE indexdef ILIKE '%%USING hnsw%%'")
            assert cur.fetchall(), "falta el índice HNSW de pgvector"
    finally:
        conn.close()
        admin = psycopg2.connect(ADMIN_URL)
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}"')
        admin.close()
