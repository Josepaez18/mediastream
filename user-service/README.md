# User Service — MediaStream

Microservicio de **Usuarios y Suscripciones** (gestión de identidad, autenticación y perfiles
familiares), implementado según el documento *"Arquitectura Plataforma Tecnológicas — Momento 1"*.

> **Alcance de este servicio**: solo identidad, autenticación y perfiles. El plan de
> suscripción y el estado de pago viven en Billing-Service; User-Service únicamente
> reacciona al evento `payment.failed` para restringir el acceso.

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
