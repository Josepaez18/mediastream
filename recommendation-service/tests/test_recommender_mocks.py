"""Pruebas unitarias con mocks: la lógica del servicio corre de verdad y solo
se simulan las dependencias externas (la sesión de PostgreSQL/pgvector y la
llamada HTTP a Catalog-Service)."""
import json
from unittest.mock import MagicMock, patch

import httpx
import numpy as np
from sqlalchemy.dialects import postgresql

from app.services import event_log, recommender
from app.workers import playback_events


def _resultado(filas=None, escalar=None):
    """Lo que devolvería session.execute(...) en SQLAlchemy."""
    resultado = MagicMock()
    resultado.all.return_value = filas or []
    resultado.scalar_one_or_none.return_value = escalar
    return resultado


def test_evento_con_catalog_caido_guarda_la_interaccion_y_no_se_pierde(monkeypatch):
    # Base de datos: el título 3 todavía no tiene embedding y el perfil no
    # tiene otros títulos con vector.
    session = MagicMock()
    session.execute.return_value = _resultado(filas=[], escalar=None)
    monkeypatch.setattr(playback_events, "SessionLocal", lambda: session)

    caido = httpx.ConnectError("connection refused")
    with (
        patch("app.services.catalog_client.httpx.get", side_effect=caido) as catalog_get,
        patch("app.services.catalog_client.time.sleep") as espera,
    ):
        playback_events.handle_event(
            "playback.progress",
            json.dumps({"profileId": "7", "titleId": "3", "positionSeconds": 3600, "durationSeconds": 7200}),
        )

    # Se pidió el título a Catalog: 1 intento + 2 reintentos con backoff exponencial.
    assert catalog_get.call_count == 3
    assert catalog_get.call_args.args[0].endswith("/api/catalog/titles/3")
    assert [c.args[0] for c in espera.call_args_list] == [0.2, 0.4]

    # La interacción se guardó igual: vio la mitad del título → fuerza 0.5.
    insert = session.execute.call_args_list[0].args[0]
    assert insert.table.name == "profile_interaction"
    params = insert.compile(dialect=postgresql.dialect()).params
    assert (params["profile_id"], params["title_id"]) == (7, 3)
    assert params["strength"] == 0.5
    assert params["completed"] is False

    session.commit.assert_called_once()
    session.rollback.assert_not_called()
    session.close.assert_called_once()

    ultimo = event_log.snapshot()["events"][0]
    assert ultimo["status"] == "processed"
    assert (ultimo["profileId"], ultimo["titleId"], ultimo["strength"]) == ("7", "3", 0.5)
    assert ultimo["detail"].startswith("Catalog no responde")


def test_hibrido_el_colaborativo_sube_un_titulo_por_encima_del_de_contenido(monkeypatch):
    monkeypatch.setattr(recommender.settings, "content_weight", 0.6)
    perfil = np.full(64, 0.125, dtype=np.float32)
    e1, e10, e11 = (np.eye(64, dtype=np.float32)[i] for i in (1, 10, 11))

    # Respuestas de PostgreSQL/pgvector, en el orden en que recommend() consulta.
    session = MagicMock()
    session.execute.side_effect = [
        _resultado(filas=[(1, 1.0)]),  # el perfil 7 ya terminó el título 1
        _resultado(escalar=perfil),  # su embedding
        _resultado(filas=[(10, e10, 0.2), (11, e11, 0.5)]),  # títulos cercanos (distancia coseno)
        _resultado(filas=[(2, 0.1)]),  # perfil parecido: el 2, similitud 0.9
        _resultado(filas=[(2, 11, 1.0)]),  # el perfil 2 terminó el título 11
        _resultado(filas=[(1, e1)]),  # embeddings de lo ya visto (para explicar)
    ]

    result = recommender.recommend(session, profile_id=7, limit=2)

    assert result["strategy"] == "hybrid"
    assert result["profileId"] == "7"
    assert result["contentWeight"] == 0.6
    # 0.6 · contenido + 0.4 · colaborativo:
    #   título 10 → 0.6 · 0.8 + 0.4 · 0.0 = 0.48
    #   título 11 → 0.6 · 0.5 + 0.4 · 1.0 = 0.70  (el perfil parecido lo terminó)
    assert result["items"] == [
        {
            "titleId": "11",
            "score": 0.7,
            "contentScore": 0.5,
            "collaborativeScore": 1.0,
            "reason": {"kind": "collaborative", "similarProfiles": 1},
        },
        {
            "titleId": "10",
            "score": 0.48,
            "contentScore": 0.8,
            "collaborativeScore": 0.0,
            "reason": {"kind": "content", "basedOnTitleId": "1"},
        },
    ]
    # Lo que ya vio no se vuelve a recomendar: la consulta de contenido lo excluye.
    consulta = session.execute.call_args_list[2].args[0]
    assert "content_embedding.title_id NOT IN" in str(consulta.compile(dialect=postgresql.dialect()))
    assert session.execute.call_count == 6
