from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def _base_url(url: str) -> str:
    """URL de conexión sin el nombre de la base (ni parámetros)."""
    return url.split("?", 1)[0].rsplit("/", 1)[0]


class Settings(BaseSettings):
    """Variables de entorno del servicio. Los valores reales nunca se
    comitean; solo .env.example se versiona en el repositorio."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 3008
    # Base propia de Analytics (tablas de KPIs, database-per-service).
    database_url: str
    # Solo en Render: la URL original de la instancia compartida, antes de
    # que el Dockerfile le cambie el nombre de la base por DATABASE_NAME.
    database_admin_url: str = ""

    # Réplicas de solo lectura de las que se alimenta el ETL (sección 3 del
    # documento: "ETL periódico sobre réplicas de solo lectura de
    # Playback-DB y Catalog-DB"). Se puede dar la URL completa o, en Render
    # (donde todas las bases viven en la misma instancia), solo el nombre.
    playback_replica_url: str = ""
    playback_replica_database_name: str = ""
    catalog_replica_url: str = ""
    catalog_replica_database_name: str = ""

    # Cada cuánto corre el ETL y cuánto espera tras arrancar.
    etl_interval_seconds: int = 300
    etl_initial_delay_seconds: int = 10

    cors_origins: str | None = None
    node_env: str = "development"

    def _replica(self, explicit: str, name: str) -> str:
        if explicit.strip():
            return explicit.strip()
        if name.strip():
            return f"{_base_url(self.database_admin_url or self.database_url)}/{name.strip()}"
        return ""

    @property
    def playback_source_url(self) -> str:
        return self._replica(self.playback_replica_url, self.playback_replica_database_name)

    @property
    def catalog_source_url(self) -> str:
        return self._replica(self.catalog_replica_url, self.catalog_replica_database_name)

    # URLs públicas de los servicios (en Render cada uno tiene su propio
    # dominio). Si CORS_ORIGINS no está definida, son los orígenes permitidos.
    public_user_url: str = ""
    public_catalog_url: str = ""
    public_playback_url: str = ""
    public_media_url: str = ""
    public_recommendation_url: str = ""
    public_billing_url: str = ""
    public_notification_url: str = ""
    public_analytics_url: str = ""
    public_gateway_url: str = ""

    @property
    def public_service_urls(self) -> dict[str, str]:
        urls = {
            "user": self.public_user_url,
            "catalog": self.public_catalog_url,
            "playback": self.public_playback_url,
            "media": self.public_media_url,
            "recommendation": self.public_recommendation_url,
            "billing": self.public_billing_url,
            "notification": self.public_notification_url,
            "analytics": self.public_analytics_url,
            "gateway": self.public_gateway_url,
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
