import os
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.media_job import MediaJob, MediaJobStatus
from app.schemas.media import MediaIngestResponse, MediaJobResponse
from app.services.storage import object_storage_client
from app.workers.transcode_worker import run_transcoding_job

router = APIRouter(prefix="/api/media", tags=["media"])
settings = get_settings()


@router.post(
    "/ingest",
    response_model=MediaIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_media(
    background_tasks: BackgroundTasks,
    title_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Recibe el archivo de vídeo maestro subido por el equipo de contenido y
    crea un job de transcodificación. El procesamiento ocurre en segundo
    plano: este endpoint responde de inmediato con el job en estado
    PENDING, ya que la transcodificación es un proceso largo.
    """
    job_id = uuid.uuid4()
    os.makedirs(settings.work_dir, exist_ok=True)
    source_path = os.path.join(settings.work_dir, f"{job_id}_source_{file.filename}")

    with open(source_path, "wb") as buffer:
        buffer.write(await file.read())

    remote_key = f"sources/{title_id}/{job_id}_{file.filename}"
    object_storage_client.upload_source(source_path, remote_key)

    job = MediaJob(
        id=job_id,
        title_id=title_id,
        status=MediaJobStatus.PENDING,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_transcoding_job, job.id, source_path)

    return job


@router.get("/jobs/{job_id}", response_model=MediaJobResponse)
def get_job_status(job_id: uuid.UUID, db: Session = Depends(get_db)):
    """Permite consultar el estado de un job (pendiente, en proceso, completado, error)."""
    job = db.query(MediaJob).filter(MediaJob.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail=f"El job {job_id} no existe")
    return job
