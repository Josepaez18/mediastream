import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.media_job import MediaJobStatus


class MediaIngestResponse(BaseModel):
    """Respuesta de POST /api/media/ingest: confirma que el job fue creado."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title_id: str
    status: MediaJobStatus
    created_at: datetime


class MediaJobResponse(BaseModel):
    """
    Respuesta de GET /api/media/jobs/{id}: permite consultar el estado de
    un job (pendiente, en proceso, completado, error), tal como pide el
    documento de arquitectura.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title_id: str
    status: MediaJobStatus
    created_at: datetime
    updated_at: datetime


class MediaReadyEvent(BaseModel):
    """
    Payload publicado en el evento asíncrono media.ready, consumido por
    Catalog-Service para marcar un título como disponible una vez
    concluida la transcodificación.
    """

    title_id: str = Field(..., description="Referencia lógica al título en Catalog-Service")
    job_id: uuid.UUID
    processed_at: datetime


class MediaFailedEvent(BaseModel):
    """
    Payload publicado en media.processing.failed cuando la transcodificación
    no termina bien. Catalog-Service lo consume para marcar el título como
    UNAVAILABLE en lugar de dejarlo indefinidamente en PENDING.
    """

    title_id: str = Field(..., description="Referencia lógica al título en Catalog-Service")
    job_id: uuid.UUID
    failed_at: datetime
    reason: str
