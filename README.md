# MediaStream

Plataforma de streaming construida como microservicios. Cada servicio es autónomo:
tiene su propia base de datos (o ninguna), su propio ciclo de despliegue y no comparte
código con los demás — ni siquiera el lenguaje: cinco están hechos en Node.js/NestJS y
tres en Python/FastAPI. Delante de todos hay un API Gateway (NestJS).

```
MediaStream/
├── docker-compose.yml             ← levanta toda la plataforma junta
├── user-service/                  ← NestJS · autónomo, con su propio compose
├── catalog-service/               ← NestJS · autónomo, con su propio compose
├── playback-service/              ← NestJS · autónomo, con su propio compose
├── media-processing-service/      ← FastAPI · autónomo, con su propio compose
├── recommendation-service/        ← FastAPI + pgvector · autónomo, con su propio compose
├── billing-service/               ← NestJS · autónomo, con su propio compose
├── notification-service/          ← NestJS + Redis (sin base relacional) · autónomo
├── analytics-service/             ← FastAPI · ETL sobre réplicas de solo lectura · autónomo
├── api-gateway/                   ← NestJS · punto de entrada único (sin estado)
├── frontend/                      ← único frontend (HTML/CSS/JS estático)
└── scripts/
    └── verificar-independencia.sh
```

---

## Levantar todo

```bash
docker compose up -d --build
```

La primera vez tarda varios minutos (nueve imágenes, más FFmpeg para Media).

| Servicio | Consola | Swagger | Base de datos | Responsabilidad |
|---|---|---|---|---|
| User | http://localhost:3001 | `/docs` | `user_service_db` · 5435 | Cuentas, login JWT, perfiles, restricción por pagos fallidos |
| Catalog | http://localhost:3002 | `/docs` | `catalog_db` · 5433 | Títulos, temporadas, disponibilidad regional |
| Playback | http://localhost:3003 | `/docs` | `playback_db` · 5434 | Token DRM, progreso, "seguir viendo" |
| Media Processing | http://localhost:3004 | `/docs` | `media_processing_db` · 5436 | Transcodificación con FFmpeg, publica `media.ready` |
| Recommendation | http://localhost:3005 | `/docs` | `recommendation_db` · 5437 (pgvector) | Sugerencias híbridas: contenido + colaborativo |
| Billing | http://localhost:3006 | `/docs` | `billing_service_db` · 5438 | Suscripciones, pagos (Stripe simulado), publica `payment.failed` |
| Notification | http://localhost:3007 | `/docs` | — (Redis) | Avisos de estrenos, series en curso y pagos rechazados |
| Analytics | http://localhost:3008 | `/docs` | `analytics_db` · 5439 | KPIs de audiencia con ETL sobre réplicas de Playback y Catalog |
| **API Gateway** | http://localhost:8080 | — | — | Enrutamiento, JWT, rate limiting, request-id, CORS |
| RabbitMQ (admin) | http://localhost:15672 | — | — | `guest` / `guest` |

## Trabajar en un solo servicio

Cada carpeta tiene su propio `docker-compose.yml` para desarrollarlo aislado:

```bash
cd media-processing-service
docker compose up --build
```

---

## Las consolas

> El frontend de la aplicación es uno solo (`frontend/`, en Render como Static Site), con una
> sección por servicio, incluidas Notificaciones y Analítica. Las consolas por servicio que
> se describen a continuación existen solo en los seis primeros servicios, como herramienta
> de desarrollo.

Las seis consolas web usan el mismo sistema visual (tipografía, estructura,
componentes), pero cada servicio tiene su color para reconocerlo de un vistazo:
User violeta, Catalog dorado, Playback azul, Media Processing rosa, Recommendation
verde azulado y Billing lima.

Todas tienen en la barra lateral un **selector de servicios** que enlaza con las
demás y muestra en vivo si cada una responde. Si apagas un contenedor, su punto se
pone rojo en todas las consolas a los pocos segundos: es la forma más visual de
mostrar que la caída de uno no arrastra a los demás.

El selector está **copiado** en cada consola, no compartido: cada una es un
archivo servido por su propio microservicio. Duplicar 40 líneas de HTML es más
barato que acoplar el despliegue de seis servicios.

---

## Qué los mantiene siendo microservicios

Correr juntos no los convierte en monolito. Lo que decide eso es **qué comparten**.

### Lo que NO se comparte

**Bases de datos.** Cada servicio tiene la suya y ninguno se conecta a la de otro.
Cuando Playback necesita saber si un título está disponible, le pregunta a la API
de Catalog. Cuando Media termina de transcodificar, no escribe en la tabla `title`:
publica un evento y Catalog reacciona. Si un servicio leyera las tablas de otro,
un cambio de esquema lo rompería en silencio — eso es un monolito distribuido.

**Código fuente.** Ningún servicio importa clases de otro. Si dos necesitan la
misma forma de datos, cada uno declara la suya.

**Tecnología.** Media Processing y Recommendation están en Python porque FFmpeg y
las librerías de vídeo y de cálculo vectorial encajan mejor ahí; Recommendation,
además, es el único con la extensión pgvector en su base. Los demás no se enteran:
solo ven HTTP y eventos.

**Despliegue.** Cada uno tiene su `Dockerfile` y se reconstruye y reinicia solo.

### Lo que SÍ se comparte (y está bien)

**Redis y RabbitMQ.** Son el medio de comunicación, no un almacén de datos de
dominio. Un servicio publica un evento sin saber quién lo escucha. (Notification usa
además Redis como su almacenamiento ligero, con claves propias `notifications:*` y
`dedup:*`.)

**La excepción documentada: Analytics.** El documento lo define como un ETL sobre
*réplicas de solo lectura* de Playback-DB y Catalog-DB. Lee esas bases con la conexión
en modo `default_transaction_read_only` (no puede escribir), solo con `SELECT` sobre
columnas concretas, y todas esas consultas viven en un único archivo
(`analytics-service/app/etl/extract.py`). Así las consultas pesadas no compiten con los
servicios transaccionales.

**La red Docker** (`mediastream-net`), que solo permite que se resuelvan por nombre.

---

## Cómo se comunican

```
 ┌──────────────────────┐    payment.failed         ┌─────────────────┐
 │ Billing-Service      │    cola                   │  User-Service   │ :3001
 │ :3006 (Stripe simul.)│ ─────── RabbitMQ ────────▶│                 │
 └──────────────────────┘    user_service.          └─────────────────┘
                             payment_failed

 ┌──────────────────────┐    media.ready            ┌─────────────────┐
 │ Media-Processing     │    media.processing.failed│ Catalog-Service │ :3002
 │ :3004 (Python)       │ ─────── RabbitMQ ────────▶│                 │
 └──────────────────────┘    exchange media.events  └────────▲────────┘
                                                             │
                                          REST síncrono      │
                                          ¿disponible en CO? │
                                                             │
                                                    ┌────────┴────────┐
                                                    │ Playback-Service│ :3003
                                                    └────────┬────────┘
                                                             │ Redis Pub/Sub
                                                             │ playback.progress
                                                             │ playback.completed
                                                             ▼
                                                  ┌─────────────────────┐
                                                  │ Recommendation      │ :3005
                                                  │ (Python + pgvector) │── REST ──▶ Catalog
                                                  └─────────────────────┘  (metadatos,
                                                                            región)
```

| Comunicación | Tipo | Por qué ese tipo |
|---|---|---|
| Playback → Catalog | REST síncrono | La respuesta decide si se emite el token: hay que esperarla |
| Media → Catalog | RabbitMQ | `media.ready` no puede perderse; si Catalog está caído, espera en la cola |
| Billing → User | RabbitMQ | `payment.failed` no puede perderse (restricción de acceso) |
| Playback → Recommendation | Redis Pub/Sub | Alto volumen; perder un `progress` ocasional no importa |
| Recommendation → Catalog | REST síncrono | Metadatos para los vectores y filtro de región; si falla, recomienda igual |
| Billing → Notification | RabbitMQ | El mismo `payment.failed`, en una cola propia de Notification |
| Media → Notification | RabbitMQ | El mismo `media.ready`, en una cola propia: aviso de estreno |
| Playback → Notification | Redis Pub/Sub | `playback.completed` de un episodio: "sigue con el siguiente" |
| Notification → Catalog | REST síncrono | Solo el nombre del título para el texto; si falla, avisa igual |
| Analytics ← Playback-DB, Catalog-DB | ETL periódico (solo lectura) | Consultas pesadas fuera de los servicios transaccionales |
| Cliente → Gateway → servicio | REST (proxy) | Punto de entrada único: JWT, rate limiting, request-id |

### Contrato del evento `media.ready`

| | |
|---|---|
| Exchange | `media.events` (topic, durable) |
| Routing keys | `media.ready`, `media.processing.failed` |
| Payload | `{"title_id": "1", "job_id": "…", "processed_at": "…"}` |

Catalog acepta `title_id` (como lo manda Python) y `titleId` (como lo manda el
script de simulación). El test `catalog-service/src/rabbitmq/media-events.consumer.spec.ts`
fija este contrato.

### Contrato del evento `payment.failed`

| | |
|---|---|
| Exchange | `billing.events` (topic, durable) · routing key `payment.failed` · mensajes persistentes |
| Mensaje | `{"pattern": "payment.failed", "data": {"accountId": "1", "eventId": "…", "occurredAt": "…"}}` (formato de Nest) |
| Publica | Billing, cuando un cobro es rechazado (al suscribirse, al cambiar de plan o por webhook) |
| Consume | User, en `user_service.payment_failed`: 1.º y 2.º → cuenta `MOROSA`; 3.º → `SUSPENDIDA` (no puede iniciar sesión) |
| Consume | Notification, en `notification_service.payment_failed`: aviso a la cuenta (deduplicado por `eventId`) |

Billing declara y enlaza la cola de User al publicar, así que el evento queda guardado
aunque User no haya arrancado nunca. Notification declara y enlaza la suya.

### Tolerancia a fallos

Ningún servicio declara `depends_on: catalog-service`. Es a propósito. Si Catalog
se cae:

- Playback sigue emitiendo tokens de los títulos que ya conocía: cada llamada a Catalog
  tiene timeout de 2 s y 2 reintentos con backoff, y tras 3 fallos seguidos un
  **circuit breaker** deja de llamarlo durante 30 s y usa la última información
  conocida (secciones 4.5–4.7). Solo un título que nunca había consultado responde
  503. El progreso se sigue guardando (solo usa su base).
- Media sigue transcodificando. Sus eventos `media.ready` quedan guardados en la
  cola de RabbitMQ y Catalog los procesa cuando vuelve.
- Recommendation sigue recomendando con los vectores que ya tiene; solo pierde el
  filtro por región y los nombres de los títulos en su consola.

Y si se cae Recommendation, la reproducción no se entera: Playback publica sus
eventos en Redis y sigue adelante.

Si se cae User, Billing sigue cobrando: los `payment.failed` esperan en la cola y User
los procesa al volver. Billing tampoco declara `depends_on: user-service`.

Si se cae Notification, nadie se entera: sus eventos esperan en sus colas (salvo los
`playback.completed` de Pub/Sub, que se pierden sin consecuencias). Si se cae Analytics,
tampoco: nadie depende de él. Y si Playback-DB o Catalog-DB no responden, el ETL falla,
queda registrado y el panel sigue mostrando los últimos KPIs.

Si se cae un servicio detrás del API Gateway, solo sus rutas responden 502.

---

## Verificar que son independientes

```bash
bash scripts/verificar-independencia.sh
```

Comprueba que cada una de las siete bases tenga solo sus tablas, que reiniciar un
servicio no afecte a los otros, que Playback, Media, Recommendation, Billing,
Notification, Analytics y el Gateway sobrevivan a la caída de Catalog, que un
`payment.failed` publicado con User apagado espere en su cola (y que Notification reciba
el suyo igual), y que no haya imports cruzados. Apaga y enciende
`catalog-service` y `user-service` durante la prueba, así que córrelo solo en desarrollo
(necesita Git Bash o WSL en Windows).

---

## Probar el flujo completo

1. **User** (`:3001`): registra una cuenta e inicia sesión.
2. **Catalog** (`:3002`): crea un título con disponibilidad en `CO`. Queda `PENDING`.
3. **Media Processing** (`:3004`): en *Nuevo ingest*, pon el ID del título y sube
   `media-processing-service/samples/muestra-5s.mp4`. El job pasa a `completed`
   en unos segundos y publica `media.ready`.
4. **Catalog**: busca con región `CO`. El título ya está `AVAILABLE`, sin haber
   corrido ningún script.
5. **Playback** (`:3003`): pide el token DRM para ese título y reprodúcelo con el
   perfil `1`.
6. **Recommendation** (`:3005`): carga títulos variados y una audiencia simulada
   (ver `recommendation-service/README.md`); las recomendaciones del perfil `1` cambian
   solas mientras reproduces.
7. **Billing** (`:3006`): suscribe la cuenta con la tarjeta `4242 4242 4242 4242`, luego
   en *Aviso de pago* marca un pago rechazado. Vuelve a iniciar sesión en User: la cuenta
   aparece `MOROSA`, sin que Billing haya llamado a User.
8. **Notification** (`:3007`): `GET /api/notifications/1?accountId=1` muestra el estreno
   del paso 3 y el aviso de pago del paso 7, generados solo a partir de eventos.
9. **Analytics** (`:3008`): `POST /api/analytics/etl/run` y luego `GET /api/analytics/kpis`:
   horas vistas, abandono y popularidad por región con la reproducción del paso 5.
10. **API Gateway** (`:8080`): repite cualquiera de los pasos por `localhost:8080/api/...`;
    las rutas protegidas piden `Authorization: Bearer <AccessToken>` (ver `api-gateway/README.md`).

La guía `guia-demostracion.md` tiene cada comando para copiar y pegar.

---

## Lint y pruebas

Cada servicio se prueba solo, desde su carpeta:

| Servicio | Lint | Pruebas |
|---|---|---|
| User, Catalog, Playback, Billing, Notification, API Gateway | `npm run lint` (ESLint) | `npm test` (Jest) |
| Media, Recommendation, Analytics | `flake8 .` | `pytest` (con `pip install -r requirements-dev.txt`) |

Las pruebas de integración de los servicios Python (migraciones contra un PostgreSQL
real) solo corren si `TEST_ADMIN_DATABASE_URL` está definida; el pipeline la define.

## Pipeline CI/CD y despliegue en Render

Secciones 7 y 8 del documento de arquitectura:

- **`.github/workflows/`**: un workflow por microservicio, todos con el mismo pipeline
  (`_pipeline-servicio.yml`): `npm ci`/`pip install` → lint → tests (unitarios y de
  integración contra PostgreSQL) → imagen Docker → GitHub Container Registry (etiquetada
  con el SHA) → deploy hook de Render con esa misma imagen. Solo corre el del servicio que
  cambió; en los Pull Requests hacia `develop` solo corren lint y tests.
- **`render.yaml`**: Blueprint de Render con los nueve Web Services (desde las imágenes de
  GHCR), una instancia de Render Postgres con una base propia por servicio, Render Key
  Value (Redis) y RabbitMQ en CloudAMQP. Notification y el Gateway no tienen base, así que
  su pipeline omite los pasos de Prisma (`prisma: false`).

El paso a paso (cuentas, secretos y verificación) está en la guía
**MediaStream — Despliegue en Render**.

---

## Agregar un servicio nuevo

1. Carpeta propia con su manifiesto de dependencias, `Dockerfile`, migraciones y
   `docker-compose.yml` aislado.
2. Su bloque en el `docker-compose.yml` raíz: base de datos propia y el servicio
   conectado a `mediastream-net`, con un puerto libre (3009 en adelante; bases desde el 5440).
3. Comunicación por REST (si necesita la respuesta) o eventos (si solo notifica).
   Nunca por base de datos compartida.
4. Su ruta en el API Gateway (`api-gateway/src/proxy/routes.ts`), su workflow en
   `.github/workflows/`, su Web Service en `render.yaml` y su sección en `frontend/`.

Con Notification-Service, Analytics-Service y el API Gateway, la plataforma cubre todos
los componentes del documento de arquitectura.
