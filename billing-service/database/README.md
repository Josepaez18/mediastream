# Base de datos de billing-service

Base propia del servicio: `billing_service_db` (PostgreSQL 16).

| Archivo | Qué contiene |
| --- | --- |
| `backup.sql` | Respaldo completo: esquema (tablas, índices, tipos y registro de migraciones) y datos. Restaura la base desde cero. |
| `seed.sql` | Solo los datos de ejemplo, como `INSERT … ON CONFLICT DO NOTHING`. Se carga sobre una base ya migrada. |
| `../prisma/migrations/` | El esquema como migraciones; el servicio las aplica solo al arrancar. |

## Datos de ejemplo

Salen de usar la plataforma completa en local (registro, pagos, reproducción y procesamiento), así que entre bases son coherentes: los `account_id`, `profile_id` y `title_id` de un servicio existen en los demás.

| Tabla | Filas | Contenido |
| --- | --- | --- |
| `subscriptions` | 10 | suscripciones: 5 activas y 5 con pago fallido |
| `payments` | 12 | pagos simulados: 7 exitosos y 5 rechazados (los de PayPal sandbox están en producción) |

## Restaurar

Respaldo completo, desde la carpeta del servicio:

```bash
docker compose up -d billing-db
docker compose exec -T billing-db psql -U billing_service -d billing_service_db < database/backup.sql
```

Solo los datos de ejemplo, con el servicio ya arrancado (migraciones aplicadas):

```bash
docker compose exec -T billing-db psql -U billing_service -d billing_service_db < database/seed.sql
```
