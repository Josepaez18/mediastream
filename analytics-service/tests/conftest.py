"""Configuración común de las pruebas de Analytics-Service.

Las variables obligatorias se definen antes de importar la app. Las pruebas
unitarias no se conectan a nada; las de integración usan
TEST_ADMIN_DATABASE_URL (el pipeline de CI levanta PostgreSQL) y se omiten
si no está.
"""
import os

os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql://ci:ci@localhost:5432/analytics_test"),
)
