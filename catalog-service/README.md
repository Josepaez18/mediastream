# Catalog-Service — MediaStream

<!-- ficha:inicio -->
## Ficha del microservicio

Forma parte de **MediaStream**, una plataforma de streaming construida con microservicios. La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream). Más abajo está el detalle técnico.

### Responsabilidad

Catálogo de películas y series: títulos, temporadas, episodios y disponibilidad por región (licencias con fecha de inicio y fin). Marca qué títulos son gratis, guarda el póster y el tráiler de YouTube, y cambia el estado de cada título con los eventos de Media-Processing (`media.ready` lo deja AVAILABLE; `media.processing.failed`, UNAVAILABLE). El listado se cachea en Redis.

Consume de RabbitMQ (exchange `media.events`) `media.ready` y `media.processing.failed`. Playback, Recommendation, Notification y Analytics lo consultan por REST.

### Tecnologías

Node.js 20, NestJS 10, Prisma 5, PostgreSQL 16, Redis (ioredis), RabbitMQ (amqplib), Swagger y Jest.

### Enlaces

| | |
| --- | --- |
| Despliegue (Render) | https://mediastream-catalog-t9f9.onrender.com |
| Documentación (Swagger) | https://mediastream-catalog-t9f9.onrender.com/docs |
| Estado del servicio | https://mediastream-catalog-t9f9.onrender.com/health |
| Repositorio | https://github.com/Josepaez18/mediastream-catalog-service |

### Base de datos

Base propia: `catalog_db` (PostgreSQL 16 + caché en Redis). Ningún otro servicio escribe en ella.

- **Tablas:** `title`, `season`, `episode`, `availability`.
- **Esquema:** migraciones en `prisma/migrations/` (se aplican solas al arrancar el contenedor).
- **Datos de ejemplo:** `database/seed.sql`.
- **Respaldo completo (esquema y datos):** `database/backup.sql`.
- **En producción:** base separada dentro de la instancia Render Postgres `mediastream-db`; la conexión llega por las variables `DATABASE_URL` y `DATABASE_NAME`, nunca en el código.

Restaurar el respaldo en local:

```bash
docker compose up -d catalog-db
docker compose exec -T catalog-db psql -U catalog_user -d catalog_db < database/backup.sql
```

### Endpoints principales

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/catalog/titles` | Lista los títulos disponibles en una región (caché en Redis) |
| GET | `/api/catalog/titles/:id` | Detalle de un título con temporadas y episodios |
| GET | `/api/catalog/titles/:id/availability` | Disponibilidad regional vigente de un título |
| POST | `/api/catalog/titles` | Administrador: crea un título |
| PATCH | `/api/catalog/titles/:id` | Administrador: edita datos, gratis, estado, regiones, póster y tráiler |
| DELETE | `/api/catalog/titles/:id` | Administrador: elimina un título |
| GET | `/api/catalog/admin/titles` | Administrador: todos los títulos en cualquier estado y región |
| GET | `/health`, `/health/ready` | Estado del servicio y de sus dependencias |

### Variables de entorno

Copia `.env.example` como `.env`. El `.env` real nunca se sube al repositorio (está en `.gitignore`); en Render las variables se configuran en el panel del servicio.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servicio | `3002` |
| `DATABASE_URL` | Conexión a su base PostgreSQL | `postgresql://catalog_user:catalog_pass@localhost:5432/catalog_db?schema=public` |
| `REDIS_URL` | Conexión a Redis | `redis://localhost:6379` |
| `RABBITMQ_URL` | Conexión a RabbitMQ | `amqp://guest:guest@localhost:5672` |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por coma | `http://localhost:3000` |
| `DATABASE_NAME` | Nombre de su base dentro de la instancia compartida de Render Postgres (se crea al arrancar si no existe) (solo en Render) | `catalog_db` |
| `PUBLIC_*_URL` | URLs públicas de los demás servicios (solo en Render) | `https://mediastream-…onrender.com` |

### Instalación y ejecución

Con Docker (levanta el servicio con lo que necesita):

```bash
git clone https://github.com/Josepaez18/mediastream-catalog-service.git
cd mediastream-catalog-service
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

Queda en http://localhost:3002.
<!-- ficha:fin -->


Microservicio de catálogo de MediaStream, implementado según el documento
*"Arquitectura Plataforma Tecnológicas - Momento 1"*.

- **Stack:** Node.js + NestJS, PostgreSQL (Prisma), Redis (cache), RabbitMQ (eventos)
- **Puerto:** 3002
- **Base de datos:** propia (`catalog_db`), patrón *database-per-service*

## 1. Requisitos

- Docker y Docker Compose

No necesitas tener Node, Postgres, Redis ni RabbitMQ instalados en tu máquina:
todo corre dentro de contenedores.

## 2. Levantar todo con Docker Compose

```bash
docker compose up --build
```

Esto levanta 4 contenedores:

| Servicio           | Puerto host | Descripción                          |
|---------------------|------------|---------------------------------------|
| catalog-db          | 5433       | PostgreSQL (BD propia del servicio)   |
| catalog-redis       | 6379       | Cache de consultas frecuentes         |
| catalog-rabbitmq    | 5672 / 15672 | Broker de eventos (UI: 15672, guest/guest) |
| catalog-service     | 3002       | La API de NestJS                      |

Al arrancar, el contenedor `catalog-service` ejecuta automáticamente
`prisma migrate deploy` contra `catalog-db` antes de iniciar el servidor
(ver `Dockerfile`).

## 3. Aplicar la primera migración (solo la primera vez)

Como el repositorio no trae migraciones generadas (se generan a partir del
`schema.prisma`), la primera vez debes crearlas. Con los contenedores ya
arriba:

```bash
# Genera y aplica la migración inicial contra la BD del contenedor
docker compose exec catalog-service npx prisma migrate dev --name init
```

En ejecuciones posteriores (`docker compose up`), el propio contenedor
aplicará las migraciones existentes con `prisma migrate deploy`.

## 4. (Opcional) Cargar datos de prueba

```bash
docker compose exec catalog-service node prisma/seed.js
```

Esto crea una serie (`AVAILABLE`, disponible en `CO` y `MX`) y una película
(`PENDING`, aún sin transcodificar).

> Nota: dentro del contenedor se usa `node prisma/seed.js` (JavaScript puro),
> no `ts-node`, porque la imagen de producción no incluye dependencias de
> desarrollo. Si corres el proyecto en modo desarrollo local (paso 7, sin
> Docker), sí puedes usar `npm run seed` (que sí usa ts-node).

## 5. Documentación interactiva (Swagger UI)

Con el servicio corriendo, abre en el navegador:

```
http://localhost:3002/docs
```

Ahí puedes ver los 4 endpoints documentados (parámetros, cuerpos de petición,
respuestas posibles) y probarlos directamente desde el navegador con el botón
"Try it out", sin necesidad de `curl` ni Postman.

## 6. Probar los endpoints

```bash
# Listar catálogo disponible en Colombia
curl "http://localhost:3002/api/catalog/titles?region=CO"

# Listar catálogo apto para perfiles infantiles
curl "http://localhost:3002/api/catalog/titles?region=CO&isKids=true"

# Detalle de un título (con temporadas y episodios)
curl "http://localhost:3002/api/catalog/titles/1"

# Disponibilidad regional de un título
curl "http://localhost:3002/api/catalog/titles/1/availability"

# Crear un título nuevo (uso administrativo)
curl -X POST "http://localhost:3002/api/catalog/titles" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Nueva Película",
        "type": "MOVIE",
        "category": "Acción",
        "ageRating": "PG-13"
      }'

# Health checks
curl "http://localhost:3002/health"
curl "http://localhost:3002/health/ready"
```

## 7. Simular el evento `media.ready`

Media-Processing-Service todavía no está implementado, así que hay un script
que publica el evento manualmente en RabbitMQ para probar el flujo completo
(Catalog-Service lo consume y marca el título como `AVAILABLE`):

```bash
docker compose exec catalog-service node scripts/publish-media-ready.js 2
```

Después de esto, `GET /api/catalog/titles/2` debería mostrar `status: "AVAILABLE"`
y el título debería aparecer en `GET /api/catalog/titles?region=CO` (si tiene
una disponibilidad vigente para esa región).

Para simular un fallo de transcodificación:

```bash
docker compose exec catalog-service node scripts/publish-media-ready.js 2 media.processing.failed
```

## 8. Desarrollo local (sin reconstruir la imagen en cada cambio)

```bash
docker compose up catalog-db catalog-redis catalog-rabbitmq -d
cp .env.example .env   # y ajusta si es necesario
npm install
npx prisma migrate dev --name init
npm run start:dev
```

## 9. Tests

```bash
npm test
```

## 10. Estructura del proyecto

```
catalog-service/
├── docker-compose.yml       # Postgres + Redis + RabbitMQ + servicio
├── Dockerfile
├── prisma/
│   ├── schema.prisma        # Title, Season, Episode, Availability (3FN)
│   └── seed.ts
├── scripts/
│   └── publish-media-ready.js
└── src/
    ├── catalog/             # Controller, Service y DTOs (los 4 endpoints)
    ├── rabbitmq/             # Consumidor de media.ready / media.processing.failed
    ├── redis/                # Cache de consultas frecuentes
    ├── prisma/               # Cliente de base de datos
    ├── health/               # /health y /health/ready
    └── common/               # request-id + manejo global de errores
```

## 11. Correspondencia con el documento de arquitectura

| Requisito del documento                                   | Dónde está implementado                          |
|-------------------------------------------------------------|---------------------------------------------------|
| 4 endpoints REST del Catalog-Service                       | `src/catalog/catalog.controller.ts`               |
| Tablas title/season/episode/availability, FKs, índices, 3FN | `prisma/schema.prisma`                            |
| Cache con Redis de consultas frecuentes                    | `src/redis/redis.service.ts`                      |
| Consumo asíncrono de `media.ready`                          | `src/rabbitmq/media-events.consumer.ts`           |
| Health checks `/health` y `/health/ready`                  | `src/health/health.controller.ts`                 |
| Logs estructurados JSON + request-id                        | `src/common/request-id.middleware.ts`             |
| Validación de datos (class-validator)                       | `src/catalog/dto/*.ts` + `ValidationPipe` global  |
| Database-per-service                                        | Base de datos `catalog_db` propia (docker-compose)|
| Documentación interactiva de la API                          | Swagger UI en `/docs` (`@nestjs/swagger` en `main.ts` y los DTOs) |

## Colaborador

- **José Páez Teherán** ([@Josepaez18](https://github.com/Josepaez18)) — colaboró en el Catalog Service.
