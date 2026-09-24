# Catalog-Service — MediaStream

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
