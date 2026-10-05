# API Gateway

Único punto de entrada de MediaStream para los clientes (sección 5 del documento). Recibe todas
las peticiones HTTP y las enruta al microservicio correspondiente; el cliente nunca conoce las
direcciones internas de los servicios.

- **Puerto**: 8080
- **Sin estado ni base de datos**: si un servicio de destino está caído, solo sus rutas
  responden 502; las demás siguen funcionando.

## Enrutamiento

| Prefijo | Servicio |
|---|---|
| `/api/users/*` | User |
| `/api/catalog/*` | Catalog |
| `/api/playback/*` | Playback |
| `/api/media/*` | Media Processing |
| `/api/recommendations/*` | Recommendation |
| `/api/billing/*` | Billing |
| `/api/notifications/*` | Notification |
| `/api/analytics/*` | Analytics |

La ruta y el query string se reenvían intactos, y el cuerpo se transmite sin parsear (las
subidas de vídeo a Media pasan como llegan). La URL de cada servicio sale de
`<SERVICIO>_SERVICE_URL`, si no de `PUBLIC_<SERVICIO>_URL` (Render) y si no de localhost.
`GET /` muestra la tabla de rutas con sus destinos.

## Responsabilidades

**Autenticación centralizada y validación de tokens.** Verifica firma (HS256) y expiración
del AccessToken con el mismo `JWT_ACCESS_SECRET` con que lo firma User-Service, sin
consultarle. Si es válido, agrega `x-account-id` y `x-account-email` hacia el servicio de
destino. Esas cabeceras se **borran** si las manda el cliente: solo el Gateway puede ponerlas.
Un token expirado responde 401 y el cliente lo renueva con `POST /api/users/refresh` (la cookie
httpOnly del refresh token solo la valida User-Service).

Rutas públicas (sin token): `POST /api/users/register|login|refresh`, lectura del catálogo
(`GET /api/catalog/*`) y `POST /api/billing/webhook` (lo llama la pasarela, no un usuario).

El token también trae el **rol, el plan y el estado** de la cuenta: se pasan como
`x-account-role`, `x-account-plan` y `x-account-status` (y se borran si los manda el cliente).

**Rutas de administración** (403 si el rol no es ADMIN): `/api/users/admin/*`,
`/api/billing/admin/*`, `/api/catalog/admin/*`, las escrituras del catálogo
(`POST`/`PATCH`/`DELETE /api/catalog/*`), `/api/media/*` y `/api/analytics/*`.

**Rate limiting.** Ventana fija de un minuto, por cuenta si hay sesión y si no por IP:

| Regla | Rutas | Límite/min |
|---|---|---|
| sensible | login, registro, refresh | 10 |
| cobros | `/api/billing/*` (menos el webhook) | 20 |
| lectura | `GET /api/catalog/*` | 300 |
| por defecto | el resto | 120 |

Al pasarse responde 429 con `Retry-After`; toda respuesta lleva `X-RateLimit-*`. Los contadores
están en memoria: exactos con una instancia; con varias habría que llevarlos a Redis.

**Logging.** Asigna un `x-request-id` (o respeta el que llega), lo propaga al servicio de
destino y registra una línea JSON por solicitud: método, ruta, código, latencia, cuenta y
servicio. Con ese id se sigue una petición por los logs de varios servicios (sección 9).

**CORS.** Solo los orígenes de `CORS_ORIGINS` (en Render, el frontend). Las cabeceras CORS de
los servicios de destino se descartan para que no se dupliquen con las del Gateway.

**Timeouts.** Si un servicio no responde en `PROXY_TIMEOUT_MS` (15 s), 504; si está caído, 502.

**Servicios dormidos (Render, plan gratis).** Render apaga un servicio tras 15 min sin tráfico
y solo lo despierta una visita desde **fuera** de Render; a las peticiones del Gateway su borde
les responde 502 `x-render-routing: no-deploy`. El Gateway lo traduce a **503**
`{"code": "SERVICE_WAKING", "service": "...", "serviceUrl": "..."}`: la petición no llegó al
servicio, así que el frontend visita `serviceUrl` desde el navegador (lo despierta) y reintenta,
también en registros y pagos. Al abrir la app, y cada 10 min con la pestaña visible, el frontend
despierta todos los servicios.

**Cabeceras de la plataforma.** Antes de reenviar se quitan las que Cloudflare y Render agregan
a la petición entrante (`cf-*`, `rndr-id`, `render-proxy-ttl`, `cdn-loop`, `x-forwarded-*`, …):
identifican al Gateway y no deben llegar a los servicios. `GET /health/headers` lista los
nombres de las cabeceras que llegan (sin valores), para diagnóstico.

## Health

| Endpoint | |
|---|---|
| `/health` · `/health/ready` | El Gateway está vivo y listo |
| `/health/services` | Estado de cada servicio de destino (su `/health/ready`) |

## Ejecutar y probar

```bash
docker compose up --build          # aislado, alcanza los servicios por mediastream-net
cd .. && docker compose up -d      # con toda la plataforma
npm run lint && npm test
```

```bash
# Login a través del Gateway y uso del token en una ruta protegida
TOKEN=$(curl -s -X POST localhost:8080/api/users/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@correo.com","password":"clave-segura-123"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
curl -s localhost:8080/api/playback/resume/1 -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/playback/resume/1   # 401 sin token
```
