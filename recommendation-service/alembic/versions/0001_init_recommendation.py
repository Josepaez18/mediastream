"""init recommendation schema (pgvector)

Revision ID: 0001_init_recommendation
Revises:
Create Date: 2026-09-22

Crea las tablas del diagrama entidad-relación del documento de arquitectura
(content_embedding y profile_embedding) sobre PostgreSQL con la extensión
pgvector, más la tabla profile_interaction (extensión justificada en
app/models.py).

Índices, tal como pide el documento:
  · title_id en content_embedding y profile_id en profile_embedding (únicos)
  · el índice vectorial propio de pgvector (HNSW, distancia coseno) en cada
    columna embedding, para acelerar las búsquedas por similitud.
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "0001_init_recommendation"
down_revision = None
branch_labels = None
depends_on = None

DIM = 64


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ---------------------------------------------------- content_embedding
    op.create_table(
        "content_embedding",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("title_id", sa.BigInteger(), nullable=False),
        sa.Column("embedding", Vector(DIM), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )
    op.create_index(
        "idx_content_embedding_title_id", "content_embedding", ["title_id"], unique=True
    )
    op.execute(
        "CREATE INDEX idx_content_embedding_vector ON content_embedding "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # ---------------------------------------------------- profile_embedding
    op.create_table(
        "profile_embedding",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("profile_id", sa.BigInteger(), nullable=False),
        sa.Column("embedding", Vector(DIM), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )
    op.create_index(
        "idx_profile_embedding_profile_id", "profile_embedding", ["profile_id"], unique=True
    )
    op.execute(
        "CREATE INDEX idx_profile_embedding_vector ON profile_embedding "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # -------------------------------------------- profile_interaction (extensión)
    op.create_table(
        "profile_interaction",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("profile_id", sa.BigInteger(), nullable=False),
        sa.Column("title_id", sa.BigInteger(), nullable=False),
        sa.Column("strength", sa.Float(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.UniqueConstraint("profile_id", "title_id", name="uq_profile_interaction_profile_title"),
    )
    op.create_index("idx_profile_interaction_title_id", "profile_interaction", ["title_id"])


def downgrade() -> None:
    op.drop_table("profile_interaction")
    op.drop_table("profile_embedding")
    op.drop_table("content_embedding")
