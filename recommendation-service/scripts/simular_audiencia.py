"""
Simula la actividad de muchos usuarios publicando playback.completed y
playback.progress en Redis, exactamente con el formato que usa
Playback-Service. Recommendation-Service los consume por el camino normal
(no se escribe nada directo en su base de datos).

Sin esto, un solo perfil no alcanza para mostrar filtrado colaborativo:
"usuarios parecidos" necesita que existan otros usuarios.

Cómo se arma la audiencia (determinista, siempre la misma):
  · Se crean perfiles sintéticos 9001, 9002, … (ids que no chocan con los
    perfiles reales de User-Service), repartidos entre las categorías del
    catálogo como "género favorito".
  · Cada uno termina 2–3 títulos de su género favorito.
  · Además, la mayoría termina un título "compañero" de OTRO género (por
    ejemplo, a quienes les gusta la acción también les gusta la ciencia
    ficción). Esa correlación es la que el filtrado colaborativo descubre
    y el filtrado por contenido, por sí solo, no vería.

Uso (desde la carpeta MediaStream):
  docker compose exec recommendation-service python scripts/simular_audiencia.py
"""
import json
import os
import random
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone

import httpx
import redis

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
CATALOG_URL = os.environ.get("CATALOG_SERVICE_URL", "http://localhost:3002").rstrip("/")
PROGRESS_CHANNEL = os.environ.get("PROGRESS_CHANNEL", "playback.progress")
COMPLETED_CHANNEL = os.environ.get("COMPLETED_CHANNEL", "playback.completed")
REGION = os.environ.get("REGION", "CO")
FIRST_PROFILE_ID = 9001
DURATION = 5400

# Afinidades entre géneros (si ambos existen en el catálogo).
COMPANIONS = {
    "accion": "ciencia ficcion",
    "ciencia ficcion": "accion",
    "drama": "documental",
    "documental": "drama",
    "comedia": "animacion",
    "animacion": "infantil",
    "infantil": "animacion",
}


def norm(text):
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower().strip()


def main():
    try:
        response = httpx.get(
            f"{CATALOG_URL}/api/catalog/titles", params={"region": REGION}, timeout=5, trust_env=False
        )
        response.raise_for_status()
        titles = response.json()
    except httpx.HTTPError as exc:
        sys.exit(f"No se pudo leer el catálogo en {CATALOG_URL} ({exc}). ¿Está corriendo Catalog-Service?")

    if len(titles) < 4:
        sys.exit(
            f"El catálogo tiene {len(titles)} títulos disponibles en {REGION}; hacen falta al menos 4.\n"
            "Carga los de demostración con:\n"
            "  docker compose exec catalog-service node scripts/cargar-titulos-demo.js"
        )

    by_category = defaultdict(list)
    names = {}
    for t in sorted(titles, key=lambda t: int(t["id"])):
        by_category[norm(t.get("category")) or "sin categoria"].append(int(t["id"]))
        names[int(t["id"])] = t["name"]
    categories = sorted(by_category)

    def companion_title(category):
        target = COMPANIONS.get(category)
        if target not in by_category:
            target = categories[(categories.index(category) + 1) % len(categories)]
        return by_category[target][0] if target != category else None

    rnd = random.Random(7)
    n_profiles = min(18, max(9, len(categories) * 3))
    client = redis.Redis.from_url(REDIS_URL)
    client.ping()

    print(f"Catálogo ({REGION}): {len(titles)} títulos en {len(categories)} categorías.")
    print(f"Publicando la actividad de {n_profiles} perfiles simulados en Redis...\n")

    published = 0
    for i in range(n_profiles):
        profile_id = FIRST_PROFILE_ID + i
        favorite = categories[i % len(categories)]
        pool = by_category[favorite]
        watched = rnd.sample(pool, k=min(len(pool), rnd.choice([2, 3])))
        extra = companion_title(favorite)
        if extra is not None and extra not in watched and rnd.random() < 0.85:
            watched.append(extra)

        events = [(COMPLETED_CHANNEL, t, 0.97) for t in watched]
        others = [t for t in names if t not in watched]
        if others and rnd.random() < 0.35:
            events.append((PROGRESS_CHANNEL, rnd.choice(others), rnd.uniform(0.2, 0.5)))

        for channel, title_id, fraction in events:
            payload = {
                "profileId": str(profile_id),
                "titleId": str(title_id),
                "episodeId": None,
                "positionSeconds": int(DURATION * fraction),
                "durationSeconds": DURATION,
                "occurredAt": datetime.now(timezone.utc).isoformat(),
            }
            client.publish(channel, json.dumps(payload))
            published += 1
            time.sleep(0.04)

        vistos = ", ".join(names[t] for t in watched)
        print(f"  perfil {profile_id}  ·  le gusta {favorite:<16} ·  vio: {vistos}")

    print(f"\nListo: {published} eventos publicados en {PROGRESS_CHANNEL} / {COMPLETED_CHANNEL}.")
    print("Mira cómo llegan en la consola de Recommendation, pestaña Eventos.")


if __name__ == "__main__":
    main()
