"""Endpoints que no necesitan base de datos ni RabbitMQ."""
from fastapi.testclient import TestClient

from app.main import app

# Sin "with": no se ejecuta el lifespan (no se conecta a RabbitMQ).
client = TestClient(app)


def test_health_liveness():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "media-processing-service"}


def test_config_js_para_la_consola():
    r = client.get("/config.js")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/javascript")
    assert r.text.startswith("window.MEDIASTREAM_SERVICES = ")


def test_la_pagina_de_aviso_se_sirve_en_la_raiz():
    # Ya no hay consola interactiva por servicio (un solo frontend la
    # reemplaza): la raíz sirve un aviso estático que enlaza a /docs y a la
    # app unificada.
    r = client.get("/")
    assert r.status_code == 200
    assert "Este microservicio es solo backend" in r.text


def test_job_con_id_invalido_responde_422():
    assert client.get("/api/media/jobs/no-es-un-uuid").status_code == 422
