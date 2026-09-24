# Billing Service — MediaStream

Microservicio de **Facturación** (suscripciones, cambios de plan, historial y notificaciones
de pago), implementado según el documento *"Arquitectura Plataformas Tecnológicas — Momento 1"*
(sección "6. Billing-Service" y sección 4 "Estrategia de Comunicación entre Microservicios").

> **Alcance de este servicio**: solo suscripciones y pagos. La identidad, autenticación y
> perfiles viven en User-Service; Billing-Service solo conoce el `account_id` como una
> referencia lógica (no hay join entre bases de datos, cada servicio tiene la suya).

## Stack

- **Node.js + NestJS**
- **PostgreSQL** (Prisma ORM) — base de datos propia (`billing_service_db`), aislada del resto (database-per-service)
- **RabbitMQ** — comunicación asíncrona (publica `payment.failed`)
- Pasarela de pago **simulada** (ver más abajo, sección "Sobre la simulación de pagos")
- Puerto **3006** · base de datos en el **5438** del host (dentro de MediaStream, del 3001 al
  3005 y del 5433 al 5437 ya están ocupados por los otros servicios)

## Modelo de datos (Prisma)

Fiel al diagrama entidad-relación del documento (sección 6):

| Tabla           | Campos                                                                                      |
|-----------------|-----------------------------------------------------------------------------------------------|
| `subscriptions` | `id` (bigint, PK), `account_id` (referencia lógica, indexada), `plan`, `status`, `next_billing_date`, `created_at` |
| `payments`      | `id` (bigint, PK), `subscription_id` (FK, indexada), `amount`, `status`, `paid_at`, `created_at` |

## Endpoints REST (síncronos)

| Método | Endpoint                            | Descripción                                                              |
|--------|--------------------------------------|----------------------------------------------------------------------------|
| POST   | `/api/billing/subscribe`            | Crea una suscripción y procesa el primer cobro.                            |
| PUT    | `/api/billing/plan`                 | Cambia el plan de una suscripción activa y cobra la diferencia.            |
| GET    | `/api/billing/history/{account_id}` | Historial de suscripciones y pagos de una cuenta.                          |
| POST   | `/api/billing/webhook`              | Notificación entrante de la pasarela sobre un cobro (ej. una renovación).  |
| GET    | `/health` / `/health/ready`         | Health checks (sección 9 del documento).                                   |

Documentación interactiva en `http://localhost:3006/docs` (Swagger).
Consola web (sin necesidad de Swagger ni de código) en `http://localhost:3006/`, con el mismo
diseño que las otras consolas de MediaStream (color lima) y el selector de servicios.

Los IDs (`accountId`, `subscriptionId`) deben ser numéricos: si no, la API responde 400 con un
mensaje claro en lugar de un error 500.

## Sobre la simulación de pagos

No hay credenciales reales de Stripe para este proyecto de curso, así que `StripeService`
(`src/stripe/stripe.service.ts`) simula el cobro usando la misma convención de tarjetas de
prueba que Stripe usa en su propio modo de pruebas:

| Número de tarjeta      | Resultado simulado                                                     |
|-------------------------|--------------------------------------------------------------------------|
| `4242 4242 4242 4242`  | Pago **exitoso**                                                         |
| `4000 0000 0000 0002`  | Pago **rechazado**                                                       |
| cualquier otro número  | **Sin respuesta** de la pasarela (timeout simulado) → se trata como pago **pendiente**, no como un rechazo (sección 4.5 del documento) |

Para integrar Stripe de verdad más adelante, solo hay que reemplazar el cuerpo de
`StripeService.charge()` por una llamada al SDK oficial (`STRIPE_SECRET_KEY` ya está
documentada en `.env.example`, sin usarse todavía).

## Comunicación asíncrona

Cuando un cobro es rechazado (ya sea al suscribirse, al cambiar de plan, o mediante el aviso
de `/api/billing/webhook`), Billing-Service publica el evento **`payment.failed`** hacia
**RabbitMQ**, en la **misma cola que User-Service ya consume** (`user_service.payment_failed`).
Es la acción del patrón Saga por coreografía descrito en la sección 4.3 del documento:
Billing-Service completa su transacción local y User-Service reacciona de forma independiente,
restringiendo el acceso de la cuenta de forma progresiva.

Contrato con User-Service (si cambia uno, cambia el otro):

| | |
|---|---|
| Cola | `user_service.payment_failed` (durable) |
| Patrón | `payment.failed` |
| Payload | `{"accountId": "1"}` — Nest lo envía como `{"pattern": "payment.failed", "data": {...}}` |
| Entrega | mensajes **persistentes**: sobreviven a un reinicio de RabbitMQ |

> **Importante**: para que el evento le llegue a User-Service, los dos tienen que usar el
> **mismo RabbitMQ**. El `docker-compose.yml` de la carpeta `MediaStream/` ya los conecta al
> broker compartido. Billing **no** llama a User: si User está caído, el evento espera en la
> cola y se procesa cuando vuelva.

Si RabbitMQ no responde en el momento del rechazo, Billing registra el error en su log,
responde igual (en menos de 3 s) y en el siguiente evento abre una conexión nueva: se
recupera solo cuando el broker vuelve, sin reiniciar el servicio.

## Cómo correrlo

### Dentro de la plataforma (recomendado)

Desde la carpeta `MediaStream/`:

```bash
docker compose up -d --build billing-service
```

Levanta `billing-db` y usa el RabbitMQ compartido. Consola: http://localhost:3006

### Aislado, con Docker

```bash
cd billing-service
docker compose up --build
```

Trae su propia base (5438) y su propio RabbitMQ (5674, panel en 15674). Sirve para
trabajar solo en Billing: `payment.failed` se queda en la cola porque aquí no hay User-Service.

### En local, sin Docker para el servicio

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Levantar la base de datos propia con Docker:
   ```bash
   docker compose up -d billing-db
   ```

3. Copiar variables de entorno:
   ```bash
   cp .env.example .env
   ```

4. Generar el cliente de Prisma y aplicar la migración:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```
   > Nota: si tu red bloquea `binaries.prisma.sh`, este paso puede fallar. Es el único
   > dominio externo que Prisma necesita para descargar su motor nativo; en una red normal
   > funciona sin problema (a User-Service le funcionó bien).

5. Levantar el servicio:
   ```bash
   npm run start:dev
   ```
   Por defecto queda escuchando en el puerto **3006**.

## Probar el flujo completo (para mostrar al profesor)

Con la plataforma levantada (`docker compose up -d --build` desde `MediaStream/`):

1. Abre `http://localhost:3001/` (User-Service) y crea una cuenta en la pestaña "Cuenta".
   Anota el número de cuenta que te muestra.
2. Abre `http://localhost:3006/` (Billing-Service) y, en la pestaña "Suscripción", usa ese
   mismo número de cuenta con la tarjeta de prueba `4242 4242 4242 4242` → la suscripción
   queda activa.
3. Anota el número de suscripción que te devuelve.
4. Ve a la pestaña "Aviso de pago", usa ese número de suscripción y elige "Pago rechazado" →
   esto simula que un cobro recurrente falló.
5. Vuelve a `http://localhost:3001/` (User-Service) e **inicia sesión otra vez** con esa
   cuenta: en la barra lateral aparece **MOROSA**. Esa restricción llegó por el evento
   asíncrono que publicó Billing-Service, sin que los dos servicios se hayan llamado entre sí.
   En los logs de User se ve la línea
   `Cuenta 1: intento fallido #1 -> estado MOROSA` (`docker compose logs user-service`).
6. Repite el paso 4 dos veces más: al tercer rechazo la cuenta queda **SUSPENDIDA** y el
   login de User responde que está suspendida.

También se puede probar todo por Swagger (`/docs`) en lugar de la consola web, con las
mismas rutas de la tabla de arriba.

```bash
# Ejemplo con curl: suscribirse, cambiar de plan y consultar historial
curl -X POST http://localhost:3006/api/billing/subscribe \
  -H "Content-Type: application/json" \
  -d '{"accountId":"1","plan":"ESTANDAR","cardNumber":"4242424242424242"}'

curl -X PUT http://localhost:3006/api/billing/plan \
  -H "Content-Type: application/json" \
  -d '{"accountId":"1","newPlan":"PREMIUM","cardNumber":"4242424242424242"}'

curl http://localhost:3006/api/billing/history/1

# Simular que un cobro recurrente fue rechazado (dispara payment.failed hacia User-Service)
curl -X POST http://localhost:3006/api/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{"subscriptionId":"1","eventType":"payment_failed"}'
```

## Decisiones que quedan documentadas para la sustentación

- **Database-per-service**: `billing_service_db` es exclusiva de este microservicio (sección 3
  del documento); `account_id` se guarda como una referencia lógica, sin llave foránea real.
- **RabbitMQ compartido, bases de datos separadas**: es exactamente el patrón que describe el
  documento — cada microservicio tiene su propia base de datos, pero el broker de mensajería
  (RabbitMQ) es infraestructura central y compartida entre servicios.
- **Pago "pendiente" distinto de "rechazado"**: el documento pide explícitamente (sección 4.5)
  tratar un timeout de la pasarela como un pago pendiente, no como un rechazo automático. Por
  eso el simulador de Stripe tiene tres resultados posibles (no solo éxito/fallo), y solo el
  rechazo dispara la acción compensatoria del patrón Saga.
- **`POST /api/billing/webhook` siempre responde 200**: es la convención real de un webhook de
  pagos — el 200 confirma que el aviso fue recibido y procesado, no que el cobro haya sido
  exitoso (eso lo indica el cuerpo de la respuesta).
- **Prorrateo simplificado**: al cambiar de plan se cobra la diferencia entre precios de los
  planes, en vez de calcular los días exactos restantes del ciclo de facturación. Está
  señalado como simplificación en el código (`billing.service.ts`).
- **Publicación de eventos best-effort**: si RabbitMQ no está disponible al momento de publicar
  `payment.failed`, el error se registra en el log pero no revierte el cobro ya guardado en la
  base de datos de Billing-Service. Un sistema en producción resolvería esto con un patrón
  Outbox para garantizar la entrega; se documenta como simplificación pedagógica en el código.
  Lo que sí está resuelto: Billing no se queda "sin broker" para siempre tras un fallo (vuelve
  a conectar en el siguiente evento) y los mensajes que ya están en la cola son persistentes.
