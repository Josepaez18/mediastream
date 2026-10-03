"""URLs de las réplicas (local y Render) y CORS solo para orígenes conocidos (sección 10)."""
from app.config import Settings

BASE = {"database_url": "postgresql://a:b@host:5432/analytics_db"}


def test_en_local_usa_las_urls_explicitas_de_las_replicas():
    s = Settings(
        _env_file=None,
        **BASE,
        playback_replica_url="postgresql://p:p@playback-db:5432/playback_db",
        catalog_replica_url="postgresql://c:c@catalog-db:5432/catalog_db",
    )
    assert s.playback_source_url == "postgresql://p:p@playback-db:5432/playback_db"
    assert s.catalog_source_url == "postgresql://c:c@catalog-db:5432/catalog_db"
    assert s.allowed_cors_origins == ["*"]


def test_en_render_arma_las_replicas_con_el_nombre_de_cada_base():
    s = Settings(
        _env_file=None,
        database_url="postgresql://u:p@dpg-1.render.com/analytics_db",
        database_admin_url="postgresql://u:p@dpg-1.render.com/mediastream?sslmode=require",
        playback_replica_database_name="playback_db",
        catalog_replica_database_name="catalog_db",
    )
    assert s.playback_source_url == "postgresql://u:p@dpg-1.render.com/playback_db"
    assert s.catalog_source_url == "postgresql://u:p@dpg-1.render.com/catalog_db"


def test_sin_replicas_configuradas_queda_vacio():
    s = Settings(_env_file=None, **BASE)
    assert s.playback_source_url == ""
    assert s.catalog_source_url == ""


def test_cors_en_render_solo_las_urls_de_mediastream():
    s = Settings(_env_file=None, **BASE, public_analytics_url="https://ms-analytics.onrender.com/")
    assert s.allowed_cors_origins == ["https://ms-analytics.onrender.com"]
    s = Settings(_env_file=None, **BASE, cors_origins="https://app.mediastream.com")
    assert s.allowed_cors_origins == ["https://app.mediastream.com"]
