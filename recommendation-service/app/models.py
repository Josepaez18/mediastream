"""
Modelo de datos de Recommendation-Service, alineado al diagrama
entidad-relación del documento de arquitectura (sección 5):

    CONTENT_EMBEDDING(id bigint PK, title_id bigint, embedding vector)
    PROFILE_EMBEDDING(id bigint PK, profile_id bigint, embedding vector)

title_id y profile_id son referencias lógicas a Catalog-Service y a
User-Service: no hay llaves foráneas, porque cada microservicio tiene su
propia base de datos (database-per-service).

EXTENSIÓN JUSTIFICADA — PROFILE_INTERACTION: el diagrama entregado solo
tiene los dos vectores. Pero el documento pide dos cosas que no se pueden
hacer solo con ellos:
  1. Filtrado colaborativo ("usuarios similares"): hay que saber QUÉ vio
     cada perfil parecido, no solo hacia dónde apunta su vector.
  2. No recomendar lo que el perfil ya vio.
Además, el vector de un perfil se recalcula a partir de sus interacciones;
sin guardarlas, cada evento tendría que mezclarse a ciegas con el vector
anterior y no se podría corregir. Por eso se agrega esta tabla mínima.
"""
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    UniqueConstraint,
    func,
)

from app.database import Base

# Dimensión de todos los embeddings (ver app/services/embeddings.py).
EMBEDDING_DIM = 64


class ContentEmbedding(Base):
    __tablename__ = "content_embedding"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # Único: cada título tiene un solo vector en un momento dado.
    title_id = Column(BigInteger, nullable=False, unique=True, index=True)
    embedding = Column(Vector(EMBEDDING_DIM), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ProfileEmbedding(Base):
    __tablename__ = "profile_embedding"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # Único: cada perfil tiene un solo vector en un momento dado.
    profile_id = Column(BigInteger, nullable=False, unique=True, index=True)
    embedding = Column(Vector(EMBEDDING_DIM), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ProfileInteraction(Base):
    """Señal de interés de un perfil por un título (extensión justificada)."""

    __tablename__ = "profile_interaction"
    __table_args__ = (
        # Una sola fila por perfil y título; la unicidad también sirve de
        # índice para "¿qué vio este perfil?".
        UniqueConstraint("profile_id", "title_id", name="uq_profile_interaction_profile_title"),
        # "¿Quién vio este título?" (popularidad y recalcular perfiles).
        Index("idx_profile_interaction_title_id", "title_id"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    profile_id = Column(BigInteger, nullable=False)
    title_id = Column(BigInteger, nullable=False)
    # 0..1: cuánto indica interés. Un avance parcial pesa menos que terminar.
    strength = Column(Float, nullable=False)
    completed = Column(Boolean, nullable=False, default=False, server_default="false")
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
