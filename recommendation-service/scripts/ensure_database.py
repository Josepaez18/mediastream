"""Crea la base de datos propia de este servicio si todavía no existe.

Solo se usa en Render: allí los seis microservicios comparten la instancia
gratuita de Render Postgres, y cada uno trabaja en su propia base dentro de
ella (database-per-service). El Dockerfile la llama antes de las migraciones
cuando DATABASE_NAME está definida; en local no hace nada.

Variables:
  DATABASE_ADMIN_URL  URL de la base que creó Render (existe siempre).
  DATABASE_NAME       Nombre de la base de este servicio.
"""
import os
import sys
import time

import psycopg2
from psycopg2 import sql


def ensure_database(admin_url: str, name: str) -> None:
    conn = psycopg2.connect(admin_url)
    # CREATE DATABASE no puede ejecutarse dentro de una transacción.
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
            if cur.fetchone():
                print(f"Base de datos {name}: ya existe.", flush=True)
                return
            # template0 nunca acepta conexiones, así que no choca con otro
            # servicio que esté creando su base al mismo tiempo.
            cur.execute(
                sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name))
            )
            print(f"Base de datos {name}: creada.", flush=True)
    finally:
        conn.close()


def main() -> int:
    admin_url = os.environ.get("DATABASE_ADMIN_URL", "")
    name = os.environ.get("DATABASE_NAME", "")
    if not admin_url or not name:
        return 0
    for attempt in range(1, 6):
        try:
            ensure_database(admin_url, name)
            return 0
        except psycopg2.errors.DuplicateDatabase:
            return 0  # otro arranque la creó en paralelo
        except psycopg2.Error as exc:
            print(f"No se pudo crear/verificar {name} (intento {attempt}/5): {exc}", flush=True)
            time.sleep(3 * attempt)
    return 1


if __name__ == "__main__":
    sys.exit(main())
