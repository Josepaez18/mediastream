"""
Embeddings de contenido y de perfil.

Cada título se representa como un vector de 64 dimensiones construido a
partir de los metadatos que expone Catalog-Service. Es un modelo deliberado
y explicable (feature engineering + feature hashing), no una caja negra:

    dimensiones  bloque           qué captura                         peso
    0  – 31      categoría        género(s): acción, drama, comedia…  1.00
    32 – 35      tipo             película o serie                    0.30
    36 – 39      clasificación    infantil / adolescente / adulto     0.35
    40 – 63      texto            palabras del nombre y la sinopsis   0.45

La categoría pesa más porque es la señal más fuerte de gusto; la sinopsis
aporta matices (dos títulos de acción que hablan de "pilotos" se parecen
más entre sí). El vector final se normaliza (norma 1), así que la
similitud coseno que calcula pgvector compara solo la "dirección" del
gusto, no la cantidad de metadatos.

El embedding de un PERFIL es el promedio ponderado de los embeddings de
lo que vio, donde el peso es la fuerza de la interacción (terminar un
título pesa más que abandonarlo a la mitad). Así el perfil queda en el
mismo espacio que los títulos y se pueden comparar directamente.

Se podría reemplazar por un modelo entrenado (scikit-learn, TensorFlow)
sin tocar las tablas ni la API: basta con que produzca vectores de 64
dimensiones.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Iterable, Mapping, Optional

import numpy as np

DIM = 64

CATEGORY = slice(0, 32)
TYPE_OFFSET = 32
AGE_OFFSET = 36
TEXT = slice(40, 64)
TEXT_SIZE = TEXT.stop - TEXT.start

W_CATEGORY = 1.0
W_TYPE = 0.30
W_AGE = 0.35
W_TEXT = 0.45

# Géneros conocidos: cada uno tiene una dimensión propia dentro del bloque
# de categoría, así dos géneros distintos nunca se confunden. Un género
# desconocido se reparte en 3 dimensiones por hashing (ver _category_slots).
KNOWN_GENRES = [
    "accion", "aventura", "animacion", "comedia", "crimen", "documental",
    "drama", "familia", "fantasia", "terror", "misterio", "romance",
    "ciencia ficcion", "suspenso", "musical", "infantil", "historia",
    "guerra", "deporte", "western", "biografia", "reality",
]
_GENRE_INDEX = {g: i for i, g in enumerate(KNOWN_GENRES)}

SYNONYMS = {
    "action": "accion",
    "adventure": "aventura",
    "animation": "animacion",
    "anime": "animacion",
    "comedy": "comedia",
    "crime": "crimen",
    "policial": "crimen",
    "documentary": "documental",
    "family": "familia",
    "fantasy": "fantasia",
    "horror": "terror",
    "mystery": "misterio",
    "romantica": "romance",
    "sci-fi": "ciencia ficcion",
    "scifi": "ciencia ficcion",
    "science fiction": "ciencia ficcion",
    "ciencia-ficcion": "ciencia ficcion",
    "thriller": "suspenso",
    "kids": "infantil",
    "ninos": "infantil",
    "history": "historia",
    "war": "guerra",
    "sports": "deporte",
    "deportes": "deporte",
}

KIDS_RATINGS = {"G", "PG", "TP", "ATP", "TODOS", "TV-Y", "TV-Y7", "TV-G", "0+", "7+", "+7"}
TEEN_RATINGS = {"PG-13", "PG13", "12+", "+12", "13+", "+13", "14+", "+14", "TV-14", "TV-PG"}
ADULT_RATINGS = {"R", "NC-17", "16+", "+16", "18+", "+18", "TV-MA", "MA", "C"}

STOPWORDS = {
    "para", "como", "pero", "sobre", "entre", "desde", "hasta", "cuando", "donde",
    "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas", "aquel", "todo",
    "toda", "todos", "todas", "otro", "otra", "otros", "otras", "mismo", "misma",
    "cada", "debe", "puede", "tiene", "tienen", "hace", "hacer", "antes", "despues",
    "mientras", "porque", "quien", "quienes", "cual", "cuales", "unos", "unas",
    "nuestro", "nuestra", "their", "with", "from", "that", "this", "the", "and",
    "historia", "serie", "pelicula",
}

_WORD = re.compile(r"[a-z]+")


def normalize_text(value: Optional[str]) -> str:
    """Minúsculas y sin tildes: "Acción" y "accion" son lo mismo."""
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower().strip()


def _bucket(token: str, size: int, salt: str) -> int:
    # md5 y no hash(): hash() cambia entre procesos de Python y los
    # vectores guardados en la base dejarían de ser comparables.
    digest = hashlib.md5(f"{salt}:{token}".encode("utf-8")).hexdigest()
    return int(digest, 16) % size


def split_genres(category: Optional[str]) -> list[str]:
    genres = []
    for part in re.split(r"[,/|;]| y ", normalize_text(category)):
        part = part.strip()
        if part:
            genres.append(SYNONYMS.get(part, part))
    return genres


def _category_slots(genre: str) -> list[int]:
    if genre in _GENRE_INDEX:
        return [_GENRE_INDEX[genre]]
    size = CATEGORY.stop - CATEGORY.start
    # Tres dimensiones por hashing: si dos géneros desconocidos chocan en
    # una, siguen diferenciándose en las otras dos.
    return sorted({_bucket(genre, size, f"cat{i}") for i in range(3)})


def age_group(age_rating: Optional[str]) -> int:
    """0 infantil · 1 adolescente · 2 adulto · 3 sin clasificar."""
    rating = normalize_text(age_rating).upper().replace(" ", "")
    if rating in KIDS_RATINGS:
        return 0
    if rating in TEEN_RATINGS:
        return 1
    if rating in ADULT_RATINGS:
        return 2
    return 3


def tokenize(text: str) -> list[str]:
    return [w for w in _WORD.findall(normalize_text(text)) if len(w) >= 4 and w not in STOPWORDS]


def unit(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else vector


def content_vector(meta: Mapping[str, object]) -> np.ndarray:
    """Embedding de un título a partir de la respuesta de Catalog-Service."""
    v = np.zeros(DIM, dtype=np.float32)

    genres = split_genres(meta.get("category"))  # type: ignore[arg-type]
    for genre in genres:
        slots = _category_slots(genre)
        weight = W_CATEGORY / np.sqrt(len(genres) * len(slots))
        for slot in slots:
            v[CATEGORY.start + slot] += weight

    kind = str(meta.get("type") or "").upper()
    if kind == "MOVIE":
        v[TYPE_OFFSET] = W_TYPE
    elif kind == "SERIES":
        v[TYPE_OFFSET + 1] = W_TYPE

    v[AGE_OFFSET + age_group(meta.get("ageRating"))] = W_AGE  # type: ignore[arg-type]

    text = np.zeros(TEXT_SIZE, dtype=np.float32)
    words = f"{meta.get('name') or ''} {meta.get('synopsis') or ''}"
    for token in tokenize(words):
        text[_bucket(token, TEXT_SIZE, "txt")] += 1.0
    if text.any():
        v[TEXT] = unit(text) * W_TEXT

    return unit(v)


def profile_vector(weighted: Iterable[tuple[float, np.ndarray]]) -> Optional[np.ndarray]:
    """Promedio ponderado (y normalizado) de los títulos que vio un perfil."""
    total = np.zeros(DIM, dtype=np.float32)
    used = False
    for weight, embedding in weighted:
        if weight > 0:
            total += float(weight) * np.asarray(embedding, dtype=np.float32)
            used = True
    if not used or not total.any():
        return None
    return unit(total)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def interaction_strength(kind: str, position_seconds: object, duration_seconds: object) -> float:
    """
    Qué tanto indica interés un evento de Playback-Service:
      · playback.completed                 → 1.00
      · playback.progress, según el avance → 0.25 (recién empezó) a 0.75
        (sin duración conocida se asume un interés moderado, 0.40)
    """
    if kind == "completed":
        return 1.0
    try:
        position = float(position_seconds)  # type: ignore[arg-type]
        duration = float(duration_seconds)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.40
    if duration <= 0:
        return 0.40
    fraction = min(max(position / duration, 0.0), 1.0)
    return round(0.25 + 0.5 * fraction, 3)
