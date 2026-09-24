import logging
import os

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class ObjectStorageClient:
    """
    Cliente delgado de almacenamiento de objetos compatible con S3
    (Render/AWS/MinIO). Se mantiene aislado detrás de esta interfaz para
    poder reemplazar el proveedor sin tocar la lógica de transcodificación.
    """

    def __init__(self) -> None:
        self.bucket = settings.object_storage_bucket
        self.endpoint = settings.object_storage_endpoint
        self.cdn_base_url = settings.cdn_base_url

    def upload_directory(self, local_dir: str, remote_prefix: str) -> str:
        """
        Sube todos los archivos de un directorio (renditions + manifiesto
        maestro) al bucket, bajo remote_prefix, y devuelve la URL pública
        del manifiesto maestro servida por la CDN.
        """
        for filename in os.listdir(local_dir):
            local_path = os.path.join(local_dir, filename)
            remote_key = f"{remote_prefix}/{filename}"
            self._upload_file(local_path, remote_key)

        return f"{self.cdn_base_url}/{remote_prefix}/master.m3u8"

    def upload_source(self, local_path: str, remote_key: str) -> str:
        """Sube el archivo de vídeo maestro recibido en /api/media/ingest."""
        self._upload_file(local_path, remote_key)
        return remote_key

    def _upload_file(self, local_path: str, remote_key: str) -> None:
        # En un entorno real esto usaría boto3 / el SDK del proveedor.
        # Se mantiene como stub explícito para que la integración real
        # se conecte aquí sin tocar el resto del servicio.
        logger.info(
            "Subiendo %s -> bucket=%s key=%s", local_path, self.bucket, remote_key
        )


object_storage_client = ObjectStorageClient()
