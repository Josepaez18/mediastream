import enum
import uuid

from sqlalchemy import Column, DateTime, Enum, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class MediaJobStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


class MediaJob(Base):
    """
    MEDIA_JOB — tal como está definido en el diagrama entidad-relación del
    documento de arquitectura (sección "3. Media-Processing-Service"):

        id (PK), title_id, status, created_at, updated_at

    Es una tabla plana en 3FN: todos sus atributos dependen únicamente del
    identificador del job. title_id es una referencia lógica al título en
    Catalog-Service, no una FK real, porque cada microservicio tiene su
    propia base de datos (database-per-service).

    Restricciones: title_id y status no pueden ser NULL, ya que todo job
    debe estar asociado a un título y tener un estado válido en todo
    momento. La llave primaria es autoincremental (aquí, UUID generado
    en la aplicación, que cumple el mismo rol de identificador único).
    """

    __tablename__ = "media_job"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Índice: se consulta el estado de transcodificación de un título específico
    title_id = Column(String, nullable=False, index=True)

    # Índice: filtrar rápidamente los jobs pendientes, en proceso o con error
    status = Column(
        Enum(
            MediaJobStatus,
            name="media_job_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=MediaJobStatus.PENDING,
        index=True,
    )

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
