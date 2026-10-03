# Notification-Service

Microservicio de **notificaciones** de MediaStream (NestJS). Avisa de nuevos estrenos, de la
continuación de series en curso y de pagos rechazados. Su única responsabilidad es escuchar
eventos de otros servicios y traducirlos en avisos: no tiene lógica de negocio propia ni
decide nada que le corresponda a otro servicio.

- **Puerto**: 3007 · Swagger en `/docs`
- **Persistencia**: sin base relacional. **Redis** guarda el historial reciente (100 avisos por
  destinatario) y deduplica lo ya enviado.
- **Canales**: correo y push **simulados**: cada envío deja una línea JSON
  (`"event":"notification.sent"`) en el log, que es donde se conectaría el proveedor real.

## Qué escucha

| Evento | Medio | Publica | Aviso | Destinatario |
|---|---|---|---|---|
| `media.ready` | RabbitMQ · exchange `media.events` · cola `notification.media-events` | Media-Processing | "Nuevo estreno: …" (push) | todos los perfiles |
| `payment.failed` | RabbitMQ · exchange `billing.events` · cola `notification_service.payment_failed` | Billing | "No pudimos procesar tu pago" (correo + push) | la cuenta |
| `playback.completed` | Redis Pub/Sub | Playback | "Sigue viendo …: temporada X, episodio Y" (push) | el perfil |

- Las colas de RabbitMQ son **propias**: Catalog y User tienen las suyas en los mismos
  exchanges, así que cada servicio recibe su copia del evento. Si Notification está caído,
  sus mensajes esperan en su cola sin afectar a nadie.
- `playback.completed` llega por Pub/Sub: si Notification está caído en ese momento, el
  evento se pierde. Se acepta (sección 4.2): un "sigue viendo" perdido no es crítico.
- Películas y último episodio de una serie no generan aviso de continuación.

### Deduplicación

Antes de enviar, se reserva una clave en Redis con `SET NX EX`. Si RabbitMQ reentrega un
mensaje (por ejemplo, tras un reinicio), la clave ya existe y el aviso no se repite.

| Evento | Clave | Vigencia |
|---|---|---|
| `media.ready` | `media.ready:{titleId}` (un estreno se anuncia una vez) | 30 días |
| `payment.failed` | `payment.failed:{eventId}` (cada rechazo real avisa) | 7 días |
| `playback.completed` | `playback.completed:{perfil}:{episodio}` | 7 días |

Si el envío falla después de reservar, la clave se libera para que el reintento sí avise.

### Catalog, solo para el texto

Para poner el nombre del título en el aviso, Notification consulta `GET /api/catalog/titles/{id}`
(timeout de 2 s). Si Catalog no responde, el estreno se anuncia igual como "Título #3".

## API

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/notifications/{profile_id}?accountId=&limit=` | Historial del perfil: sus avisos, los estrenos y, con `accountId`, los de la cuenta. Más recientes primero. |
| GET | `/health` · `/health/ready` | Vivo · listo (Redis obligatorio; RabbitMQ y Pub/Sub se reportan) |

## Ejecutar

```bash
docker compose up --build          # aislado: servicio + su Redis + su RabbitMQ
cd .. && docker compose up -d      # con toda la plataforma
```

En local sin Docker: `npm ci`, copiar `.env.example` a `.env` y `npm run start:dev`.

## Lint y pruebas

```bash
npm run lint
npm test
```
