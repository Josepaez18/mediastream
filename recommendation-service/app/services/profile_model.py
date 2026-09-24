"""
Actualización del modelo: interacciones, embeddings de contenido y
embeddings de perfil. Todas las funciones reciben la sesión y NO hacen
commit: quien llama decide el límite de la transacción.
"""
from __future__ import annotations

import logging
from typing import Mapping, Optional

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import ContentEmbedding, ProfileEmbedding, ProfileInteraction
from app.services.catalog_client import catalog_client
from app.services.embeddings import content_vector, profile_vector

logger = logging.getLogger(__name__)


def record_interaction(
    db: Session, profile_id: int, title_id: int, strength: float, completed: bool
) -> None:
    """Guarda la señal más fuerte vista hasta ahora para ese perfil y título:
    volver a ver el inicio de algo que ya se terminó no borra el interés."""
    stmt = insert(ProfileInteraction).values(
        profile_id=profile_id, title_id=title_id, strength=strength, completed=completed
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_profile_interaction_profile_title",
        set_={
            "strength": func.greatest(ProfileInteraction.strength, stmt.excluded.strength),
            "completed": ProfileInteraction.completed | stmt.excluded.completed,
            "updated_at": func.now(),
        },
    )
    db.execute(stmt)


def ensure_content(
    db: Session, title_id: int, meta: Optional[Mapping[str, object]] = None
) -> bool:
    """
    Garantiza que el título tenga embedding. Devuelve True si al terminar lo
    tiene. Si no se pasan metadatos y el título ya tiene vector, no llama a
    Catalog (los eventos de progreso llegan cada pocos segundos). Puede
    lanzar CatalogUnavailable.
    """
    existing = db.execute(
        select(ContentEmbedding).where(ContentEmbedding.title_id == title_id)
    ).scalar_one_or_none()

    if meta is None:
        if existing is not None:
            return True
        meta = catalog_client.get_title(title_id)
        if meta is None:
            logger.warning("El título %s no existe en Catalog-Service", title_id)
            return False

    vector = content_vector(meta)
    if existing is not None and np.allclose(np.asarray(existing.embedding), vector, atol=1e-6):
        return True

    # Upsert atómico: la sincronización con Catalog y el consumidor de
    # eventos corren en hilos distintos y pueden llegar al mismo título a
    # la vez; así ninguno choca con la restricción de unicidad.
    stmt = insert(ContentEmbedding).values(title_id=title_id, embedding=vector)
    stmt = stmt.on_conflict_do_update(
        index_elements=[ContentEmbedding.title_id],
        set_={"embedding": stmt.excluded.embedding, "updated_at": func.now()},
    )
    db.execute(stmt)

    # Consistencia eventual: los perfiles que ya habían visto este título
    # (quizás mientras Catalog estaba caído) se recalculan ahora.
    for profile_id in profiles_that_watched(db, title_id):
        recompute_profile(db, profile_id)
    return True


def profiles_that_watched(db: Session, title_id: int) -> list[int]:
    return list(
        db.execute(
            select(ProfileInteraction.profile_id).where(ProfileInteraction.title_id == title_id)
        ).scalars()
    )


def recompute_profile(db: Session, profile_id: int) -> bool:
    """Recalcula el embedding del perfil a partir de TODAS sus interacciones
    con títulos que ya tienen embedding. Devuelve True si quedó con vector."""
    rows = db.execute(
        select(ProfileInteraction.strength, ContentEmbedding.embedding)
        .join(ContentEmbedding, ContentEmbedding.title_id == ProfileInteraction.title_id)
        .where(ProfileInteraction.profile_id == profile_id)
    ).all()
    vector = profile_vector((strength, embedding) for strength, embedding in rows)
    if vector is None:
        return False

    stmt = insert(ProfileEmbedding).values(profile_id=profile_id, embedding=vector)
    stmt = stmt.on_conflict_do_update(
        index_elements=[ProfileEmbedding.profile_id],
        set_={"embedding": stmt.excluded.embedding, "updated_at": func.now()},
    )
    db.execute(stmt)
    return True
