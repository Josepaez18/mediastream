import logging
import uuid
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models.media_job import MediaJob, MediaJobStatus
from app.schemas.media import MediaFailedEvent, MediaReadyEvent
from app.services.events import event_publisher
from app.services.storage import object_storage_client
from app.services.transcoding import FfmpegTranscoder

logger = logging.getLogger(__name__)
transcoder = FfmpegTranscoder()


async def run_transcoding_job(job_id: uuid.UUID, source_path: str) -> None:
    """
    Ejecuta el job de transcodificación de punta a punta, actualizando el
    campo `status` de MEDIA_JOB en cada etapa (pending -> processing ->
    completed/error), exactamente los cuatro estados que pide el
    documento de arquitectura para GET /api/media/jobs/{id}:

    1) marca el job como PROCESSING,
    2) genera las resoluciones con FFmpeg (adaptive bitrate streaming),
    3) sube los renditions al almacenamiento de objetos servido por la CDN,
    4) marca el job como COMPLETED y publica media.ready,
    5) si algo falla, marca el job como ERROR y publica
       media.processing.failed, para que Catalog-Service marque el título
       como UNAVAILABLE en vez de dejarlo huérfano en PENDING. El detalle
       del error queda en el log del servicio (el esquema de MEDIA_JOB no
       incluye una columna para él).

    Se abre una sesión de base de datos propia (en lugar de reutilizar la
    del request HTTP) porque esta tarea sigue viva después de que la
    respuesta de /api/media/ingest ya fue enviada al cliente.
    """
    db = SessionLocal()
    try:
        job = db.query(MediaJob).filter(MediaJob.id == job_id).first()
        if job is None:
            logger.error("Job %s no encontrado al iniciar transcodificación", job_id)
            return

        job.status = MediaJobStatus.PROCESSING
        db.commit()

        # --- Transcodificación + subida ----------------------------------
        # Se captura cualquier excepción (no solo TranscodingError): un
        # FFmpeg ausente, un disco lleno o un fallo de subida también
        # deben terminar en ERROR. Un job nunca puede quedar atascado en
        # PROCESSING para siempre.
        try:
            renditions = await transcoder.transcode(str(job_id), source_path)
            remote_prefix = f"titles/{job.title_id}/{job_id}"
            object_storage_client.upload_directory(
                local_dir=f"{transcoder.work_dir}/{job_id}",
                remote_prefix=remote_prefix,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Transcodificación fallida para job %s: %s", job_id, exc)
            job.status = MediaJobStatus.ERROR
            db.commit()
            await _notify_failure(job, reason=str(exc)[:300])
            return

        # --- Éxito --------------------------------------------------------
        job.status = MediaJobStatus.COMPLETED
        db.commit()

        # Si la publicación falla, el job sigue COMPLETED (la transcodificación
        # sí terminó bien) y el fallo queda en el log para reintentarlo.
        try:
            await event_publisher.publish_media_ready(
                MediaReadyEvent(
                    title_id=job.title_id,
                    job_id=job.id,
                    processed_at=datetime.now(timezone.utc),
                )
            )
        except Exception:  # noqa: BLE001
            logger.exception("No se pudo publicar media.ready para job %s", job_id)
            return

        logger.info(
            "Job %s completado (%d resoluciones) — media.ready publicado",
            job_id,
            len(renditions),
        )

    finally:
        transcoder.cleanup(str(job_id))
        db.close()


async def _notify_failure(job: MediaJob, reason: str) -> None:
    try:
        await event_publisher.publish_media_failed(
            MediaFailedEvent(
                title_id=job.title_id,
                job_id=job.id,
                failed_at=datetime.now(timezone.utc),
                reason=reason,
            )
        )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo publicar media.processing.failed para job %s", job.id)
