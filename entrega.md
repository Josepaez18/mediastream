# MediaStream: entrega de microservicios

Arquitectura y Modelamiento de Software · Universidad Cooperativa de Colombia

MediaStream es una plataforma de streaming con 8 microservicios, un API Gateway y un frontend web. Cada microservicio tiene su propio repositorio, su propia base de datos y su enlace de despliegue en Render.

- **Aplicación:** https://mediastream-app.onrender.com
- **Estado de todos los servicios en una sola respuesta:** https://mediastream-gateway-5wjw.onrender.com/health/services
- **Repositorio de la plataforma** (docker-compose de todo, `render.yaml` y pipeline CI/CD): https://github.com/Josepaez18/mediastream

## Repositorios, despliegues y bases de datos

| Microservicio | Repositorio | Despliegue | Base de datos |
| --- | --- | --- | --- |
| User-Service | [mediastream-user-service](https://github.com/Josepaez18/mediastream-user-service) | https://mediastream-user-3um7.onrender.com | `user_service_db` (PostgreSQL) |
| Catalog-Service | [mediastream-catalog-service](https://github.com/Josepaez18/mediastream-catalog-service) | https://mediastream-catalog-t9f9.onrender.com | `catalog_db` (PostgreSQL + Redis) |
| Playback-Service | [mediastream-playback-service](https://github.com/Josepaez18/mediastream-playback-service) | https://mediastream-playback-0ciy.onrender.com | `playback_db` (PostgreSQL + Redis) |
| Media-Processing-Service | [mediastream-media-processing-service](https://github.com/Josepaez18/mediastream-media-processing-service) | https://mediastream-media-zadq.onrender.com | `media_processing_db` (PostgreSQL) |
| Recommendation-Service | [mediastream-recommendation-service](https://github.com/Josepaez18/mediastream-recommendation-service) | https://mediastream-recommendation-rvk4.onrender.com | `recommendation_db` (PostgreSQL + pgvector) |
| Billing-Service | [mediastream-billing-service](https://github.com/Josepaez18/mediastream-billing-service) | https://mediastream-billing-c7bf.onrender.com | `billing_service_db` (PostgreSQL) |
| Notification-Service | [mediastream-notification-service](https://github.com/Josepaez18/mediastream-notification-service) | https://mediastream-notification.onrender.com | Redis (sin base relacional) |
| Analytics-Service | [mediastream-analytics-service](https://github.com/Josepaez18/mediastream-analytics-service) | https://mediastream-analytics.onrender.com | `analytics_db` (PostgreSQL) |
| API Gateway | [mediastream-api-gateway](https://github.com/Josepaez18/mediastream-api-gateway) | https://mediastream-gateway-5wjw.onrender.com | Sin base |
| Frontend | [mediastream-frontend](https://github.com/Josepaez18/mediastream-frontend) | https://mediastream-app.onrender.com | Sin base |

En cada servicio, `/docs` abre la documentación Swagger y `/health/ready` confirma la conexión con su base. Cada repositorio trae:

- `README.md` con responsabilidad, tecnologías, endpoints, variables de entorno e instalación.
- `.env.example` y `.gitignore`.
- Las migraciones de su base.
- La carpeta `database/` con datos de ejemplo (`seed.sql`) y un respaldo restaurable (`backup.sql`).

En producción las 7 bases viven en una instancia Render Postgres (`mediastream-db`), una base separada por servicio. Las credenciales llegan como variables de entorno de Render y nunca están en el código.

## Comunicación entre microservicios

| Evento o llamada | Medio | Lo produce | Lo consume |
| --- | --- | --- | --- |
| `media.ready` | RabbitMQ, exchange `media.events` | Media-Processing | Catalog (deja el título AVAILABLE), Notification |
| `media.processing.failed` | RabbitMQ, exchange `media.events` | Media-Processing | Catalog (deja el título UNAVAILABLE) |
| `payment.failed` | RabbitMQ, exchange `billing.events` | Billing | User (cuenta MOROSA o SUSPENDIDA), Notification |
| `subscription.activated`, `subscription.canceled` | RabbitMQ, exchange `billing.events` | Billing | User (cambia el plan de la cuenta) |
| `playback.progress` | Redis Pub/Sub | Playback | Recommendation |
| `playback.completed` | Redis Pub/Sub | Playback | Recommendation, Notification |
| Validar título, región y licencia | REST síncrono, con timeout, reintentos y circuit breaker | Playback | Catalog |
| Metadatos de los títulos | REST | Recommendation, Notification | Catalog |
| ETL de KPIs | Réplica de solo lectura | Analytics | Bases de Playback y Catalog |
| Todas las rutas `/api/**` del frontend | REST con JWT | Frontend | API Gateway → cada microservicio |

## Integraciones externas

- **PayPal Checkout (sandbox):** pago de los planes Básico, Estándar y Premium con precios de prueba en pesos colombianos (0,1 / 0,2 / 0,3 COP), cobrados en dólares. Se prueba con una cuenta personal de prueba creada en developer.paypal.com → Sandbox → Accounts; no mueve dinero real.
- **YouTube IFrame API:** reproduce el tráiler de 101 de los 103 títulos; si un tráiler no se puede ver, el reproductor pasa a un video de muestra.

## Pruebas por microservicio

Cada servicio tiene pruebas unitarias e integración, y el pipeline las corre con cobertura antes de construir la imagen (si una falla, no hay deploy).

| Microservicio | Unitaria 1 | Unitaria 2 | Integración | Cobertura (sentencias) |
| --- | --- | --- | --- | --- |
| User-Service | `auth.service.spec.ts` › registra la cuenta con la contraseña hasheada (bcrypt) y su primer perfil *(mock de Prisma y bcrypt)* | `payment-restriction.service.spec.ts` › 3er pago fallido: la cuenta queda SUSPENDIDA *(mock de Prisma)* | `auth.integration.spec.ts` › registro → login → perfiles: guarda la cuenta, emite los tokens y aplica el límite del plan *(supertest + PostgreSQL real)* | 54,42 % |
| Catalog-Service | `catalog.service.spec.ts` › listTitles devuelve el resultado cacheado sin ir a la base de datos *(mock de Prisma y Redis)* | `media-events.consumer.spec.ts` › media.ready publicado por Media-Processing marca el título como AVAILABLE *(mock del servicio y del canal)* | `catalog.integration.spec.ts` › crea, lista por región con caché, edita regiones y borra un título contra la base real *(supertest + PostgreSQL + Redis reales)* | 59,76 % |
| Playback-Service | `playback.service.spec.ts` › emite un token cuando el título está disponible en la región *(mocks de Prisma, Redis y Catalog)* | `playback.service.spec.ts` › marca como completado y publica playback.completed al superar el 95% *(mocks)* | `catalog.client.spec.ts` › reintenta 2 veces (3 intentos) ante un 500 *(HTTP real contra un Catalog local; sin PostgreSQL)* | 47,22 % |
| Media-Processing-Service | `test_events.py::test_sin_broker_no_lanza_y_reporta_desconectado` *(monkeypatch de la URL del broker)* | `test_transcoding.py::test_comando_ffmpeg_por_resolucion` *(sin mocks)* | `test_database_render.py::test_crea_la_base_del_servicio_y_aplica_las_migraciones` *(PostgreSQL real)* | 76 % |
| Recommendation-Service | `test_embeddings.py::test_misma_categoria_se_parece_mas_que_distinta` *(sin mocks)* | `test_config.py::test_catalog_service_url_tiene_prioridad` *(sin mocks)* | `test_database_render.py::test_crea_la_base_del_servicio_y_aplica_las_migraciones` *(PostgreSQL + pgvector real)* | 60 % |
| Billing-Service | `billing.service.spec.ts` › pago rechazado → 402 y publica payment.failed para User-Service *(mocks de Prisma, pasarela y eventos)* | `payment-events.service.spec.ts` › publica en billing.events con el formato de Nest que lee User-Service *(mock de amqplib)* | `billing.integration.spec.ts` › suscripción, cobro rechazado, historial y cancelación quedan registrados en la base *(supertest + PostgreSQL real)* | 66,57 % |
| Notification-Service | `notifications.service.spec.ts` › no repite el aviso si RabbitMQ reentrega el evento *(almacén en memoria y mock de Catalog)* | `catalog.client.spec.ts` › devuelve null (sin lanzar) si Catalog no responde *(mock de fetch)* | `notifications.integration.spec.ts` › playback.completed por Redis Pub/Sub y payment.failed quedan en Redis y se leen por la API *(Redis real + HTTP a un Catalog local)* | 54,95 % |
| Analytics-Service | `test_transform.py::test_abandono_es_la_fraccion_que_no_termino` *(sin mocks)* | `test_config.py::test_en_render_arma_las_replicas_con_el_nombre_de_cada_base` *(sin mocks)* | `test_etl_integration.py::test_migra_corre_el_etl_y_sirve_los_kpis` *(PostgreSQL real: ETL + API)* | 86 % |
| API Gateway | `gateway-rules.spec.ts` › ventana fija: corta al pasar el límite y se reinicia al vencer *(sin mocks)* | `gateway-rules.spec.ts` › POST /api/users/login → pública: true *(sin mocks)* | `gateway.middleware.spec.ts` › con token válido inyecta x-account-id e ignora el que intente mandar el cliente *(supertest + servicio de destino HTTP real)* | 60,97 % |

**Cómo se midió la cobertura:** el 14 de noviembre de 2026, con los mismos comandos del pipeline (`npm run test:cov` / `pytest --cov=app`) en Node 20 y Python 3.12, con PostgreSQL 16 (pgvector para Recommendation), Redis 7 y FFmpeg reales, de modo que las pruebas de integración también se ejecutaron. Es el porcentaje de sentencias de todo el código del servicio (`src/` o `app/`).

**Pendiente:** en Recommendation, Analytics y API Gateway las pruebas unitarias no usan mocks (prueban funciones puras), y en Media-Processing solo una los usa. La integración de Playback usa HTTP real pero no su PostgreSQL.

Comandos de cada servicio (detalle en su README):

```bash
npm test              # Node: unitarias + integración (Jest)
npm run test:cov      # Node: con reporte de cobertura en coverage/
pytest --cov=app      # Python: con reporte de cobertura
```

Las pruebas de integración necesitan `TEST_ADMIN_DATABASE_URL` (PostgreSQL donde se puedan crear bases) y, en Catalog y Notification, `TEST_REDIS_URL`; sin ellas se omiten. En GitHub Actions el job *Lint y pruebas* levanta PostgreSQL y Redis efímeros, define esas variables y publica el reporte como artefacto `cobertura-<servicio>`.

## Monitoreo (Prometheus y Grafana)

Los 9 servicios exponen `GET /metrics` (sin JWT y, en el Gateway, sin rate limiting) con:

| Métrica | Qué mide |
| --- | --- |
| `up` | Disponibilidad: 1 si Prometheus pudo leer `/metrics` del servicio en su último intento |
| `http_requests_total{method, route, status}` | Número de peticiones |
| `http_request_duration_seconds` (histograma) | Tiempos de respuesta (latencia p95) |
| `http_requests_total{status=~"5.."}` | Tasa de errores |
| `process_*`, `nodejs_*`, `python_*` | Métricas por defecto del proceso (CPU, memoria) |

Prometheus las consulta cada 15 s y Grafana las muestra en el tablero **MediaStream — Servicios**, con paneles de estado UP/DOWN por servicio, peticiones por segundo, latencia p95 y tasa de errores 5xx, más un selector de servicio. La configuración está versionada en `monitoring/`: `prometheus.yml` (local), `prometheus.render.yml` (Render), el datasource y el tablero JSON en `monitoring/grafana/`.

**En Render** (`render.yaml`): dos Web Services gratis, `mediastream-prometheus` y `mediastream-grafana`, que Render construye desde `monitoring/` al sincronizar el Blueprint. Prometheus consulta la URL pública de cada servicio.

- Targets: `https://mediastream-prometheus.onrender.com/targets`
- Tablero: `https://mediastream-grafana.onrender.com` (se ve sin iniciar sesión; la contraseña de `admin` está en Render, en las variables de `mediastream-grafana`: `GF_SECURITY_ADMIN_PASSWORD`).
- Si Render les asigna otra URL (con sufijo), corrígela en `render.yaml` (`PROMETHEUS_URL`).
- Plan gratis: los servicios dormidos aparecen DOWN, y Prometheus y Grafana pierden el historial al dormirse. Antes de mostrar el tablero, lanza **Render - mantener despierto**, que ahora también despierta a Prometheus y Grafana.

**En local:**

```bash
docker compose up -d --build     # los 9 servicios + Prometheus + Grafana
```

- Prometheus: http://localhost:9090/targets (los 9 targets deben estar en UP).
- Grafana: http://localhost:3030 (el 3000 lo usa el frontend). Se ve sin iniciar sesión; para editar, `admin` / `admin`.

## Estrategia de ramas

Es la que definen los workflows de `.github/workflows/`:

| Rama | Para qué | Qué corre en GitHub Actions |
| --- | --- | --- |
| `main` | Producción | En cada push: CI (lint, pruebas con cobertura, escaneo de secretos) → imagen en GHCR → deploy en Render |
| `develop` | Integración y staging | En cada push: lo mismo, con deploy al servicio de staging. En los Pull Request hacia `develop`, solo el CI |
| `feature/<tema>` | Cada cambio (p. ej. `feature/momento3-monitoreo-cobertura`) | Nada por sí sola: se integra con un Pull Request hacia `develop` |

Si una prueba o el lint fallan, el pipeline se detiene: no se construye la imagen ni se despliega.

**Pendiente de decidir:** la rama `develop` no existe en el repositorio remoto ni hay secretos `RENDER_STAGING_SERVICE_ID_*`. Hoy los cambios llegan directo a `main`, y un Pull Request hacia `main` no ejecuta el CI (los workflows solo lo hacen para Pull Requests hacia `develop`).

## Matriz de cumplimiento de requerimientos

*Pendiente de completar con los datos del equipo.*

| Microservicio | Requerimientos asignados | Requerimientos cumplidos | % de cumplimiento |
| --- | --- | --- | --- |
| User-Service | | | |
| Catalog-Service | | | |
| Playback-Service | | | |
| Media-Processing-Service | | | |
| Recommendation-Service | | | |
| Billing-Service | | | |
| Notification-Service | | | |
| Analytics-Service | | | |
| API Gateway | | | |

## Evidencias (capturas)

*Pendiente de agregar las capturas.*

1. **GitHub Actions en verde:** una ejecución de un workflow de servicio con *Lint y pruebas* y *Escaneo de secretos* en verde y el artefacto `cobertura-<servicio>` en la sección *Artifacts*.
2. **Despliegue automático:** una ejecución sobre `main` con *CI → Build Docker y push a GHCR → Deploy a Render* en verde, y el deploy correspondiente en estado *Live* en el dashboard de Render.
3. **Prueba fallida que bloquea el deploy:** una ejecución en la que *Lint y pruebas* falla y los jobs de imagen y deploy quedan omitidos.
4. **Dashboard de Grafana:** el tablero *MediaStream — Servicios* con datos en sus cuatro paneles.
5. **Targets en UP:** la página `/targets` de Prometheus con los 9 servicios en UP.

## Antes de la revisión

En el plan gratis, Render duerme cada servicio tras 15 minutos sin uso y tarda cerca de un minuto en despertarlo. Unos 10 minutos antes de la revisión, en GitHub → Actions → **Render - mantener despierto** → Run workflow, indica las horas que dure la revisión. Así todos los servicios responden al instante mientras tanto.

La base de datos gratis de Render vence a los 30 días de creada. Si los servicios dejan de responder con `P1001: Can't reach database server` en sus logs, en GitHub → Actions → **Render - recrear la base de datos** → Run workflow, escribe `RECREAR`: borra la base vencida, crea una nueva, apunta los 7 servicios a ella, los redespliega y vuelve a cargar los títulos de demostración. Los datos anteriores (cuentas, suscripciones, progreso) no se recuperan.

Para probar las funciones de administrador, comparte en privado con el docente el correo `admin@mediastream.com` y su contraseña. La contraseña está en Render, en las variables de entorno de `mediastream-user` (`ADMIN_PASSWORD`).
