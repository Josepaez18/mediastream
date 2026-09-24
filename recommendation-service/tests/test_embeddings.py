"""Tests del modelo de embeddings (no necesitan base de datos ni Redis).

Ejecutar:  pip install -r requirements-dev.txt && pytest
"""
import numpy as np

from app.services.embeddings import (
    DIM,
    age_group,
    content_vector,
    cosine,
    interaction_strength,
    profile_vector,
    split_genres,
)

ACCION_1 = {
    "name": "El Último Meridiano", "type": "MOVIE", "category": "Acción", "ageRating": "PG-13",
    "synopsis": "Una piloto retirada debe cruzar una zona en cuarentena para entregar una cura.",
}
ACCION_2 = {
    "name": "Frontera de Acero", "type": "MOVIE", "category": "Accion", "ageRating": "PG-13",
    "synopsis": "Un piloto de rescate atraviesa una frontera militarizada para evacuar a su hermana.",
}
DRAMA = {
    "name": "Las Horas del Faro", "type": "MOVIE", "category": "Drama", "ageRating": "PG-13",
    "synopsis": "Un farero viudo y su nieta reconstruyen su relación durante el último invierno.",
}
INFANTIL = {
    "name": "Pip y el Dragón de Papel", "type": "MOVIE", "category": "Animación", "ageRating": "G",
    "synopsis": "Una niña dibuja un dragón que cobra vida.",
}


def test_vector_unitario_y_de_64_dimensiones():
    v = content_vector(ACCION_1)
    assert v.shape == (DIM,)
    assert abs(float(np.linalg.norm(v)) - 1.0) < 1e-5


def test_es_determinista():
    # Los vectores se guardan en la base: deben salir idénticos en cada proceso.
    assert np.array_equal(content_vector(ACCION_1), content_vector(ACCION_1))


def test_misma_categoria_se_parece_mas_que_distinta():
    same = cosine(content_vector(ACCION_1), content_vector(ACCION_2))
    other = cosine(content_vector(ACCION_1), content_vector(DRAMA))
    assert same > 0.8
    assert other < 0.4
    assert same > other


def test_tildes_mayusculas_y_sinonimos_no_importan():
    assert split_genres("Acción") == split_genres("accion") == ["accion"]
    assert split_genres("Sci-Fi") == ["ciencia ficcion"]
    assert split_genres("Acción y Aventura") == ["accion", "aventura"]


def test_clasificacion_por_edad():
    assert age_group("G") == 0
    assert age_group("PG-13") == 1
    assert age_group("R") == 2
    assert age_group(None) == 3


def test_fuerza_de_la_interaccion():
    assert interaction_strength("completed", 10, 100) == 1.0
    assert interaction_strength("progress", 0, 100) == 0.25
    assert interaction_strength("progress", 50, 100) == 0.5
    assert interaction_strength("progress", 100, 100) == 0.75
    assert interaction_strength("progress", None, None) == 0.4


def test_vector_de_perfil_sigue_lo_que_mas_le_gusto():
    a, d, k = content_vector(ACCION_1), content_vector(DRAMA), content_vector(INFANTIL)
    perfil = profile_vector([(1.0, a), (0.3, d)])
    assert cosine(perfil, a) > cosine(perfil, d) > cosine(perfil, k)


def test_perfil_sin_historial_no_tiene_vector():
    assert profile_vector([]) is None
    assert profile_vector([(0.0, content_vector(DRAMA))]) is None
