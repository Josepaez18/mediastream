# Notification-Service

<!-- ficha:inicio -->
## Ficha del microservicio

Forma parte de **MediaStream**, una plataforma de streaming construida con microservicios. La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream). Más abajo está el detalle técnico.

### Responsabilidad

Avisos para los usuarios. Escucha los eventos de la plataforma y genera notificaciones: título nuevo disponible (`media.ready`), pago rechazado (`payment.failed`) y título terminado (`playback.completed`). Evita avisos repetidos con deduplicación y guarda el historial reciente de cada perfil y cuenta.

Consume de RabbitMQ `media.ready` y `payment.failed`, y de Redis `playback.completed`. Consulta a Catalog por REST para poner el nombre del título.

### Tecnologías

Node.js 20, NestJS 10, Redis (ioredis), RabbitMQ (amqplib), Swagger y Jest.

### Enlaces

| | |
| --- | --- |
| Despliegue (Render) | https://mediastream-notification.onrender.com |
| Documentación (Swagger) | https://mediastream-notification.onrender.com/docs |
| Estado del servicio | https://mediastream-notification.onrender.com/health |
| Repositorio | https://github.com/Josepaez18/mediastream-notification-service |

### Base de datos

Redis (sin base relacional).

### Endpoints principales

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/notifications/:profileId` | Historial de notificaciones de un perfil |
| GET | `/health`, `/health/ready` | Estado del servicio y de sus dependencias |

### Variables de entorno

Copia `.env.example` como `.env`. El `.env` real nunca se sube al repositorio (está en `.gitignore`); en Render las variables se configuran en el panel del servicio.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servicio | `3007` |
| `REDIS_URL` | Conexión a Redis | `redis://localhost:6379` |
| `COMPLETED_CHANNEL` | Canal Redis de playback.completed | `playback.completed` |
| `RABBITMQ_URL` | Conexión a RabbitMQ | `amqp://guest:guest@localhost:5672` |
| `CATALOG_SERVICE_URL` | URL de Catalog-Service | `http://localhost:3002` |
| `CATALOG_TIMEOUT_MS` | Tiempo máximo de cada llamada a Catalog (ms) | `2000` |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por coma | `*` |
| `PUBLIC_*_URL` | URLs públicas de los demás servicios (solo en Render) | `https://mediastream-…onrender.com` |

### Instalación y ejecución

Con Docker (levanta el servicio con lo que necesita):

```bash
git clone https://github.com/Josepaez18/mediastream-notification-service.git
cd mediastream-notification-service
cp .env.example .env
docker compose up -d
```

Sin Docker para el servicio (necesita su base y el broker corriendo):

```bash
npm ci
cp .env.example .env
npm run start:dev
npm test   # pruebas
```

Queda en http://localhost:3007.
<!-- ficha:fin -->


Microservicio de **notificaciones** de MediaStream (NestJS). Avisa de nuevos estrenos, de la
continuación de series en curso y de pagos rechazados. Su única responsabilidad es escuchar
eventos de otros servicios y traducirlos en avisos: no tiene lógica de negocio propia ni
decide nada que le corresponda a otro servicio.

- **Puerto**: 3007 · Swagger en `/docs`
- **Persistencia**: sin base relacional. **Redis** guarda el historial reciente (100 avisos por
  destinatario) y deduplica lo ya enviado.
- **Canales**: correo y push **simulados**: cada envío deja una línea JSON
  (`"event":"notification.sent"`) en el log, que es donde se conectaría el proveedor real.

## Qué escucha

| Evento | Medio | Publica | Aviso | Destinatario |
|---|---|---|---|---|
| `media.ready` | RabbitMQ · exchange `media.events` · cola `notification.media-events` | Media-Processing | "Nuevo estreno: …" (push) | todos los perfiles |
| `payment.failed` | RabbitMQ · exchange `billing.events` · cola `notification_service.payment_failed` | Billing | "No pudimos procesar tu pago" (correo + push) | la cuenta |
| `playback.completed` | Redis Pub/Sub | Playback | "Sigue viendo …: temporada X, episodio Y" (push) | el perfil |

- Las colas de RabbitMQ son **propias**: Catalog y User tienen las suyas en los mismos
  exchanges, así que cada servicio recibe su copia del evento. Si Notification está caído,
  sus mensajes esperan en su cola sin afectar a nadie.
- `playback.completed` llega por Pub/Sub: si Notification está caído en ese momento, el
  evento se pierde. Se acepta (sección 4.2): un "sigue viendo" perdido no es crítico.
- Películas y último episodio de una serie no generan aviso de continuación.

### Deduplicación

Antes de enviar, se reserva una clave en Redis con `SET NX EX`. Si RabbitMQ reentrega un
mensaje (por ejemplo, tras un reinicio), la clave ya existe y el aviso no se repite.

| Evento | Clave | Vigencia |
|---|---|---|
| `media.ready` | `media.ready:{titleId}` (un estreno se anuncia una vez) | 30 días |
| `payment.failed` | `payment.failed:{eventId}` (cada rechazo real avisa) | 7 días |
| `playback.completed` | `playback.completed:{perfil}:{episodio}` | 7 días |

Si el envío falla después de reservar, la clave se libera para que el reintento sí avise.

### Catalog, solo para el texto

Para poner el nombre del título en el aviso, Notification consulta `GET /api/catalog/titles/{id}`
(timeout de 2 s). Si Catalog no responde, el estreno se anuncia igual como "Título #3".

## API

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/notifications/{profile_id}?accountId=&limit=` | Historial del perfil: sus avisos, los estrenos y, con `accountId`, los de la cuenta. Más recientes primero. |
| GET | `/health` · `/health/ready` | Vivo · listo (Redis obligatorio; RabbitMQ y Pub/Sub se reportan) |

## Ejecutar

```bash
docker compose up --build          # aislado: servicio + su Redis + su RabbitMQ
cd .. && docker compose up -d      # con toda la plataforma
```

En local sin Docker: `npm ci`, copiar `.env.example` a `.env` y `npm run start:dev`.

## Lint y pruebas

```bash
npm run lint
npm test
```

## Colaboradora

- **Yulissa Garces** ([@garcesyulissa6-maker](https://github.com/garcesyulissa6-maker)) — colaboró en el Notification Service.
