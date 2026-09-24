# Recommendation-Service — MediaStream

Microservicio de recomendaciones: analiza continuamente el historial de visualización
de cada perfil para generar sugerencias personalizadas, combinando **filtrado
colaborativo** (usuarios similares) y **filtrado basado en contenido** (géneros,
categorías, sinopsis). Implementado según la sección *Recommendation-Service* del
documento de arquitectura.

Su carga de trabajo es distinta a la del resto del sistema: procesa un flujo continuo
de eventos y calcula similitudes vectoriales. Por eso está separado: nunca compite por
recursos con la reproducción o la facturación, y si se cae, la reproducción sigue
funcionando con total normalidad.

## Stack

| | |
|---|---|
| Lenguaje | Python 3.12 + FastAPI |
| Base de datos | PostgreSQL 16 con la extensión **pgvector** (propia del servicio) |
| Migraciones | SQLAlchemy + Alembic |
| Eventos | Redis Pub/Sub (`playback.progress`, `playback.completed`) |
| Cálculo | NumPy (vectores) + pgvector (búsqueda por similitud con índice HNSW) |
| Puerto | **3005** · base de datos en el **5437** del host |

## Endpoint

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/recommendations/{profile_id}` | Permite consultar las sugerencias personalizadas de un perfil. |

Parámetros opcionales: `limit`, `region` e `isKids`. Si se pasa `region` (o
`isKids`), el servicio le pregunta a **Catalog-Service** qué títulos puede ver ese
perfil y solo recomienda dentro de ese conjunto: Catalog es el dueño de la
disponibilidad regional y del control parental. Si Catalog no responde, recomienda
igual, sin ese filtro, y lo indica en `catalogFilter.applied = false`.

```json
{
  "profileId": "1",
  "strategy": "hybrid",
  "contentWeight": 0.6,
  "catalogFilter": { "applied": true, "region": "CO", "isKids": false },
  "items": [
    { "titleId": "2", "score": 0.705, "contentScore": 0.916, "collaborativeScore": 0.388,
      "reason": { "kind": "content", "basedOnTitleId": "1" } },
    { "titleId": "5", "score": 0.403, "contentScore": 0.182, "collaborativeScore": 0.735,
      "reason": { "kind": "collaborative", "similarProfiles": 5 } }
  ]
}
```

Endpoints de apoyo para la consola (en Swagger, `/docs`):

| Método | Endpoint | Para qué |
|---|---|---|
| GET | `/api/recommendations/titles/{title_id}/similar` | Títulos parecidos por contenido |
| GET | `/api/recommendations/{profile_id}/profile` | Historial, vector y perfiles parecidos |
| GET | `/api/recommendations/debug/events` | *[Solo demo]* Últimos eventos consumidos |
| POST | `/api/recommendations/debug/sync-catalog` | *[Solo demo]* Sincronizar títulos ya |
| GET | `/health`, `/health/ready` | Health checks |

## Modelo de datos

Fiel al diagrama entidad-relación del documento:

| Tabla | Columnas | Índices |
|---|---|---|
| `content_embedding` | `id` bigint PK, `title_id` bigint, `embedding` vector(64), `updated_at` | único en `title_id`; **HNSW** (coseno) en `embedding` |
| `profile_embedding` | `id` bigint PK, `profile_id` bigint, `embedding` vector(64), `updated_at` | único en `profile_id`; **HNSW** (coseno) en `embedding` |

Sin llaves foráneas: `title_id` y `profile_id` son referencias lógicas a Catalog y a
User (database-per-service). `updated_at` se agrega para poder mostrar cuándo cambió
el modelo de un perfil.

**Extensión justificada — `profile_interaction`** (`profile_id`, `title_id`,
`strength`, `completed`, `updated_at`; único en `(profile_id, title_id)`). El
diagrama solo tiene los dos vectores, pero el documento pide dos cosas que no se
pueden hacer solo con ellos:

1. **Filtrado colaborativo**: hay que saber *qué* vieron los perfiles parecidos, no solo
   hacia dónde apunta su vector.
2. **No recomendar lo que el perfil ya vio.**

Además, el vector de un perfil se recalcula a partir de sus interacciones; sin
guardarlas, cada evento tendría que mezclarse a ciegas con el vector anterior.

## Cómo funciona

### 1. Embedding de cada título (64 dimensiones)

Se construye con los metadatos que expone Catalog. Es un modelo deliberadamente
explicable:

| Dimensiones | Qué captura | Peso |
|---|---|---|
| 0–31 | Género(s): cada género conocido tiene su propia dimensión | 1.00 |
| 32–35 | Película o serie | 0.30 |
| 36–39 | Clasificación: infantil / adolescente / adulto | 0.35 |
| 40–63 | Palabras del nombre y la sinopsis (feature hashing) | 0.45 |

"Acción", "accion" y "Action" son lo mismo. El vector se normaliza, así que la
similitud coseno compara la *dirección* del gusto.

Se podría reemplazar por un modelo entrenado (scikit-learn, TensorFlow) sin tocar las
tablas ni la API: basta con que produzca vectores de 64 dimensiones.

### 2. Embedding de cada perfil

Promedio ponderado de los vectores de lo que vio, donde el peso es el **interés**:

| Evento | Interés |
|---|---|
| `playback.completed` | 1.00 |
| `playback.progress` | 0.25 al empezar → 0.75 al final (según el avance) |

Se guarda el interés más alto visto para cada título. Así el perfil vive en el mismo
espacio que los títulos y se pueden comparar directamente.

### 3. Recomendación híbrida

```
puntaje = 0.6 · contenido + 0.4 · colaborativo
```

- **Contenido**: similitud coseno entre el vector del perfil y el de cada título, con
  pgvector (`<=>` sobre el índice HNSW).
- **Colaborativo**: los 10 perfiles más parecidos (también con pgvector, sobre
  `profile_embedding`) y qué vieron. Un título suma más cuanto más parecido es el
  perfil que lo vio y más fuerte fue su interés.
- **Arranque en frío**: un perfil sin historial recibe lo más visto.
- Cada sugerencia trae su **explicación** (`reason`): "se parece a X que viste", "lo
  vieron N perfiles parecidos", "para variar" o "popular". Solo se dice "se parece a"
  si la similitud es de verdad alta (≥ 0.4).

El peso `0.6` es configurable con `CONTENT_WEIGHT`.

## Comunicación

**Asíncrona, Redis Pub/Sub** — se suscribe a `playback.progress` y
`playback.completed` de Playback-Service. Redis y no RabbitMQ porque son eventos de
alta frecuencia: perder un `progress` ocasional no importa, el siguiente trae una
posición más reciente. Si Redis se cae, el suscriptor reintenta solo con backoff.

**Síncrona, REST con Catalog-Service** — para los metadatos de los títulos
(timeout de 2 s y 2 reintentos con backoff, secciones 4.5–4.6 del documento):

- **Sincronización periódica** (cada 60 s) de los títulos disponibles en CO, MX y GLOBAL,
  para poder recomendar estrenos que nadie ha visto todavía.
- **Consulta puntual** cuando llega un evento de un título que todavía no conoce.
- **Filtro de región y control parental** al recomendar, si se pide.

Si Catalog está caído, nada se bloquea: el evento se guarda igual y el título se
incorpora en la siguiente sincronización (consistencia eventual); al llegar su vector,
se recalculan los perfiles que ya lo habían visto.

**Nada síncrono llega de otros servicios**, como indica el documento: ningún otro
microservicio depende de que este responda.

## Ids de perfil

El diagrama define `profile_id` como bigint, igual que los perfiles de User-Service.
Un evento con un id no numérico (por ejemplo `"profile-42"`) se **ignora** y queda
registrado en la vista de eventos. Para la demo, usa en Playback el id del perfil de
User (por ejemplo `1`).

## Cómo correrlo

### Con Docker, dentro de la plataforma

Desde la carpeta `MediaStream/`:

```bash
docker compose up -d --build recommendation-service
```

Consola: http://localhost:3005 · Swagger: http://localhost:3005/docs

### Datos para probar

```bash
# 1. Títulos variados en el catálogo (lo hace Catalog, en su propia base)
docker compose exec catalog-service node scripts/cargar-titulos-demo.js

# 2. Actividad de 18 perfiles simulados, publicada en Redis como lo haría Playback
docker compose exec recommendation-service python scripts/simular_audiencia.py
```

Luego reproduce algo en la consola de Playback con el perfil `1` y mira cómo cambian
sus recomendaciones en http://localhost:3005 (la vista *Para ti* se actualiza sola).

### Tests

```bash
pip install -r requirements-dev.txt
pytest
```

Los tests cubren el modelo de embeddings (determinismo, normalización, que la misma
categoría se parezca más que una distinta, fuerza del interés y vector de perfil).
