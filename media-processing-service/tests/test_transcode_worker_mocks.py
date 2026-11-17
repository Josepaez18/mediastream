"""Pruebas unitarias con mocks del job de transcodificación: run_transcoding_job
corre de verdad y solo se simulan las dependencias externas: la sesión de
PostgreSQL, el binario de FFmpeg, el almacenamiento de objetos y el exchange de
RabbitMQ."""
import json
import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import aio_pika
import pytest

from app.models.media_job import MediaJob, MediaJobStatus
from app.services import events
from app.workers import transcode_worker

JOB_ID = uuid.UUID("6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f")


@pytest.fixture
def entorno(monkeypatch, tmp_path):
    job = MediaJob(id=JOB_ID, title_id="42", status=MediaJobStatus.PENDING)
    estados = []  # estado del job en cada commit

    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = job
    session.commit.side_effect = lambda: estados.append(job.status)
    monkeypatch.setattr(transcode_worker, "SessionLocal", lambda: session)
    monkeypatch.setattr(transcode_worker.transcoder, "work_dir", str(tmp_path))

    subidos = []  # archivos que había en el directorio al subirlo
    almacenamiento = MagicMock(
        side_effect=lambda local_dir, remote_prefix: subidos.extend(sorted(os.listdir(local_dir)))
    )
    monkeypatch.setattr(transcode_worker.object_storage_client, "upload_directory", almacenamiento)

    exchange = AsyncMock()
    monkeypatch.setattr(events.event_publisher, "_exchange", exchange)

    return SimpleNamespace(
        estados=estados, session=session, almacenamiento=almacenamiento, subidos=subidos,
        exchange=exchange, dir_job=tmp_path / str(JOB_ID),
    )


def _ffmpeg(monkeypatch, returncode, stderr=b""):
    """FFmpeg simulado: cada invocación termina con ese código de salida."""
    proceso = MagicMock(returncode=returncode)
    proceso.communicate = AsyncMock(return_value=(b"", stderr))
    lanzar = AsyncMock(return_value=proceso)
    monkeypatch.setattr("app.services.transcoding.asyncio.create_subprocess_exec", lanzar)
    return lanzar


def _publicado(exchange):
    exchange.publish.assert_awaited_once()
    mensaje = exchange.publish.await_args.args[0]
    assert mensaje.content_type == "application/json"
    assert mensaje.delivery_mode == aio_pika.DeliveryMode.PERSISTENT
    return exchange.publish.await_args.kwargs["routing_key"], json.loads(mensaje.body)


async def test_job_exitoso_pasa_a_completed_y_publica_media_ready(entorno, monkeypatch):
    ffmpeg = _ffmpeg(monkeypatch, returncode=0)

    await transcode_worker.run_transcoding_job(JOB_ID, "/videos/maestro.mp4")

    assert entorno.estados == [MediaJobStatus.PROCESSING, MediaJobStatus.COMPLETED]
    # Una invocación de FFmpeg por resolución (1080p, 720p, 480p, 240p).
    assert ffmpeg.await_count == 4
    assert ffmpeg.await_args_list[0].args[:4] == ("ffmpeg", "-y", "-i", "/videos/maestro.mp4")
    # Se sube el directorio del job, con el manifiesto maestro, bajo titles/<title_id>/<job_id>.
    entorno.almacenamiento.assert_called_once_with(
        local_dir=str(entorno.dir_job), remote_prefix=f"titles/42/{JOB_ID}"
    )
    assert entorno.subidos == ["master.m3u8"]

    routing_key, cuerpo = _publicado(entorno.exchange)
    assert routing_key == "media.ready"
    assert cuerpo["title_id"] == "42"
    assert cuerpo["job_id"] == str(JOB_ID)

    assert not entorno.dir_job.exists()  # se liberó el disco
    entorno.session.close.assert_called_once()


async def test_si_ffmpeg_falla_el_job_queda_en_error_y_avisa_a_catalog(entorno, monkeypatch):
    ffmpeg = _ffmpeg(monkeypatch, returncode=1, stderr=b"moov atom not found")

    await transcode_worker.run_transcoding_job(JOB_ID, "/videos/corrupto.mp4")

    assert entorno.estados == [MediaJobStatus.PROCESSING, MediaJobStatus.ERROR]
    assert ffmpeg.await_count == 1  # se detiene en la primera resolución
    entorno.almacenamiento.assert_not_called()

    routing_key, cuerpo = _publicado(entorno.exchange)
    assert routing_key == "media.processing.failed"
    assert cuerpo["title_id"] == "42"
    assert cuerpo["job_id"] == str(JOB_ID)
    assert "1080p" in cuerpo["reason"]
    assert "moov atom not found" in cuerpo["reason"]

    assert not entorno.dir_job.exists()
    entorno.session.close.assert_called_once()
