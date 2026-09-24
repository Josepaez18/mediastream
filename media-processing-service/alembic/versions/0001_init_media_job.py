"""init media_job schema

Revision ID: 0001_init_media_job
Revises:
Create Date: 2026-09-16

Crea la tabla media_job exactamente como está definida en el diagrama
entidad-relación del documento de arquitectura: id, title_id, status,
created_at, updated_at. Sigue el patrón expand/contract: primera
migración, solo agrega la tabla, no modifica nada existente.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_init_media_job"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    media_job_status = postgresql.ENUM(
        "pending", "processing", "completed", "error", name="media_job_status"
    )
    media_job_status.create(op.get_bind())

    op.create_table(
        "media_job",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title_id", sa.String(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending", "processing", "completed", "error",
                name="media_job_status", create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # Índice en title_id: consultar el estado de transcodificación de un título específico
    op.create_index("idx_media_job_title_id", "media_job", ["title_id"])
    # Índice en status: filtrar rápidamente los jobs pendientes, en proceso o con error
    op.create_index("idx_media_job_status", "media_job", ["status"])


def downgrade() -> None:
    op.drop_index("idx_media_job_status", table_name="media_job")
    op.drop_index("idx_media_job_title_id", table_name="media_job")
    op.drop_table("media_job")
    postgresql.ENUM(name="media_job_status").drop(op.get_bind())
