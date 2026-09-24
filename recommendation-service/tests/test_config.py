"""CORS solo para orígenes conocidos (sección 10), URLs para la consola y la
URL de Catalog en Render."""
from app.config import Settings

BASE = {"database_url": "postgresql://x@localhost/x"}


def test_en_local_permite_cualquier_origen_y_usa_catalog_local():
    s = Settings(_env_file=None, **BASE)
    assert s.allowed_cors_origins == ["*"]
    assert s.public_service_urls == {}
    assert s.catalog_base_url == "http://localhost:3002"


def test_en_render_solo_las_urls_de_mediastream():
    s = Settings(
        _env_file=None,
        **BASE,
        public_recommendation_url="https://ms-reco.onrender.com",
        public_catalog_url="https://ms-catalog.onrender.com/",
    )
    assert s.allowed_cors_origins == ["https://ms-catalog.onrender.com", "https://ms-reco.onrender.com"]
    # Sin CATALOG_SERVICE_URL, Recommendation llama a la URL pública de Catalog.
    assert s.catalog_base_url == "https://ms-catalog.onrender.com"


def test_catalog_service_url_tiene_prioridad():
    s = Settings(
        _env_file=None,
        **BASE,
        catalog_service_url="http://catalog-service:3002/",
        public_catalog_url="https://ms-catalog.onrender.com",
    )
    assert s.catalog_base_url == "http://catalog-service:3002"


def test_cors_origins_tiene_prioridad():
    s = Settings(_env_file=None, **BASE, cors_origins="https://app.mediastream.com")
    assert s.allowed_cors_origins == ["https://app.mediastream.com"]
