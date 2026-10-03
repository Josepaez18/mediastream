"""init analytics schema

Revision ID: 0001_init_analytics
Revises:
Create Date: 2026-10-03

Tablas del diagrama entidad-relación del documento (hours_watched_daily,
abandonment_by_episode, popularity_by_region) más title_dim y etl_run
(justificadas en app/models.py).

Índices, tal como pide el documento (las combinaciones más consultadas en
el panel de KPIs):
  · (profile_id, date) en hours_watched_daily
  · episode_id en abandonment_by_episode
  · (title_id, region) en popularity_by_region
Los tres son únicos: el ETL produce una sola fila por combinación.
"""

import sqlalchemy as sa
from alembic import op

revision = "0001_init_analytics"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hours_watched_daily",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("profile_id", sa.String(64), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("hours", sa.Numeric(10, 2), nullable=False),
        sa.CheckConstraint("hours >= 0", name="ck_hours_watched_daily_hours"),
    )
    op.create_index(
        "idx_hours_watched_daily_profile_date", "hours_watched_daily", ["profile_id", "date"], unique=True
    )

    op.create_table(
        "abandonment_by_episode",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("title_id", sa.BigInteger(), nullable=False),
        sa.Column("episode_id", sa.BigInteger(), nullable=True),
        sa.Column("viewers", sa.Integer(), nullable=False),
        sa.Column("abandoned", sa.Integer(), nullable=False),
        sa.Column("abandonment_rate", sa.Numeric(5, 4), nullable=False),
        sa.CheckConstraint(
            "abandonment_rate BETWEEN 0 AND 1", name="ck_abandonment_by_episode_rate"
        ),
        sa.CheckConstraint("abandoned <= viewers", name="ck_abandonment_by_episode_counts"),
    )
    op.create_index("idx_abandonment_by_episode_episode_id", "abandonment_by_episode", ["episode_id"])
    # Una fila por título+episodio; COALESCE porque las películas no tienen episodio.
    op.execute(
        "CREATE UNIQUE INDEX uq_abandonment_by_episode_title_episode "
        "ON abandonment_by_episode (title_id, COALESCE(episode_id, 0))"
    )

    op.create_table(
        "popularity_by_region",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("title_id", sa.BigInteger(), nullable=False),
        sa.Column("region", sa.String(16), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.CheckConstraint("views >= 0", name="ck_popularity_by_region_views"),
    )
    op.create_index(
        "idx_popularity_by_region_title_region", "popularity_by_region", ["title_id", "region"], unique=True
    )

    op.create_table(
        "title_dim",
        sa.Column("title_id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("type", sa.String(16), nullable=True),
        sa.Column("category", sa.String(100), nullable=True),
    )

    op.create_table(
        "etl_run",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("rows_loaded", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("idx_etl_run_started_at", "etl_run", ["started_at"])


def downgrade() -> None:
    op.drop_table("etl_run")
    op.drop_table("title_dim")
    op.drop_table("popularity_by_region")
    op.drop_table("abandonment_by_episode")
    op.drop_table("hours_watched_daily")
