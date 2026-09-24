"""
Consumo asíncrono de playback.progress y playback.completed (Redis Pub/Sub),
publicados por Playback-Service.

Por qué Redis y no RabbitMQ (sección 4.2 del documento): son eventos de
alta frecuencia y baja latencia. Si se pierde un playback.progress
ocasional (por ejemplo, mientras este servicio se reinicia) no pasa nada:
el siguiente trae una posición más reciente. Por eso tampoco hay ack ni
reintentos, a diferencia de media.ready o payment.failed.

Contrato del mensaje (playback-service/src/playback/playback.service.ts):
    {"profileId": "1", "titleId": "3", "episodeId": null,
     "positionSeconds": 1830, "durationSeconds": 7200, "occurredAt": "..."}
"""
from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis

from app.config import get_settings
from app.database import SessionLocal
from app.services import event_log
from app.services.catalog_client import CatalogUnavailable
from app.services.embeddings import interaction_strength
from app.services.profile_model import ensure_content, recompute_profile, record_interaction

logger = logging.getLogger(__name__)
settings = get_settings()


def handle_event(channel: str, raw: str) -> None:
    """Procesa un evento: guarda la interacción, se asegura de que el título
    tenga embedding y recalcula el embedding del perfil."""
    kind = "completed" if channel == settings.completed_channel else "progress"
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        event_log.record(channel, "ignored", detail="El mensaje no es JSON válido")
        return

    profile_raw, title_raw = payload.get("profileId"), payload.get("titleId")
    try:
        profile_id = int(str(profile_raw).strip())
        title_id = int(str(title_raw).strip())
    except (TypeError, ValueError):
        # User-Service y Catalog-Service usan ids numéricos (bigint en el
        # diagrama entidad-relación). Un id como "profile-42" no corresponde
        # a ningún perfil real.
        event_log.record(
            channel,
            "ignored",
            str(profile_raw),
            str(title_raw),
            detail="profileId y titleId deben ser numéricos (ids de User y Catalog)",
        )
        return

    strength = interaction_strength(
        kind, payload.get("positionSeconds"), payload.get("durationSeconds")
    )

    detail = None
    db = SessionLocal()
    try:
        record_interaction(db, profile_id, title_id, strength, completed=(kind == "completed"))
        try:
            if not ensure_content(db, title_id):
                detail = "El título no existe en Catalog; se guarda la interacción, sin vector"
        except CatalogUnavailable:
            detail = "Catalog no responde: el título se incorporará en la próxima sincronización"
        updated = recompute_profile(db, profile_id)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.exception("Error procesando %s: %s", channel, exc)
        event_log.record(channel, "failed", str(profile_id), str(title_id), strength, str(exc)[:200])
        return
    finally:
        db.close()

    if detail is None:
        detail = "Perfil actualizado" if updated else "Interacción guardada"
    event_log.record(channel, "processed", str(profile_id), str(title_id), strength, detail)


async def run_subscriber() -> None:
    """Se suscribe a los dos canales y reconecta solo si Redis se cae."""
    channels = [settings.progress_channel, settings.completed_channel]
    backoff = 1.0
    while True:
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(*channels)
            event_log.subscriber_state.update(
                connected=True, channels=channels, since=event_log.now(), lastError=None
            )
            logger.info("Suscrito a Redis Pub/Sub: %s", ", ".join(channels))
            backoff = 1.0
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                # El trabajo con la base de datos es síncrono: se hace en un
                # hilo para no bloquear el event loop que atiende HTTP.
                await asyncio.to_thread(handle_event, message["channel"], message["data"])
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            event_log.subscriber_state.update(connected=False, lastError=str(exc)[:200])
            logger.warning("Redis no disponible (%s). Reintentando en %.0f s", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)
        finally:
            event_log.subscriber_state["connected"] = False
            try:
                await pubsub.aclose()
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass
