"""Endpoints que no necesitan base de datos, Redis ni Catalog."""
from fastapi.testclient import TestClient

from app.main import app

# Sin "with": no se ejecuta el lifespan (no arranca el suscriptor de Redis
# ni la sincronización con Catalog).
client = TestClient(app)


def test_health_liveness():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "recommendation-service"}


def test_config_js_para_la_consola():
    r = client.get("/config.js")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/javascript")
    assert r.text.startswith("window.MEDIASTREAM_SERVICES = ")


def test_la_consola_se_sirve_en_la_raiz():
    r = client.get("/")
    assert r.status_code == 200
    assert "<script src=\"config.js\"></script>" in r.text
