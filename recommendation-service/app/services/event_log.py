"""
Registro en memoria de los últimos eventos consumidos y del estado de los
procesos en segundo plano. Solo sirve para observar el servicio en vivo
(consola web y /health/ready); no es fuente de verdad de nada, por eso
vive en memoria y se pierde al reiniciar.
"""
from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Optional

_lock = threading.Lock()
_events: deque = deque(maxlen=60)
_counters = {"received": 0, "processed": 0, "ignored": 0, "failed": 0}

subscriber_state: dict[str, Any] = {
    "connected": False,
    "channels": [],
    "since": None,
    "lastError": None,
}

catalog_sync_state: dict[str, Any] = {
    "lastRunAt": None,
    "ok": None,
    "titlesSeen": 0,
    "titlesWithEmbedding": 0,
    "detail": None,
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def record(
    channel: str,
    status: str,
    profile_id: Optional[str] = None,
    title_id: Optional[str] = None,
    strength: Optional[float] = None,
    detail: Optional[str] = None,
) -> None:
    with _lock:
        _counters["received"] += 1
        _counters[status] = _counters.get(status, 0) + 1
        _events.appendleft(
            {
                "at": now(),
                "channel": channel,
                "status": status,
                "profileId": profile_id,
                "titleId": title_id,
                "strength": strength,
                "detail": detail,
            }
        )


def snapshot() -> dict[str, Any]:
    with _lock:
        return {
            "subscriber": dict(subscriber_state),
            "catalogSync": dict(catalog_sync_state),
            "counters": dict(_counters),
            "events": list(_events),
        }
