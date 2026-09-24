"""Media no depende de RabbitMQ para arrancar ni para aceptar ingests."""
from app.services import events
from app.services.events import EventPublisher


async def test_sin_broker_no_lanza_y_reporta_desconectado(monkeypatch):
    # Un puerto cerrado: la conexión falla de inmediato.
    monkeypatch.setattr(events.settings, "rabbitmq_url", "amqp://guest:guest@127.0.0.1:1/")
    publisher = EventPublisher()
    assert await publisher.ensure_connected() is False
    assert publisher.is_connected() is False
