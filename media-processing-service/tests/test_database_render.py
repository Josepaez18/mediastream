"""Integración con PostgreSQL real: la base propia en Render y las migraciones.

Solo corre si TEST_ADMIN_DATABASE_URL apunta a un PostgreSQL (el pipeline de
CI levanta uno como servicio). En local se omite.
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
    name = f"media_ci_{uuid.uuid4().hex[:8]}"
    target = ADMIN_URL.rsplit("/", 1)[0] + "/" + name
    env = {"DATABASE_ADMIN_URL": ADMIN_URL, "DATABASE_NAME": name, "DATABASE_URL": target}

    first = _run(env, sys.executable, "scripts/ensure_database.py")
    assert first.returncode == 0, first.stdout + first.stderr
    assert "creada" in first.stdout
    again = _run(env, sys.executable, "scripts/ensure_database.py")
    assert "ya existe" in again.stdout

    migrate = _run(env, sys.executable, "-m", "alembic", "upgrade", "head")
    assert migrate.returncode == 0, migrate.stdout + migrate.stderr

    conn = psycopg2.connect(target)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.media_job')")
            assert cur.fetchone()[0] == "media_job"
    finally:
        conn.close()
        admin = psycopg2.connect(ADMIN_URL)
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}"')
        admin.close()
