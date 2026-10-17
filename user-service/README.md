# User Service — MediaStream

<!-- ficha:inicio -->
## Ficha del microservicio

Forma parte de **MediaStream**, una plataforma de streaming construida con microservicios. La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream). Más abajo está el detalle técnico.

### Responsabilidad

Identidad y acceso de la plataforma. Registra cuentas, inicia sesión con JWT (access y refresh token) y administra los perfiles de cada cuenta, con un límite según el plan (GRATIS 1, BÁSICO 2, ESTÁNDAR 4, PREMIUM 5). Guarda el rol (USER o ADMIN), el plan y el estado de la cuenta: pasa a MOROSA o SUSPENDIDA cuando Billing publica `payment.failed`, y cambia de plan con `subscription.activated` y `subscription.canceled`.

Consume de RabbitMQ (exchange `billing.events`) los eventos `payment.failed`, `subscription.activated` y `subscription.canceled`.

### Tecnologías

Node.js 20, NestJS 10, Prisma 5, PostgreSQL 16, RabbitMQ (amqplib y microservicios de Nest), JWT, bcrypt, Swagger y Jest.

### Enlaces

| | |
| --- | --- |
| Despliegue (Render) | https://mediastream-user-3um7.onrender.com |
| Documentación (Swagger) | https://mediastream-user-3um7.onrender.com/docs |
| Estado del servicio | https://mediastream-user-3um7.onrender.com/health |
| Repositorio | https://github.com/Josepaez18/mediastream-user-service |

### Base de datos

Base propia: `user_service_db` (PostgreSQL 16). Ningún otro servicio escribe en ella.

- **Tablas:** `accounts`, `profiles`.
- **Esquema:** migraciones en `prisma/migrations/` (se aplican solas al arrancar el contenedor).
- **Datos de ejemplo:** `database/seed.sql`.
- **Respaldo completo (esquema y datos):** `database/backup.sql`.
- **En producción:** base separada dentro de la instancia Render Postgres `mediastream-db`; la conexión llega por las variables `DATABASE_URL` y `DATABASE_NAME`, nunca en el código.

Restaurar el respaldo en local:

```bash
docker compose up -d user-db
docker compose exec -T user-db psql -U user_service -d user_service_db < database/backup.sql
```

### Endpoints principales

| Método | Ruta | Qué hace |
| --- | --- | --- |
| POST | `/api/users/register` | Crea la cuenta con su primer perfil |
| POST | `/api/users/login` | Inicia sesión y devuelve el access y el refresh token |
| POST | `/api/users/refresh` | Renueva el access token |
| GET | `/api/users/me` | Datos de la cuenta autenticada: rol, plan y estado |
| GET | `/api/users/profiles/:account_id` | Perfiles de una cuenta |
| POST | `/api/users/profiles` | Crea un perfil (respeta el límite del plan) |
| DELETE | `/api/users/profiles/:id` | Elimina un perfil |
| GET | `/api/users/admin/accounts` | Administrador: lista las cuentas |
| PATCH | `/api/users/admin/accounts/:id` | Administrador: cambia rol, plan o estado |
| DELETE | `/api/users/admin/accounts/:id` | Administrador: elimina una cuenta |
| POST | `/api/users/debug/payment-failed` | Simula el evento payment.failed (pruebas) |
| GET | `/health`, `/health/ready` | Estado del servicio y de sus dependencias |

### Variables de entorno

Copia `.env.example` como `.env`. El `.env` real nunca se sube al repositorio (está en `.gitignore`); en Render las variables se configuran en el panel del servicio.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `DATABASE_URL` | Conexión a su base PostgreSQL | `postgresql://user_service:user_service@localhost:5435/user_service_db?schema=public` |
| `RABBITMQ_URL` | Conexión a RabbitMQ | `amqp://guest:guest@localhost:5672` |
| `JWT_ACCESS_SECRET` | Secreto con el que se firman y validan los access token | `dev-access-secret` |
| `JWT_REFRESH_SECRET` | Secreto de los refresh token | `dev-refresh-secret` |
| `JWT_ACCESS_TTL` | Duración del access token | `15m` |
| `JWT_REFRESH_TTL` | Duración del refresh token | `7d` |
| `PORT` | Puerto HTTP del servicio | `3001` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por coma | `*` |
| `DATABASE_NAME` | Nombre de su base dentro de la instancia compartida de Render Postgres (se crea al arrancar si no existe) (solo en Render) | `user_service_db` |
| `ADMIN_EMAIL` | Correo de la cuenta administradora que se crea al arrancar | `admin@mediastream.com` |
| `ADMIN_PASSWORD` | Contraseña de esa cuenta administradora | `cambia-esta-clave` |
| `PUBLIC_*_URL` | URLs públicas de los demás servicios (solo en Render) | `https://mediastream-…onrender.com` |

### Instalación y ejecución

Con Docker (levanta el servicio con lo que necesita):

```bash
git clone https://github.com/Josepaez18/mediastream-user-service.git
cd mediastream-user-service
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

Queda en http://localhost:3001.
<!-- ficha:fin -->


Microservicio de **Usuarios y Suscripciones** (gestión de identidad, autenticación y perfiles
familiares), implementado según el documento *"Arquitectura Plataforma Tecnológicas — Momento 1"*.

> **Alcance de este servicio**: solo identidad, autenticación y perfiles. El plan de
> suscripción y el estado de pago viven en Billing-Service; User-Service únicamente
> reacciona al evento `payment.failed` para restringir el acceso.
>
> **Rol y plan:** cada cuenta tiene un rol (`USER`/`ADMIN`) y un plan (`GRATIS`, `BASICO`,
> `ESTANDAR`, `PREMIUM`). El plan lo actualizan los eventos `subscription.activated` y
> `subscription.canceled` de Billing (misma cola). Endpoints nuevos: `GET /api/users/me`
> (cuenta + token renovado), `POST`/`DELETE /api/users/profiles` (límite según el plan) y, solo
> ADMIN, `GET`/`PATCH`/`DELETE /api/users/admin/accounts`. Un correo no registrado en el login
> responde 404 `ACCOUNT_NOT_FOUND`. `ADMIN_EMAIL`/`ADMIN_PASSWORD` crean el administrador inicial.

## Stack

- **Node.js + NestJS**
- **PostgreSQL** (Prisma ORM) — base de datos propia (`user_service_db`), aislada del resto (database-per-service)
- **RabbitMQ** — comunicación asíncrona (consumo de `payment.failed`)
- **JWT** (AccessToken corto + RefreshToken en cookie `httpOnly`) + **Bcrypt** para contraseñas

## Modelo de datos (Prisma)

Fiel al diagrama entidad-relación del documento, con una extensión justificada:

| Tabla      | Campos                                                                                   |
|------------|-------------------------------------------------------------------------------------------|
| `accounts` | `id` (bigint, PK), `email` (único, indexado), `password_hash`, `created_at`, **`status`**, **`failed_payment_attempts`** |
| `profiles` | `id` (bigint, PK), `account_id` (FK, indexado), `name`, `is_kids`, `created_at`           |

`status` y `failed_payment_attempts` no aparecen en el diagrama entregado, pero son
necesarios para poder implementar la restricción progresiva de acceso que el propio
documento le exige a este servicio (sección "User-Service" y sección 4.2).

## Endpoints REST (síncronos)

| Método | Endpoint                              | Descripción                                                        |
|--------|----------------------------------------|---------------------------------------------------------------------|
| POST   | `/api/users/register`                 | Registra una cuenta junto con su primer perfil.                    |
| POST   | `/api/users/login`                    | Devuelve el AccessToken en el body; el RefreshToken va en una cookie `httpOnly`. |
| POST   | `/api/users/refresh`                  | Verifica el RefreshToken de la cookie y emite un nuevo AccessToken. |
| GET    | `/api/users/profiles/{account_id}`    | Lista los perfiles de una cuenta (requiere `Authorization: Bearer <accessToken>`). |
| GET    | `/health` / `/health/ready`           | Health checks (sección 9 del documento).                            |

Documentación interactiva en `http://localhost:3001/docs` (Swagger).

## Comunicación asíncrona

Consume el evento **`payment.failed`** publicado por Billing-Service vía **RabbitMQ**
(cola `user_service.payment_failed`, mensaje persistente con `ack`/`nack` para reintentos,
tal como indica la sección 4.2/4.6 del documento — RabbitMQ y no Redis Pub/Sub porque este
evento no puede perderse).

Restricción progresiva (acción compensatoria del patrón Saga, sección 4.3):

1er y 2do `payment.failed` → estado `MOROSA` (acceso restringido)
3er `payment.failed` → estado `SUSPENDIDA` (login bloqueado con `403`)

Dentro de la plataforma, el evento lo publica **Billing-Service** (`:3006`) cuando un cobro
es rechazado. Para probar User solo, sin Billing, sigue estando
`scripts/simulate-payment-failed.js`, que publica el mismo evento a mano.

## Cómo correrlo

### Con Docker (recomendado)

Dentro de la plataforma completa, desde la carpeta padre `MediaStream/`:

```bash
docker compose up -d --build user-service
```

O aislado, desde esta carpeta (levanta su propia base y su propio RabbitMQ):

```bash
docker compose up --build
```

Consola web en `http://localhost:3001/`, Swagger en `http://localhost:3001/docs`.
La base de datos queda expuesta en el puerto **5435** del host (5433 y 5434 ya
los usan Catalog y Playback).

### Sin Docker para el servicio (desarrollo)

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Levantar solo PostgreSQL y RabbitMQ con Docker:
   ```bash
   docker compose up -d user-db user-rabbitmq
   ```
   RabbitMQ management UI: http://localhost:15672 (usuario/clave: `guest`/`guest`)

3. Copiar variables de entorno:
   ```bash
   cp .env.example .env
   ```

4. Generar el cliente de Prisma y aplicar la migración:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```
   > Nota: si tu red corporativa bloquea `binaries.prisma.sh`, este paso puede fallar.
   > Es el único dominio externo que Prisma necesita para descargar su motor nativo;
   > en una red normal (sin proxy restrictivo) funciona sin problema.

5. Levantar el servicio:
   ```bash
   npm run start:dev
   ```

## Probar el flujo completo

```bash
# 1. Registrar cuenta + primer perfil
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@correo.com","password":"clave-segura-123","profileName":"Ana","isKids":false}'

# 2. Login (guarda la cookie de refresh)
curl -c cookies.txt -X POST http://localhost:3001/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@correo.com","password":"clave-segura-123"}'
# -> copiar el accessToken de la respuesta

# 3. Listar perfiles de la cuenta (usar el id devuelto en el registro)
curl http://localhost:3001/api/users/profiles/1 \
  -H "Authorization: Bearer <accessToken>"

# 4. Renovar el AccessToken usando la cookie de refresh
curl -b cookies.txt -X POST http://localhost:3001/api/users/refresh

# 5. Simular 3 pagos fallidos consecutivos de Billing-Service (deja la cuenta SUSPENDIDA)
#    Desde la carpeta MediaStream/, dentro del contenedor (ya tiene amqplib):
docker compose exec user-service node scripts/simulate-payment-failed.js 1
docker compose exec user-service node scripts/simulate-payment-failed.js 1
docker compose exec user-service node scripts/simulate-payment-failed.js 1
# -> ahora un nuevo login debe responder 403
```

## Decisiones que quedan documentadas para la sustentación

- **Database-per-service**: `user_service_db` es exclusiva de este microservicio (sección 3 del documento).
- **RabbitMQ vs Redis Pub/Sub**: se eligió RabbitMQ para `payment.failed` porque es un
  evento que no puede perderse (necesita ack + reintento), a diferencia de
  `playback.progress` que sí tolera pérdida ocasional.
- **JWT de dos niveles**: AccessToken corto (15 min) validado sin tocar base de datos;
  RefreshToken (7 días) en cookie `httpOnly`/`Secure`/`SameSite=Lax`, restringido a la
  ruta `/api/users/refresh`, para que no sea accesible desde JavaScript (mitigación XSS,
  sección 10).
- **Guard local de AccessToken**: en producción esta validación la hace el API Gateway
  (sección 5); aquí se incluye para poder levantar y probar User-Service de forma
  aislada mientras el resto del equipo construye el Gateway.
