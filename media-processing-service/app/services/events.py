import asyncio
import logging

import aio_pika
from pydantic import BaseModel

from app.config import get_settings
from app.schemas.media import MediaFailedEvent, MediaReadyEvent

logger = logging.getLogger(__name__)
settings = get_settings()


class EventPublisher:
    """
    Publica eventos que no pueden perderse usando RabbitMQ, que persiste el
    mensaje hasta que el consumidor confirma su procesamiento y permite
    reintentos ante fallo.

    Contrato con Catalog-Service (el consumidor):
      · exchange  : media.events (tipo topic, durable)
      · routing   : media.ready              -> el título pasa a AVAILABLE
                    media.processing.failed  -> el título pasa a UNAVAILABLE
      · payload   : JSON con title_id (Catalog también acepta titleId)

    El exchange y las routing keys son configurables por entorno, pero sus
    valores por defecto deben coincidir con los que escucha Catalog-Service
    (src/rabbitmq/media-events.consumer.ts).
    """

    def __init__(self) -> None:
        self._connection: aio_pika.RobustConnection | None = None
        self._channel: aio_pika.abc.AbstractChannel | None = None
        self._exchange: aio_pika.abc.AbstractExchange | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        try:
            self._connection = await aio_pika.connect_robust(settings.rabbitmq_url)
            self._channel = await self._connection.channel()
            self._exchange = await self._channel.declare_exchange(
                settings.rabbitmq_exchange,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
        except Exception:
            await self.close()
            self._connection = self._channel = self._exchange = None
            raise
        logger.info("Conectado a RabbitMQ, publicando en el exchange %s", settings.rabbitmq_exchange)

    async def ensure_connected(self) -> bool:
        """Conecta si hace falta. Devuelve False (sin lanzar) si RabbitMQ no responde."""
        if self._exchange is not None:
            return True
        async with self._lock:
            if self._exchange is not None:
                return True
            try:
                await self.connect()
                return True
            except Exception as exc:  # noqa: BLE001
                logger.warning("RabbitMQ no disponible: %s", exc)
                return False

    async def connect_with_retry(self, max_delay: float = 60.0) -> None:
        """Al arrancar: la API no espera a RabbitMQ. Se reintenta en segundo
        plano con backoff exponencial hasta conectar (sin broker se siguen
        aceptando ingests; solo se retrasa la notificación a Catalog)."""
        delay = 2.0
        while not await self.ensure_connected():
            logger.warning("Reintentando la conexión a RabbitMQ en %.0f s", delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, max_delay)

    async def close(self) -> None:
        if self._connection:
            try:
                await self._connection.close()
            except Exception:  # noqa: BLE001
                pass

    def is_connected(self) -> bool:
        return self._connection is not None and not self._connection.is_closed

    async def publish_media_ready(self, event: MediaReadyEvent) -> None:
        await self._publish(settings.media_ready_routing_key, event)
        logger.info(
            "Evento %s publicado para title_id=%s job_id=%s",
            settings.media_ready_routing_key,
            event.title_id,
            event.job_id,
        )

    async def publish_media_failed(self, event: MediaFailedEvent) -> None:
        await self._publish(settings.media_failed_routing_key, event)
        logger.warning(
            "Evento %s publicado para title_id=%s job_id=%s",
            settings.media_failed_routing_key,
            event.title_id,
            event.job_id,
        )

    async def _publish(self, routing_key: str, event: BaseModel) -> None:
        if not await self.ensure_connected():
            raise RuntimeError("EventPublisher no está conectado a RabbitMQ")

        message = aio_pika.Message(
            body=event.model_dump_json().encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        await self._exchange.publish(message, routing_key=routing_key)


event_publisher = EventPublisher()
