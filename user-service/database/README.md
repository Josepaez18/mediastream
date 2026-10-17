# Base de datos de user-service

Base propia del servicio: `user_service_db` (PostgreSQL 16).

| Archivo | Qué contiene |
| --- | --- |
| `backup.sql` | Respaldo completo: esquema (tablas, índices, tipos y registro de migraciones) y datos. Restaura la base desde cero. |
| `seed.sql` | Solo los datos de ejemplo, como `INSERT … ON CONFLICT DO NOTHING`. Se carga sobre una base ya migrada. |
| `../prisma/migrations/` | El esquema como migraciones; el servicio las aplica solo al arrancar. |

## Datos de ejemplo

Salen de usar la plataforma completa en local (registro, pagos, reproducción y procesamiento), así que entre bases son coherentes: los `account_id`, `profile_id` y `title_id` de un servicio existen en los demás.

| Tabla | Filas | Contenido |
| --- | --- | --- |
| `accounts` | 11 | cuentas: 1 administradora y 10 de demostración con distintos planes y estados |
| `profiles` | 15 | perfiles, algunos infantiles |

## Cuentas de demostración

Las 10 cuentas de usuario usan correos `@example.com` (por ejemplo `ana.lopez@example.com`) y la contraseña `Demo12345!`. La administradora local es `admin@mediastream.com` con `Admin12345!`, la misma del docker-compose. En producción la contraseña del administrador es otra y está solo en las variables de entorno de Render.

## Restaurar

Respaldo completo, desde la carpeta del servicio:

```bash
docker compose up -d user-db
docker compose exec -T user-db psql -U user_service -d user_service_db < database/backup.sql
```

Solo los datos de ejemplo, con el servicio ya arrancado (migraciones aplicadas):

```bash
docker compose exec -T user-db psql -U user_service -d user_service_db < database/seed.sql
```
