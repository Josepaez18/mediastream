from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Variables de entorno del servicio. Los valores reales nunca se
    comitean; solo .env.example se versiona en el repositorio."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 3005
    database_url: str

    # Redis Pub/Sub: canales que publica Playback-Service
    # (playback-service/src/playback/playback.service.ts).
    redis_url: str = "redis://localhost:6379"
    progress_channel: str = "playback.progress"
    completed_channel: str = "playback.completed"

    # Catalog-Service: de él se obtienen los metadatos para construir el
    # embedding de cada título (categoría, tipo, clasificación, sinopsis).
    catalog_service_url: str = ""
    catalog_timeout_seconds: float = 2.0
    catalog_retries: int = 2
    catalog_sync_regions: str = "CO,MX,GLOBAL"
    catalog_sync_interval_seconds: int = 60

    # Peso del filtrado basado en contenido en el puntaje híbrido; el resto
    # (1 - content_weight) corresponde al filtrado colaborativo.
    content_weight: float = 0.6
    # Cuántos perfiles parecidos se consultan para el filtrado colaborativo.
    neighbors: int = 10

    cors_origins: str | None = None
    node_env: str = "development"

    @property
    def catalog_base_url(self) -> str:
        """CATALOG_SERVICE_URL; en Render, la URL pública de Catalog (los
        servicios gratis no reciben tráfico por la red privada)."""
        url = self.catalog_service_url or self.public_catalog_url or "http://localhost:3002"
        return url.strip().rstrip("/")

    @property
    def sync_regions(self) -> list[str]:
        return [r.strip().upper() for r in self.catalog_sync_regions.split(",") if r.strip()]

    # URLs públicas de los seis servicios (en Render cada uno tiene su propio
    # dominio). Con ellas se arma /config.js para la consola y, si
    # CORS_ORIGINS no está definida, la lista de orígenes permitidos.
    public_user_url: str = ""
    public_catalog_url: str = ""
    public_playback_url: str = ""
    public_media_url: str = ""
    public_recommendation_url: str = ""
    public_billing_url: str = ""

    @property
    def public_service_urls(self) -> dict[str, str]:
        urls = {
            "user": self.public_user_url,
            "catalog": self.public_catalog_url,
            "playback": self.public_playback_url,
            "media": self.public_media_url,
            "recommendation": self.public_recommendation_url,
            "billing": self.public_billing_url,
        }
        return {k: v.strip().rstrip("/") for k, v in urls.items() if v and v.strip()}

    @property
    def allowed_cors_origins(self) -> list[str]:
        """CORS_ORIGINS manda si está definida ("*" = cualquiera). Si no, solo
        las URLs públicas de MediaStream (sección 10); sin ninguna, "*"."""
        if self.cors_origins is not None:
            origins = [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]
        else:
            origins = list(self.public_service_urls.values())
        if not origins or "*" in origins:
            return ["*"]
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
