# Media-Processing-Service — MediaStream

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
