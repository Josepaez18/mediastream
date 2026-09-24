"""CORS solo para orígenes conocidos (sección 10) y URLs para la consola."""
from app.config import Settings

BASE = {"database_url": "postgresql://x@localhost/x", "rabbitmq_url": "amqp://localhost/"}


def test_en_local_permite_cualquier_origen():
    s = Settings(_env_file=None, **BASE)
    assert s.allowed_cors_origins == ["*"]
    assert s.public_service_urls == {}


def test_en_render_solo_las_urls_de_mediastream():
    s = Settings(
        _env_file=None,
        **BASE,
        public_user_url="https://ms-user.onrender.com/",
        public_catalog_url="https://ms-catalog.onrender.com",
    )
    assert s.allowed_cors_origins == ["https://ms-user.onrender.com", "https://ms-catalog.onrender.com"]
    assert s.public_service_urls == {
        "user": "https://ms-user.onrender.com",
        "catalog": "https://ms-catalog.onrender.com",
    }


def test_cors_origins_tiene_prioridad():
    s = Settings(_env_file=None, **BASE, public_user_url="https://ms-user.onrender.com",
                 cors_origins="https://app.mediastream.com, https://staging.mediastream.com")
    assert s.allowed_cors_origins == ["https://app.mediastream.com", "https://staging.mediastream.com"]
    assert Settings(_env_file=None, **BASE, cors_origins="*").allowed_cors_origins == ["*"]
