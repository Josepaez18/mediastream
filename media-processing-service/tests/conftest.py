"""Configuración común de las pruebas de Media-Processing-Service.

Las variables obligatorias se definen antes de importar la app. Las pruebas
unitarias no se conectan a nada; las de integración usan TEST_DATABASE_URL
(el pipeline de CI levanta un PostgreSQL real) y se omiten si no está.
"""
import os

os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql://ci:ci@localhost:5432/media_test"),
)
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
