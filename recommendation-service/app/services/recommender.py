"""
Motor de recomendación híbrido (sección "Recommendation-Service" del
documento): combina filtrado basado en contenido y filtrado colaborativo.

    puntaje = α · contenido + (1 − α) · colaborativo        (α = CONTENT_WEIGHT)

· Contenido: similitud coseno entre el embedding del perfil y el de cada
  título. La calcula pgvector con el operador <=> sobre el índice HNSW.
· Colaborativo: se buscan los K perfiles más parecidos (también con
  pgvector, sobre profile_embedding) y se mira qué vieron. Un título suma
  más cuanto más parecido es el perfil que lo vio y cuanto más fuerte fue
  su interés. Esto recomienda cosas que el contenido solo no encontraría:
  "a quienes les gusta lo mismo que a ti, también vieron esto".
· Arranque en frío: un perfil sin historial todavía no tiene embedding, así
  que recibe lo más visto de la plataforma.

Nunca se recomienda algo que el perfil ya vio.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ContentEmbedding, ProfileEmbedding, ProfileInteraction
from app.services.embeddings import cosine

settings = get_settings()

# Cuántos títulos trae pgvector por similitud de contenido antes de mezclar.
CONTENT_CANDIDATES = 100
# Desde qué fuerza una interacción cuenta como "lo vio" para explicaciones
# y popularidad (0.5 ≈ avanzó la mitad o lo terminó).
WATCHED_THRESHOLD = 0.5
# Desde qué similitud de contenido se explica una sugerencia como
# "se parece a lo que viste".
CONTENT_REASON_MIN = 0.4


def _watched(db: Session, profile_id: int) -> dict[int, float]:
    rows = db.execute(
        select(ProfileInteraction.title_id, ProfileInteraction.strength).where(
            ProfileInteraction.profile_id == profile_id
        )
    ).all()
    return {int(t): float(s) for t, s in rows}


def _profile_embedding(db: Session, profile_id: int):
    return db.execute(
        select(ProfileEmbedding.embedding).where(ProfileEmbedding.profile_id == profile_id)
    ).scalar_one_or_none()


def recommend(
    db: Session, profile_id: int, limit: int = 10, allowed: Optional[set[int]] = None
) -> dict:
    """Recomendaciones para un perfil. `allowed` (si viene) es el conjunto de
    títulos que Catalog permite para la región / control parental."""
    alpha = settings.content_weight
    watched = _watched(db, profile_id)
    profile_emb = _profile_embedding(db, profile_id)

    if profile_emb is None:
        items = _popular(db, watched, limit, allowed)
        strategy = "popular"
    else:
        items = _hybrid(db, profile_id, np.asarray(profile_emb), watched, limit, allowed, alpha)
        strategy = "hybrid"
        if len(items) < limit:
            # Se completa con populares que no hayan salido ya.
            taken = {int(i["titleId"]) for i in items} | set(watched)
            items += _popular(db, {t: 1.0 for t in taken}, limit - len(items), allowed)

    return {
        "profileId": str(profile_id),
        "strategy": strategy,
        "contentWeight": alpha,
        "generatedAt": datetime.now(timezone.utc),
        "items": items[:limit],
    }


def _hybrid(db, profile_id, profile_emb, watched, limit, allowed, alpha) -> list[dict]:
    excluded = list(watched)

    # ---- 1. Contenido: vecinos del perfil en el espacio de títulos (pgvector)
    distance = ContentEmbedding.embedding.cosine_distance(profile_emb)
    query = select(ContentEmbedding.title_id, ContentEmbedding.embedding, distance.label("d"))
    if excluded:
        query = query.where(ContentEmbedding.title_id.notin_(excluded))
    if allowed is not None:
        query = query.where(ContentEmbedding.title_id.in_(sorted(allowed) or [-1]))
    rows = db.execute(query.order_by(distance).limit(CONTENT_CANDIDATES)).all()

    content_score: dict[int, float] = {}
    embeddings: dict[int, np.ndarray] = {}
    for title_id, embedding, d in rows:
        content_score[int(title_id)] = max(0.0, 1.0 - float(d))
        embeddings[int(title_id)] = np.asarray(embedding)

    # ---- 2. Colaborativo: perfiles parecidos (pgvector sobre profile_embedding)
    p_distance = ProfileEmbedding.embedding.cosine_distance(profile_emb)
    neighbors = [
        (int(pid), max(0.0, 1.0 - float(d)))
        for pid, d in db.execute(
            select(ProfileEmbedding.profile_id, p_distance.label("d"))
            .where(ProfileEmbedding.profile_id != profile_id)
            .order_by(p_distance)
            .limit(settings.neighbors)
        ).all()
    ]
    neighbors = [(pid, sim) for pid, sim in neighbors if sim > 0]
    total_sim = sum(sim for _, sim in neighbors)

    collab_num: dict[int, float] = defaultdict(float)
    watchers: dict[int, int] = defaultdict(int)
    if neighbors:
        sim_by_profile = dict(neighbors)
        n_query = select(
            ProfileInteraction.profile_id, ProfileInteraction.title_id, ProfileInteraction.strength
        ).where(ProfileInteraction.profile_id.in_(list(sim_by_profile)))
        if excluded:
            n_query = n_query.where(ProfileInteraction.title_id.notin_(excluded))
        if allowed is not None:
            n_query = n_query.where(ProfileInteraction.title_id.in_(sorted(allowed) or [-1]))
        for pid, title_id, strength in db.execute(n_query).all():
            collab_num[int(title_id)] += sim_by_profile[int(pid)] * float(strength)
            if strength >= WATCHED_THRESHOLD:
                watchers[int(title_id)] += 1
    collab_score = {t: v / total_sim for t, v in collab_num.items()} if total_sim else {}

    # Títulos que solo aparecen por el lado colaborativo: se les calcula
    # también la similitud de contenido, si tienen embedding.
    missing = [t for t in collab_score if t not in content_score]
    if missing:
        for title_id, embedding in db.execute(
            select(ContentEmbedding.title_id, ContentEmbedding.embedding).where(
                ContentEmbedding.title_id.in_(missing)
            )
        ).all():
            embeddings[int(title_id)] = np.asarray(embedding)
            content_score[int(title_id)] = max(0.0, cosine(profile_emb, embedding))

    # Embeddings de lo que el perfil ya vio, para explicar cada sugerencia.
    watched_embs = {
        int(t): np.asarray(e)
        for t, e in db.execute(
            select(ContentEmbedding.title_id, ContentEmbedding.embedding).where(
                ContentEmbedding.title_id.in_(excluded or [-1])
            )
        ).all()
    }

    items = []
    for title_id in set(content_score) | set(collab_score):
        c = content_score.get(title_id, 0.0)
        k = collab_score.get(title_id, 0.0)
        score = alpha * c + (1 - alpha) * k
        items.append(
            {
                "titleId": str(title_id),
                "score": round(score, 4),
                "contentScore": round(c, 4),
                "collaborativeScore": round(k, 4),
                "reason": _reason(
                    c, alpha * c, (1 - alpha) * k, watchers.get(title_id, 0),
                    embeddings.get(title_id), watched_embs, watched,
                ),
            }
        )
    items.sort(key=lambda i: (-i["score"], int(i["titleId"])))
    return items[:limit]


def _reason(content, content_part, collab_part, n_watchers, embedding, watched_embs, watched):
    """Explica por qué se sugiere un título, sin exagerar: solo se dice
    "se parece a X" si la similitud de contenido es de verdad alta."""
    if n_watchers > 0 and (collab_part > content_part or content < CONTENT_REASON_MIN):
        return {"kind": "collaborative", "similarProfiles": n_watchers}
    if content >= CONTENT_REASON_MIN and embedding is not None and watched_embs:
        based_on = max(
            watched_embs,
            key=lambda w: watched.get(w, 0.0) * cosine(embedding, watched_embs[w]),
        )
        return {"kind": "content", "basedOnTitleId": str(based_on)}
    return {"kind": "discovery"}


def _popular(db: Session, excluded: dict[int, float], limit: int, allowed) -> list[dict]:
    """Lo más visto (perfiles distintos que lo vieron de verdad), y si no
    alcanza, títulos del catálogo que todavía nadie ha visto."""
    if limit <= 0:
        return []
    views = func.count(func.distinct(ProfileInteraction.profile_id)).label("views")
    query = (
        select(ProfileInteraction.title_id, views)
        .where(ProfileInteraction.strength >= WATCHED_THRESHOLD)
        .group_by(ProfileInteraction.title_id)
    )
    if excluded:
        query = query.where(ProfileInteraction.title_id.notin_(list(excluded)))
    if allowed is not None:
        query = query.where(ProfileInteraction.title_id.in_(sorted(allowed) or [-1]))
    rows = db.execute(query.order_by(views.desc(), ProfileInteraction.title_id).limit(limit)).all()

    top = max((int(v) for _, v in rows), default=1)
    items = [
        {
            "titleId": str(t),
            "score": round(int(v) / top, 4),
            "contentScore": 0.0,
            "collaborativeScore": 0.0,
            "reason": {"kind": "popular", "views": int(v)},
        }
        for t, v in rows
    ]

    if len(items) < limit:
        taken = set(excluded) | {int(i["titleId"]) for i in items}
        fill = select(ContentEmbedding.title_id)
        if taken:
            fill = fill.where(ContentEmbedding.title_id.notin_(list(taken)))
        if allowed is not None:
            fill = fill.where(ContentEmbedding.title_id.in_(sorted(allowed) or [-1]))
        for (t,) in db.execute(
            fill.order_by(ContentEmbedding.updated_at.desc()).limit(limit - len(items))
        ).all():
            items.append(
                {
                    "titleId": str(t),
                    "score": 0.0,
                    "contentScore": 0.0,
                    "collaborativeScore": 0.0,
                    "reason": {"kind": "catalog"},
                }
            )
    return items


def similar_titles(db: Session, title_id: int, limit: int = 8) -> Optional[list[dict]]:
    """Títulos más parecidos por contenido (pgvector). None si el título no
    tiene embedding todavía."""
    embedding = db.execute(
        select(ContentEmbedding.embedding).where(ContentEmbedding.title_id == title_id)
    ).scalar_one_or_none()
    if embedding is None:
        return None
    distance = ContentEmbedding.embedding.cosine_distance(embedding)
    rows = db.execute(
        select(ContentEmbedding.title_id, distance.label("d"))
        .where(ContentEmbedding.title_id != title_id)
        .order_by(distance)
        .limit(limit)
    ).all()
    return [{"titleId": str(t), "similarity": round(max(0.0, 1.0 - float(d)), 4)} for t, d in rows]


def profile_snapshot(db: Session, profile_id: int) -> dict:
    """Estado del modelo de un perfil: historial, vector y perfiles parecidos."""
    emb_row = db.execute(
        select(ProfileEmbedding.embedding, ProfileEmbedding.updated_at).where(
            ProfileEmbedding.profile_id == profile_id
        )
    ).first()
    interactions = db.execute(
        select(
            ProfileInteraction.title_id,
            ProfileInteraction.strength,
            ProfileInteraction.completed,
            ProfileInteraction.updated_at,
        )
        .where(ProfileInteraction.profile_id == profile_id)
        .order_by(ProfileInteraction.updated_at.desc())
    ).all()

    similar: list[dict] = []
    if emb_row is not None:
        distance = ProfileEmbedding.embedding.cosine_distance(emb_row.embedding)
        similar = [
            {"profileId": str(pid), "similarity": round(max(0.0, 1.0 - float(d)), 4)}
            for pid, d in db.execute(
                select(ProfileEmbedding.profile_id, distance.label("d"))
                .where(ProfileEmbedding.profile_id != profile_id)
                .order_by(distance)
                .limit(5)
            ).all()
        ]

    return {
        "profileId": str(profile_id),
        "hasEmbedding": emb_row is not None,
        "embeddingUpdatedAt": emb_row.updated_at if emb_row is not None else None,
        "interactions": [
            {
                "titleId": str(t),
                "strength": round(float(s), 3),
                "completed": bool(c),
                "updatedAt": u,
            }
            for t, s, c, u in interactions
        ],
        "similarProfiles": similar,
    }
