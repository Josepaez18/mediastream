# Playback-Service

<!-- ficha:inicio -->
## Ficha del microservicio

Forma parte de **MediaStream**, una plataforma de streaming construida con microservicios. La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream). Más abajo está el detalle técnico.

### Responsabilidad

Reproducción. Antes de emitir el token de reproducción (DRM simulado) valida con Catalog que el título exista, esté AVAILABLE y tenga licencia en la región, y que el plan de la cuenta permita verlo. Guarda el progreso de cada perfil ("seguir viendo") y publica `playback.progress` y `playback.completed`. Hacia Catalog usa timeout, reintentos con backoff y circuit breaker.

Llama por REST a Catalog-Service. Publica en Redis `playback.progress` y `playback.completed`, que consumen Recommendation y Notification.

### Tecnologías

Node.js 20, NestJS 10, Prisma 5, PostgreSQL 16, Redis (caché y Pub/Sub), JWT, Swagger y Jest.

### Enlaces

| | |
| --- | --- |
| Despliegue (Render) | https://mediastream-playback-0ciy.onrender.com |
| Documentación (Swagger) | https://mediastream-playback-0ciy.onrender.com/docs |
| Estado del servicio | https://mediastream-playback-0ciy.onrender.com/health |
| Repositorio | https://github.com/Josepaez18/mediastream-playback-service |

### Base de datos

Base propia: `playback_db` (PostgreSQL 16 + Redis). Ningún otro servicio escribe en ella.

- **Tablas:** `watch_progress`.
- **Esquema:** migraciones en `prisma/migrations/` (se aplican solas al arrancar el contenedor).
- **Datos de ejemplo:** `database/seed.sql`.
- **Respaldo completo (esquema y datos):** `database/backup.sql`.
- **En producción:** base separada dentro de la instancia Render Postgres `mediastream-db`; la conexión llega por las variables `DATABASE_URL` y `DATABASE_NAME`, nunca en el código.

Restaurar el respaldo en local:

```bash
docker compose up -d playback-db
docker compose exec -T playback-db psql -U playback_user -d playback_db < database/backup.sql
```

### Endpoints principales

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/playback/token/:titleId` | Emite el token de reproducción tras validar título, región y plan |
| POST | `/api/playback/progress` | Guarda el progreso y publica los eventos de reproducción |
| GET | `/api/playback/resume/:profileId` | "Seguir viendo" de un perfil |
| GET | `/health`, `/health/ready` | Estado del servicio y de sus dependencias |

### Variables de entorno

Copia `.env.example` como `.env`. El `.env` real nunca se sube al repositorio (está en `.gitignore`); en Render las variables se configuran en el panel del servicio.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servicio | `3003` |
| `DATABASE_URL` | Conexión a su base PostgreSQL | `postgresql://playback_user:playback_pass@localhost:5434/playback_db?schema=public` |
| `REDIS_URL` | Conexión a Redis | `redis://localhost:6379` |
| `CATALOG_SERVICE_URL` | URL de Catalog-Service | `http://localhost:3002` |
| `CATALOG_TIMEOUT_MS` | Tiempo máximo de cada llamada a Catalog (ms) | `2000` |
| `CATALOG_RETRIES` | Reintentos hacia Catalog | `2` |
| `CATALOG_RETRY_BASE_MS` | Espera base del backoff exponencial (ms) | `200` |
| `CATALOG_CB_FAILURE_THRESHOLD` | Fallos seguidos que abren el circuit breaker | `3` |
| `CATALOG_CB_OPEN_MS` | Tiempo que el circuit breaker queda abierto (ms) | `30000` |
| `CATALOG_CACHE_TTL_SECONDS` | Caché corta de cada respuesta de Catalog (s) | `60` |
| `CATALOG_LAST_KNOWN_TTL_SECONDS` | Cuánto se guarda la última información conocida de un título (s) | `86400` |
| `DRM_JWT_SECRET` | Clave de firma del token de reproducción (DRM simulado) | `cambiar-esta-clave-en-produccion` |
| `DRM_TOKEN_TTL_SECONDS` | Duración del token de reproducción (s) | `300` |
| `CDN_BASE_URL` | Base del CDN que sirve los manifiestos HLS | `https://cdn.mediastream.local` |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por coma | `http://localhost:3000` |
| `DATABASE_NAME` | Nombre de su base dentro de la instancia compartida de Render Postgres (se crea al arrancar si no existe) (solo en Render) | `playback_db` |
| `PUBLIC_*_URL` | URLs públicas de los demás servicios (solo en Render) | `https://mediastream-…onrender.com` |

### Instalación y ejecución

Con Docker (levanta el servicio con lo que necesita):

```bash
git clone https://github.com/Josepaez18/mediastream-playback-service.git
cd mediastream-playback-service
cp .env.example .env
docker compose up -d
```

Sin Docker para el servicio (necesita su base y el broker corriendo):

```bash
npm ci
cp .env.example .env
npx prisma migrate deploy
npm run start:dev
npm test   # pruebas
```

Queda en http://localhost:3003.
<!-- ficha:fin -->


Microservicio de reproducción de **MediaStream**. Gestiona el estado de reproducción de cada
usuario (posición exacta, dispositivo utilizado), genera tokens de acceso DRM de corta duración
para los streams, y aplica las reglas de gestión de derechos digitales según el contenido.

Es el servicio que concentra la mayor carga de tráfico durante los estrenos y tiene requisitos
de latencia exigentes, por eso está separado de los procesos pesados de transcodificación.

---

## Stack tecnológico

| Componente | Tecnología | Rol |
|---|---|---|
| Runtime | Node.js 20 + NestJS 10 | Bajo overhead y buena integración con Redis |
| Base de datos | PostgreSQL 16 + Prisma | Tabla `watch_progress` (propia del servicio) |
| Cache / eventos | Redis 7 | Sesiones activas + Pub/Sub de eventos de reproducción |
| DRM | JWT firmado (`@nestjs/jwt`) | Token de corta duración simulado |
| Documentación | Swagger (OpenAPI) | Disponible en `/docs` |

---

## Endpoints

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/playback/token/{title_id}` | Genera el token de acceso DRM de corta duración para iniciar la reproducción. |
| `POST` | `/api/playback/progress` | Registra la posición actual de reproducción de un perfil. |
| `GET` | `/api/playback/resume/{profile_id}` | Consulta el punto de continuación de una serie en curso. |
| `GET` | `/health` | Liveness probe. |
| `GET` | `/health/ready` | Readiness probe (Postgres y Redis obligatorios; informa Catalog y el estado del circuito). |
| `GET` | `/docs` | Documentación Swagger interactiva. |
| `GET` | `/` | Consola web de pruebas. |

### `GET /api/playback/token/{title_id}`

Parámetros de query: `profileId` (requerido), `region` (requerido), `deviceId` (opcional).

Antes de emitir el token, el servicio llama **de forma síncrona** al Catalog-Service para
verificar que el título exista, esté en estado `AVAILABLE` y tenga licencia vigente en la
región del usuario. Si el título no existe responde `404`; si todavía no está `AVAILABLE`,
`403`; si no tiene licencia en la región, `451 Unavailable For Legal Reasons` (sección 4.4 del
documento).

**Resiliencia hacia Catalog (secciones 4.5–4.7).** Cada llamada tiene un timeout de 2 s y se
reintenta hasta 2 veces con backoff exponencial (200 ms, 400 ms). Si se acumulan 3 fallos
seguidos, el **circuit breaker** se abre: durante 30 s Playback deja de llamar a Catalog y usa
la **última información conocida** del título, así que sigue emitiendo tokens. Pasados los 30 s
deja pasar una solicitud de prueba y, si Catalog responde, el circuito se cierra. Solo si
Catalog no responde y Playback nunca había visto ese título responde `503`. El campo
`catalogCheck` de la respuesta dice de dónde salió la verificación (`LIVE`, `CACHE` o
`LAST_KNOWN`) y el estado del circuito.

```bash
curl "http://localhost:3003/api/playback/token/1?profileId=profile-42&region=CO"
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "sessionId": "b3f2...",
  "titleId": "1",
  "titleName": "El Último Meridiano",
  "expiresAt": "2026-01-01T00:05:00.000Z",
  "expiresInSeconds": 300,
  "manifestUrl": "https://cdn.mediastream.local/titles/1/master.m3u8",
  "catalogCheck": { "source": "LIVE", "circuit": "CLOSED" }
}
```

### `POST /api/playback/progress`

```bash
curl -X POST http://localhost:3003/api/playback/progress \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "profile-42",
    "titleId": "1",
    "positionSeconds": 1830,
    "durationSeconds": 7200,
    "deviceId": "smart-tv-samsung-01"
  }'
```

Al superar el **95%** del contenido, el registro se marca como `completed` y se publica el
evento `playback.completed`.

### `GET /api/playback/resume/{profile_id}`

Query opcional: `titleId` (punto de continuación de un título puntual) e `includeCompleted`.

---

## Persistencia y comunicación

**Base de datos propia** (patrón *database-per-service*), tabla `watch_progress`:

| Columna | Tipo | Notas |
|---|---|---|
| `profile_id` | TEXT | Perfil del usuario |
| `title_id` | BIGINT | Id del título en el catálogo |
| `episode_id` | BIGINT? | Solo para series |
| `position_seconds` | INT | Posición exacta |
| `duration_seconds` | INT? | Para calcular el porcentaje |
| `completed` | BOOLEAN | ≥95% visto |
| `device_id` | TEXT? | Dispositivo utilizado |
| `updated_at` | TIMESTAMP | |

Restricción única sobre `(profile_id, title_id, episode_id)`: un perfil tiene un solo punto de
continuación por episodio.

**Comunicación síncrona** — REST con Catalog-Service para verificar la disponibilidad regional
antes de generar el token. Las respuestas se cachean 60s en Redis, porque es el camino crítico
de mayor tráfico.

**Comunicación asíncrona** — Redis Pub/Sub:

| Canal | Cuándo | Consumidor previsto |
|---|---|---|
| `playback.progress` | En cada reporte de posición | Analítica |
| `playback.completed` | Al superar el 95% | Recommendation-Service |

---

## Puesta en marcha

### Requisitos previos

Playback depende de Catalog-Service. Levántalo primero:

```bash
cd ../catalog-service
docker compose up --build -d
```

### Levantar este servicio

```bash
cp .env.example .env
docker compose up --build
```

Esto levanta Postgres (`5434`), Redis (`6380`) y el servicio (`3003`), aplica las migraciones
y arranca. Luego abre:

- Consola de pruebas: http://localhost:3003/
- Swagger: http://localhost:3003/docs

### Desarrollo local (sin Docker para el servicio)

```bash
docker compose up playback-db playback-redis -d
npm install
npx prisma migrate dev
npm run start:dev
```

---

## Scripts de demostración

**Escuchar los eventos publicados** (simula lo que hará Recommendation-Service):

```bash
node scripts/listen-playback-events.js
```

**Simular una sesión de reproducción completa**:

```bash
node scripts/simulate-playback.js 1 profile-42 CO
```

Pide el token, reporta progreso hasta el final y consulta el punto de continuación. Con el
listener corriendo en otra terminal verás aparecer `playback.progress` y `playback.completed`.

---

## Tests

```bash
npm test
```

Cubren la emisión de tokens (título inexistente, `PENDING`, sin licencia regional), el cálculo
del porcentaje, la marca de completado y el uso del cache en `resume`.

---

## Uniendo los microservicios

Cada servicio es autónomo: su propio `package.json`, `Dockerfile`, base de datos y ciclo de
despliegue. Se comunican solo por REST y Redis Pub/Sub, nunca compartiendo tablas.

La estructura recomendada del repositorio:

```
mediastream/
├── catalog-service/
├── playback-service/
├── recommendation-service/
└── docker-compose.yml     ← orquesta todos juntos
```

Ambos `docker-compose.yml` ya declaran la red compartida **`mediastream-net`**, así que los
contenedores se resuelven entre sí por nombre (`http://catalog-service:3002`). Si levantas
Catalog-Service con su compose actual (que aún no declara esa red), conéctalo con:

```bash
docker network create mediastream-net   # si no existe
docker network connect mediastream-net catalog-service
```

O añade a su `docker-compose.yml` el mismo bloque `networks` que tiene este servicio.

### Variables de entorno

Ver `.env.example`. Las más importantes:

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto del servicio | `3003` |
| `DATABASE_URL` | Postgres propio | — |
| `REDIS_URL` | Redis para cache y Pub/Sub | `redis://localhost:6379` |
| `CATALOG_SERVICE_URL` | Base del Catalog-Service | `http://localhost:3002` |
| `CATALOG_TIMEOUT_MS` | Timeout por intento hacia Catalog | `2000` |
| `CATALOG_RETRIES` | Reintentos con backoff ante caída | `2` |
| `CATALOG_CB_FAILURE_THRESHOLD` | Fallos seguidos que abren el circuito | `3` |
| `CATALOG_CB_OPEN_MS` | Tiempo con el circuito abierto | `30000` |
| `DRM_JWT_SECRET` | Clave de firma del token DRM | (cambiar en producción) |
| `DRM_TOKEN_TTL_SECONDS` | Vigencia del token | `300` |
| `CDN_BASE_URL` | Base de los manifiestos HLS | `https://cdn.mediastream.local` |

---

## Nota sobre el DRM

El token es un **JWT firmado que simula** un sistema DRM real. En producción, este servicio
sería el punto de integración con un proveedor de licencias (Widevine, PlayReady, FairPlay):
el payload actual (`sub`, `titleId`, `region`, `deviceId`, `sessionId`, `scope`) es
precisamente el conjunto de datos que se enviaría al servidor de licencias. La estructura del
código permite reemplazar `JwtService` por el SDK del proveedor sin tocar controllers ni DTOs.
