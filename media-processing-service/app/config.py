from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Variables de entorno del servicio. Los valores reales nunca se
    comitean; solo .env.example se versiona en el repositorio."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 3004
    database_url: str
    rabbitmq_url: str
    # Deben coincidir con lo que escucha Catalog-Service
    # (catalog-service/src/rabbitmq/media-events.consumer.ts).
    rabbitmq_exchange: str = "media.events"
    media_ready_routing_key: str = "media.ready"
    media_failed_routing_key: str = "media.processing.failed"
    object_storage_bucket: str = "mediastream-media"
    object_storage_endpoint: str = ""
    object_storage_access_key: str = ""
    object_storage_secret_key: str = ""
    cdn_base_url: str = "https://cdn.mediastream.example.com"
    work_dir: str = "/tmp/media-processing"
    node_env: str = "development"
    cors_origins: str | None = None

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
