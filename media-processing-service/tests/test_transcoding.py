"""Escalera de bitrates y comando de FFmpeg (adaptive bitrate streaming)."""
import shutil
from pathlib import Path

import pytest

from app.services.transcoding import RENDITION_LADDER, FfmpegTranscoder

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


def test_escalera_de_1080p_a_240p():
    assert [r.name for r in RENDITION_LADDER] == ["1080p", "720p", "480p", "240p"]
    bitrates = [r.video_bitrate_kbps for r in RENDITION_LADDER]
    assert bitrates == sorted(bitrates, reverse=True)


def test_comando_ffmpeg_por_resolucion(tmp_path):
    transcoder = FfmpegTranscoder(work_dir=str(tmp_path))
    perfil_720 = RENDITION_LADDER[1]
    cmd = transcoder._build_command("in.mp4", "out/720p.m3u8", perfil_720)
    assert cmd[0] == "ffmpeg"
    assert "scale=-2:720" in cmd
    assert "2800k" in cmd and "128k" in cmd
    assert cmd[cmd.index("-hls_playlist_type") + 1] == "vod"
    assert cmd[-1] == "out/720p.m3u8"


def test_manifiesto_maestro_referencia_cada_resolucion(tmp_path):
    transcoder = FfmpegTranscoder(work_dir=str(tmp_path))
    transcoder._write_master_manifest(str(tmp_path), RENDITION_LADDER)
    manifest = (tmp_path / "master.m3u8").read_text()
    assert manifest.startswith("#EXTM3U")
    for r in RENDITION_LADDER:
        assert f"{r.name}.m3u8" in manifest
    assert "BANDWIDTH=5192000,RESOLUTION=x1080" in manifest


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg no está instalado")
async def test_transcodifica_un_video_real(tmp_path):
    """Prueba de integración: FFmpeg real sobre la muestra de 5 segundos."""
    transcoder = FfmpegTranscoder(work_dir=str(tmp_path))
    generated = await transcoder.transcode("job-prueba", str(SAMPLES / "muestra-5s.mp4"))
    assert [r.name for r in generated] == ["1080p", "720p", "480p", "240p"]
    job_dir = tmp_path / "job-prueba"
    assert (job_dir / "master.m3u8").exists()
    assert list(job_dir.glob("720p*.ts")), "no se generaron segmentos HLS"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg no está instalado")
async def test_archivo_corrupto_falla_con_error_claro(tmp_path):
    from app.services.transcoding import TranscodingError

    transcoder = FfmpegTranscoder(work_dir=str(tmp_path))
    with pytest.raises(TranscodingError):
        await transcoder.transcode("job-corrupto", str(SAMPLES / "archivo-corrupto.mp4"))
