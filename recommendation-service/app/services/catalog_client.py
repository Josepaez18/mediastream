"""
Comunicación síncrona (REST) con Catalog-Service.

Recommendation-Service NO lee la base de datos del catálogo: pide los
metadatos por la API pública, igual que Playback-Service. Catalog es la
única fuente de verdad de qué títulos existen, en qué región están
disponibles y cuáles son aptos para perfiles infantiles.

Resiliencia (secciones 4.5 y 4.6 del documento): timeout corto (~2 s) y
hasta 2 reintentos con backoff exponencial. Si aun así falla, se lanza
CatalogUnavailable y quien llama decide cómo degradar; nunca se bloquea
el consumo de eventos ni la respuesta de recomendaciones.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class CatalogUnavailable(Exception):
    """Catalog-Service no respondió a tiempo (o respondió con error)."""


class CatalogClient:
    def __init__(self) -> None:
        self.base_url = settings.catalog_base_url

    def _get(self, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        last_error: Optional[Exception] = None
        for attempt in range(settings.catalog_retries + 1):
            try:
                # trust_env=False: una llamada interna entre servicios no
                # debe pasar por un proxy HTTP configurado en la máquina.
                response = httpx.get(
                    f"{self.base_url}{path}",
                    params=params,
                    timeout=settings.catalog_timeout_seconds,
                    trust_env=False,
                )
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                return response.json()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                last_error = exc
                if attempt < settings.catalog_retries:
                    time.sleep(0.2 * (2**attempt))
        logger.warning("Catalog-Service no responde en %s: %s", path, last_error)
        raise CatalogUnavailable(str(last_error))

    def get_title(self, title_id: int) -> Optional[dict]:
        """Metadatos de un título, o None si Catalog dice que no existe."""
        return self._get(f"/api/catalog/titles/{title_id}")

    def list_titles(self, region: str, is_kids: bool = False) -> list[dict]:
        """Títulos AVAILABLE con licencia vigente en la región (y aptos para
        perfil infantil si is_kids). Es exactamente el catálogo que ese
        perfil puede ver, calculado por Catalog-Service."""
        params: dict[str, Any] = {"region": region}
        if is_kids:
            params["isKids"] = "true"
        data = self._get("/api/catalog/titles", params=params)
        return data if isinstance(data, list) else []

    def is_reachable(self) -> bool:
        try:
            response = httpx.get(f"{self.base_url}/health", timeout=1.5, trust_env=False)
            return response.status_code == 200
        except httpx.HTTPError:
            return False


catalog_client = CatalogClient()
