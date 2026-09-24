import json

from fastapi import APIRouter
from fastapi.responses import Response

from app.config import get_settings

router = APIRouter(include_in_schema=False)


@router.get("/config.js")
def console_config():
    """Le dice a la consola web dónde están los otros servicios (en Render,
    cada uno en su propio dominio). Vacío = la consola usa localhost:puerto."""
    body = f"window.MEDIASTREAM_SERVICES = {json.dumps(get_settings().public_service_urls)};\n"
    return Response(
        content=body,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )
