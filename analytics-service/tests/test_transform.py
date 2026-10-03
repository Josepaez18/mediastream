"""Las métricas del panel, calculadas sin base de datos."""
from datetime import datetime
from decimal import Decimal

from app.etl import transform
from app.etl.transform import AvailabilityRow, TitleRow, WatchProgressRow


def progress(profile, title, episode=None, position=0, duration=None, completed=False, day=1):
    return WatchProgressRow(
        profile_id=profile,
        title_id=title,
        episode_id=episode,
        position_seconds=position,
        duration_seconds=duration,
        completed=completed,
        updated_at=datetime(2026, 10, day, 20, 0),
    )


def test_horas_vistas_suman_por_perfil_y_dia():
    rows = transform.hours_watched_daily(
        [
            progress("1", 10, position=3600, day=1),
            progress("1", 11, episode=5, position=1800, day=1),
            progress("1", 12, position=900, day=2),
            progress("2", 10, position=7200, day=1),
        ]
    )
    assert [(r["profile_id"], r["date"].day, r["hours"]) for r in rows] == [
        ("1", 1, Decimal("1.50")),
        ("1", 2, Decimal("0.25")),
        ("2", 1, Decimal("2.00")),
    ]


def test_horas_vistas_nunca_superan_la_duracion():
    rows = transform.hours_watched_daily([progress("1", 10, position=9000, duration=3600)])
    assert rows[0]["hours"] == Decimal("1.00")


def test_abandono_es_la_fraccion_que_no_termino():
    rows = transform.abandonment_by_episode(
        [
            progress("1", 10, episode=5, completed=True),
            progress("2", 10, episode=5, completed=False),
            progress("3", 10, episode=5, completed=False),
            progress("1", 20, completed=True),  # película: un único "episodio"
        ]
    )
    assert rows == [
        {"title_id": 10, "episode_id": 5, "viewers": 3, "abandoned": 2, "abandonment_rate": Decimal("0.6667")},
        {"title_id": 20, "episode_id": None, "viewers": 1, "abandoned": 0, "abandonment_rate": Decimal("0.0000")},
    ]


def test_popularidad_cuenta_perfiles_distintos_en_cada_region_licenciada():
    rows = transform.popularity_by_region(
        [
            progress("1", 10, episode=1),
            progress("1", 10, episode=2),  # mismo perfil, otro episodio: cuenta una vez
            progress("2", 10, episode=1),
            progress("3", 30),  # título sin licencia registrada: no aparece
        ],
        [AvailabilityRow(10, "co"), AvailabilityRow(10, "MX"), AvailabilityRow(10, "CO"), AvailabilityRow(40, "CO")],
    )
    assert rows == [
        {"title_id": 10, "region": "CO", "views": 2},
        {"title_id": 10, "region": "MX", "views": 2},
    ]


def test_title_dim_copia_los_datos_del_catalogo():
    assert transform.title_dim([TitleRow(2, "B", "SERIES", None), TitleRow(1, "A", "MOVIE", "Drama")]) == [
        {"title_id": 1, "name": "A", "type": "MOVIE", "category": "Drama"},
        {"title_id": 2, "name": "B", "type": "SERIES", "category": None},
    ]


def test_sin_datos_no_hay_filas():
    assert transform.hours_watched_daily([]) == []
    assert transform.abandonment_by_episode([]) == []
    assert transform.popularity_by_region([], []) == []
