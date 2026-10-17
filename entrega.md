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

## Antes de la revisión

En el plan gratis, Render duerme cada servicio tras 15 minutos sin uso y tarda cerca de un minuto en despertarlo. Unos 10 minutos antes de la revisión, en GitHub → Actions → **Render - mantener despierto** → Run workflow, indica las horas que dure la revisión. Así todos los servicios responden al instante mientras tanto.

Para probar las funciones de administrador, comparte en privado con el docente el correo `admin@mediastream.com` y su contraseña. La contraseña está en Render, en las variables de entorno de `mediastream-user` (`ADMIN_PASSWORD`).
