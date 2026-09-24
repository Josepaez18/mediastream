import asyncio
import logging
import os
import shutil
from dataclasses import dataclass

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Escalera de bitrates para adaptive bitrate streaming (HLS).
# Cada perfil define la resolución, el bitrate de vídeo y el de audio.
RENDITION_LADDER: list["RenditionProfile"] = []


@dataclass(frozen=True)
class RenditionProfile:
    name: str
    height: int
    video_bitrate_kbps: int
    audio_bitrate_kbps: int


RENDITION_LADDER = [
    RenditionProfile(name="1080p", height=1080, video_bitrate_kbps=5000, audio_bitrate_kbps=192),
    RenditionProfile(name="720p", height=720, video_bitrate_kbps=2800, audio_bitrate_kbps=128),
    RenditionProfile(name="480p", height=480, video_bitrate_kbps=1400, audio_bitrate_kbps=128),
    RenditionProfile(name="240p", height=240, video_bitrate_kbps=400, audio_bitrate_kbps=96),
]


class TranscodingError(Exception):
    """Se lanza cuando FFmpeg falla al generar una resolución."""


class FfmpegTranscoder:
    """
    Wrapper delgado sobre el binario de FFmpeg. Genera, para un vídeo
    maestro, un set de renditions HLS (múltiples resoluciones y bitrates)
    y un manifiesto maestro que las referencia, listo para subirse al
    almacenamiento de objetos servido por la CDN.
    """

    def __init__(self, work_dir: str | None = None) -> None:
        self.work_dir = work_dir or settings.work_dir
        os.makedirs(self.work_dir, exist_ok=True)

    def _job_dir(self, job_id: str) -> str:
        path = os.path.join(self.work_dir, job_id)
        os.makedirs(path, exist_ok=True)
        return path

    async def transcode(self, job_id: str, source_path: str) -> list[RenditionProfile]:
        """
        Genera cada rendition de la escalera para el archivo maestro dado.
        Devuelve la lista de perfiles generados exitosamente; lanza
        TranscodingError si alguno falla (el job se marca como error).
        """
        output_dir = self._job_dir(job_id)
        generated: list[RenditionProfile] = []

        for profile in RENDITION_LADDER:
            rendition_path = os.path.join(output_dir, f"{profile.name}.m3u8")
            command = self._build_command(source_path, rendition_path, profile)

            logger.info("Transcodificando job=%s rendition=%s", job_id, profile.name)
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                raise TranscodingError(
                    f"FFmpeg falló en rendition {profile.name} para job {job_id}: "
                    f"{stderr.decode(errors='ignore')[-500:]}"
                )
            generated.append(profile)

        self._write_master_manifest(output_dir, generated)
        return generated

    def _build_command(
        self, source_path: str, output_path: str, profile: "RenditionProfile"
    ) -> list[str]:
        return [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-vf",
            f"scale=-2:{profile.height}",
            "-c:v",
            "h264",
            # Un solo hilo y preset rápido: el 1080p pasa de ~500 MB a ~240 MB
            # de memoria, así cabe en los 512 MB del plan gratis de Render.
            "-preset",
            "veryfast",
            "-threads",
            "1",
            "-b:v",
            f"{profile.video_bitrate_kbps}k",
            "-c:a",
            "aac",
            "-b:a",
            f"{profile.audio_bitrate_kbps}k",
            "-hls_time",
            "6",
            "-hls_playlist_type",
            "vod",
            output_path,
        ]

    def _write_master_manifest(
        self, output_dir: str, renditions: list["RenditionProfile"]
    ) -> None:
        lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
        for r in renditions:
            bandwidth = (r.video_bitrate_kbps + r.audio_bitrate_kbps) * 1000
            lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION=x{r.height}")
            lines.append(f"{r.name}.m3u8")

        with open(os.path.join(output_dir, "master.m3u8"), "w") as f:
            f.write("\n".join(lines))

    def cleanup(self, job_id: str) -> None:
        """Libera espacio en disco tras subir los renditions a la CDN."""
        shutil.rmtree(self._job_dir(job_id), ignore_errors=True)
