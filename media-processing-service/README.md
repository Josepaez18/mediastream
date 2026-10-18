# Media-Processing-Service — MediaStream

<!-- ficha:inicio -->
## Ficha del microservicio

Forma parte de **MediaStream**, una plataforma de streaming construida con microservicios. La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream). Más abajo está el detalle técnico.

### Responsabilidad

Ingesta y transcodificación de video. Recibe el archivo maestro de un título, crea un trabajo (`media_job`) y lo procesa con FFmpeg en 1080p, 720p, 480p y 240p con su manifiesto HLS. Al terminar publica `media.ready` (o `media.processing.failed` si falla) para que Catalog actualice el estado del título.

Publica en RabbitMQ (exchange `media.events`) `media.ready` y `media.processing.failed`.

### Tecnologías

Python 3.12, FastAPI 0.115, SQLAlchemy 2, Alembic, PostgreSQL 16, RabbitMQ (aio-pika) y FFmpeg.

### Enlaces

| | |
| --- | --- |
| Despliegue (Render) | https://mediastream-media-zadq.onrender.com |
| Documentación (Swagger) | https://mediastream-media-zadq.onrender.com/docs |
| Estado del servicio | https://mediastream-media-zadq.onrender.com/health |
| Repositorio | https://github.com/Josepaez18/mediastream-media-processing-service |

### Base de datos

Base propia: `media_processing_db` (PostgreSQL 16). Ningún otro servicio escribe en ella.

- **Tablas:** `media_job`.
- **Esquema:** migraciones en `alembic/versions/` (se aplican solas al arrancar el contenedor).
- **Datos de ejemplo:** `database/seed.sql`.
- **Respaldo completo (esquema y datos):** `database/backup.sql`.
- **En producción:** base separada dentro de la instancia Render Postgres `mediastream-db`; la conexión llega por las variables `DATABASE_URL` y `DATABASE_NAME`, nunca en el código.

Restaurar el respaldo en local:

```bash
docker compose up -d media-db
docker compose exec -T media-db psql -U media_user -d media_processing_db < database/backup.sql
```

### Endpoints principales

| Método | Ruta | Qué hace |
| --- | --- | --- |
| POST | `/api/media/ingest` | Recibe el archivo maestro y crea el trabajo de transcodificación |
| GET | `/api/media/jobs/{job_id}` | Estado de un trabajo |
| GET | `/health`, `/health/ready` | Estado del servicio y de sus dependencias |

### Variables de entorno

Copia `.env.example` como `.env`. El `.env` real nunca se sube al repositorio (está en `.gitignore`); en Render las variables se configuran en el panel del servicio.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servicio | `3004` |
| `DATABASE_URL` | Conexión a su base PostgreSQL | `postgresql+psycopg2://media_user:media_pass@localhost:5436/media_processing_db` |
| `RABBITMQ_URL` | Conexión a RabbitMQ | `amqp://guest:guest@localhost:5672/` |
| `RABBITMQ_EXCHANGE` | Exchange donde se publican los eventos de media | `media.events` |
| `MEDIA_READY_ROUTING_KEY` | Routing key del evento media.ready | `media.ready` |
| `MEDIA_FAILED_ROUTING_KEY` | Routing key del evento media.processing.failed | `media.processing.failed` |
| `OBJECT_STORAGE_BUCKET` | Bucket del almacenamiento de objetos | `mediastream-media` |
| `OBJECT_STORAGE_ENDPOINT` | Endpoint del almacenamiento de objetos | `https://storage.example.com` |
| `OBJECT_STORAGE_ACCESS_KEY` | Llave de acceso del almacenamiento | (vacío) |
| `OBJECT_STORAGE_SECRET_KEY` | Llave secreta del almacenamiento | (vacío) |
| `CDN_BASE_URL` | Base del CDN que sirve los manifiestos HLS | `https://cdn.mediastream.example.com` |
| `WORK_DIR` | Carpeta temporal de trabajo de FFmpeg | `/tmp/media-processing` |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por coma | `*` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `DATABASE_NAME` | Nombre de su base dentro de la instancia compartida de Render Postgres (se crea al arrancar si no existe) (solo en Render) | `media_processing_db` |
| `PUBLIC_*_URL` | URLs públicas de los demás servicios (solo en Render) | `https://mediastream-…onrender.com` |

### Instalación y ejecución

Con Docker (levanta el servicio con lo que necesita):

```bash
git clone https://github.com/Josepaez18/mediastream-media-processing-service.git
cd mediastream-media-processing-service
cp .env.example .env
docker compose up -d
```

Sin Docker para el servicio (necesita su base y el broker corriendo):

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 3004
pytest   # pruebas
```

Queda en http://localhost:3004.
<!-- ficha:fin -->


Tercer microservicio de la plataforma: procesa los archivos de vídeo
maestro subidos por el equipo de contenido, generando múltiples
resoluciones y bitrates (adaptive bitrate streaming / HLS) y publicando
`media.ready` una vez concluida la transcodificación.

## Stack
- Python + FastAPI
- SQLAlchemy + Alembic (migraciones), PostgreSQL (base de datos propia)
- FFmpeg (wrapper vía subprocess) para generar la escalera de renditions
- RabbitMQ (aio-pika) para publicar el evento `media.ready`
- Almacenamiento de objetos servido por CDN para los renditions generados

## Consola web
El servicio sirve una pequeña consola de operación en `http://localhost:3004/`
(archivo `app/static/index.html`), con el mismo sistema visual que el resto
de las consolas de MediaStream: subir un vídeo maestro, hacer seguimiento
local de los jobs creados y consultar su estado, y verificar `/health` /
`/health/ready`. La URL base de la API es configurable desde la barra
lateral (útil si se abre la consola por separado, por ejemplo con Live
Server en VS Code).

## Endpoints
| Método | Ruta                      | Descripción                                                  |
|--------|---------------------------|---------------------------------------------------------------|
| POST   | /api/media/ingest         | Recibe el vídeo maestro y crea un job de transcodificación   |
| GET    | /api/media/jobs/{id}      | Consulta el estado del job (pending/processing/completed/error) |
| GET    | /health, /health/ready    | Health checks (liveness / readiness)                          |

## Tabla `media_job`
Exactamente como está definida en el diagrama entidad-relación del documento
de arquitectura (sección "3. Media-Processing-Service"):

`id (PK), title_id, status, created_at, updated_at`

- **Índices**: `title_id` (consultar el estado de transcodificación de un
  título específico) y `status` (filtrar jobs pendientes/en proceso/error).
- **Restricciones**: `title_id` y `status` no pueden ser `NULL`.
- **Normalización**: 3FN — tabla plana, todos los atributos dependen
  únicamente del id del job.
- `title_id` es solo una referencia lógica a Catalog-Service — no hay FK
  real, porque cada microservicio tiene su propia base de datos
  (database-per-service).

El detalle de un fallo de transcodificación no se persiste en una columna
propia (el ERD no la define): el job simplemente pasa a `error` y el motivo
queda en los logs estructurados del servicio.

## Flujo
1. `POST /api/media/ingest` guarda el archivo, crea el job en `pending` y
   responde `202 Accepted` de inmediato.
2. En segundo plano, `run_transcoding_job` marca el job `processing`,
   corre FFmpeg para cada resolución de la escalera (1080p/720p/480p/240p),
   sube los renditions y el manifiesto maestro `.m3u8` al bucket servido
   por la CDN.
3. Si todo sale bien: el job pasa a `completed` y se publica `media.ready`
   (consumido por Catalog-Service, que marca el título como `AVAILABLE`).
4. Si falla (por cualquier motivo, no solo un error de FFmpeg): el job pasa
   a `error` y se publica `media.processing.failed`, para que
   Catalog-Service marque el título como `UNAVAILABLE` en vez de dejarlo
   huérfano en `PENDING`. **Nunca** se publica `media.ready` sin una
   transcodificación exitosa. El motivo queda en el log estructurado del
   servicio (y en el campo `reason` del evento), no en una columna propia:
   el ERD no la define.

## Contrato del evento con Catalog-Service

| Parámetro   | Valor                                                       |
|-------------|-------------------------------------------------------------|
| Exchange    | `media.events` (topic, durable)                             |
| Routing key | `media.ready` / `media.processing.failed`                   |
| Payload     | `{"title_id": "1", "job_id": "…", "processed_at": "…"}`     |

El exchange y las routing keys son configurables por entorno
(`RABBITMQ_EXCHANGE`, `MEDIA_READY_ROUTING_KEY`, `MEDIA_FAILED_ROUTING_KEY`),
pero sus valores por defecto **deben** coincidir con los que escucha
Catalog-Service (`catalog-service/src/rabbitmq/media-events.consumer.ts`).
Catalog acepta tanto `title_id` como `titleId` en el payload.

## Archivos de muestra

`samples/muestra-5s.mp4` es un vídeo de prueba de 5 segundos: úsalo para
probar el camino feliz sin tener que conseguir un vídeo. `samples/archivo-corrupto.mp4`
no es un vídeo real: sirve para demostrar el camino de error.

## Observabilidad y manejo de errores
- **Request-id**: cada solicitud recibe (o propaga, si el API Gateway ya
  lo inyectó) un `x-request-id`, devuelto también en la respuesta. Cada
  request queda registrado en un log JSON estructurado (método, ruta,
  código, latencia).
- **Manejador global de excepciones**: cualquier error no controlado
  siempre responde un JSON consistente al cliente (`statusCode`, `path`,
  `timestamp`, `message`, `request_id`) — nunca el "Internal Server
  Error" en blanco que da FastAPI por defecto. El traceback completo
  queda en el log del servidor (la terminal de `docker compose up`),
  junto al mismo `request_id`, que es el primer lugar a mirar cuando algo
  falla.
- **Documentación interactiva**: FastAPI expone automáticamente Swagger UI
  en `/docs` y Redoc en `/redoc`, sin configuración adicional.

## Correr en local
```bash
cp .env.example .env
pip install -r requirements.txt --break-system-packages
alembic upgrade head
uvicorn app.main:app --reload --port 3004
```
Requiere `ffmpeg` instalado en el sistema (ya incluido en el Dockerfile).

## Docker (recomendado — levanta también Postgres y RabbitMQ)
```bash
docker compose up --build
```
Nota: Postgres queda expuesto en el puerto **5436** del host, a propósito:
5433, 5434 y 5435 ya los usan Catalog, Playback y User. El servicio escucha
en el **3004** (3003 es Playback).

## Docker (solo esta imagen, con dependencias ya corriendo aparte)
```bash
docker build -t media-processing-service .
docker run --env-file .env -p 3004:3004 media-processing-service
```

## Colaboradora

- **Yulissa Garces** ([@garcesyulissa6-maker](https://github.com/garcesyulissa6-maker)) — colaboró en el Media Processing Service.
