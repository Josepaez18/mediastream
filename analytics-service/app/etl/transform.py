"""
Transformaciones del ETL: funciones puras que convierten las filas leídas
de las réplicas en las filas de las tablas de KPIs. No tocan ninguna base,
así que se prueban sin PostgreSQL (tests/test_transform.py).

Definiciones de las métricas (sección 3 del documento):

  horas vistas por día   Por perfil y día (fecha de la última actualización
                         del progreso), la suma de lo visto de cada título o
                         episodio, en horas. Playback guarda la posición, no
                         cada sesión: si alguien retrocede, cuenta lo que
                         llegó a ver, nunca más que la duración.

  tasa de abandono       Por título y episodio: de los perfiles que lo
                         empezaron, qué fracción no lo terminó (completed =
                         false en Playback). Las películas cuentan como un
                         único episodio (episode_id NULL).

  popularidad por región Por título, cuántos perfiles distintos lo vieron,
                         en cada región donde Catalog lo tiene licenciado.
                         Playback no registra desde qué región se vio, así
                         que la región es la del acuerdo de licencia.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class WatchProgressRow:
    """Fila de watch_progress (réplica de Playback-DB)."""

    profile_id: str
    title_id: int
    episode_id: int | None
    position_seconds: int
    duration_seconds: int | None
    completed: bool
    updated_at: datetime


@dataclass(frozen=True)
class TitleRow:
    """Fila de title (réplica de Catalog-DB)."""

    id: int
    name: str
    type: str | None
    category: str | None


@dataclass(frozen=True)
class AvailabilityRow:
    """Región donde un título tiene (o tuvo) licencia (réplica de Catalog-DB)."""

    title_id: int
    region: str


def _watched_seconds(row: WatchProgressRow) -> int:
    seconds = max(row.position_seconds, 0)
    if row.duration_seconds:
        seconds = min(seconds, row.duration_seconds)
    return seconds


def _round(value: Decimal, places: str) -> Decimal:
    return value.quantize(Decimal(places), rounding=ROUND_HALF_UP)


def hours_watched_daily(progress: list[WatchProgressRow]) -> list[dict]:
    seconds: dict[tuple[str, date], int] = defaultdict(int)
    for row in progress:
        seconds[(row.profile_id, row.updated_at.date())] += _watched_seconds(row)
    return [
        {"profile_id": profile_id, "date": day, "hours": _round(Decimal(total) / 3600, "0.01")}
        for (profile_id, day), total in sorted(seconds.items())
    ]


def abandonment_by_episode(progress: list[WatchProgressRow]) -> list[dict]:
    viewers: dict[tuple[int, int | None], set[str]] = defaultdict(set)
    finished: dict[tuple[int, int | None], set[str]] = defaultdict(set)
    for row in progress:
        key = (row.title_id, row.episode_id)
        viewers[key].add(row.profile_id)
        if row.completed:
            finished[key].add(row.profile_id)

    rows = []
    for (title_id, episode_id), profiles in sorted(viewers.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0)):
        total = len(profiles)
        abandoned = total - len(finished[(title_id, episode_id)])
        rows.append(
            {
                "title_id": title_id,
                "episode_id": episode_id,
                "viewers": total,
                "abandoned": abandoned,
                "abandonment_rate": _round(Decimal(abandoned) / total, "0.0001"),
            }
        )
    return rows


def popularity_by_region(
    progress: list[WatchProgressRow], availability: list[AvailabilityRow]
) -> list[dict]:
    viewers: dict[int, set[str]] = defaultdict(set)
    for row in progress:
        viewers[row.title_id].add(row.profile_id)

    regions: dict[int, set[str]] = defaultdict(set)
    for row in availability:
        if row.region and row.region.strip():
            regions[row.title_id].add(row.region.strip().upper())

    return [
        {"title_id": title_id, "region": region, "views": len(viewers[title_id])}
        for title_id in sorted(viewers)
        for region in sorted(regions[title_id])
    ]


def title_dim(titles: list[TitleRow]) -> list[dict]:
    return [
        {"title_id": t.id, "name": t.name, "type": t.type, "category": t.category}
        for t in sorted(titles, key=lambda t: t.id)
    ]
