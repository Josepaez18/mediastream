# Base de datos de catalog-service

Base propia del servicio: `catalog_db` (PostgreSQL 16).

| Archivo | Qué contiene |
| --- | --- |
| `backup.sql` | Respaldo completo: esquema (tablas, índices, tipos y registro de migraciones) y datos. Restaura la base desde cero. |
| `seed.sql` | Solo los datos de ejemplo, como `INSERT … ON CONFLICT DO NOTHING`. Se carga sobre una base ya migrada. |
| `../prisma/migrations/` | El esquema como migraciones; el servicio las aplica solo al arrancar. |

## Datos de ejemplo

Salen de usar la plataforma completa en local (registro, pagos, reproducción y procesamiento), así que entre bases son coherentes: los `account_id`, `profile_id` y `title_id` de un servicio existen en los demás.

| Tabla | Filas | Contenido |
| --- | --- | --- |
| `title` | 104 | títulos: 103 películas y series reales disponibles, con póster (101 con tráiler de YouTube), y 1 en estado PENDING esperando su video |
| `season` | 89 | temporadas |
| `episode` | 1.226 | episodios con su duración |
| `availability` | 206 | licencias por región (CO, MX, …) |

## Restaurar

Respaldo completo, desde la carpeta del servicio:

```bash
docker compose up -d catalog-db
docker compose exec -T catalog-db psql -U catalog_user -d catalog_db < database/backup.sql
```

Solo los datos de ejemplo, con el servicio ya arrancado (migraciones aplicadas):

```bash
docker compose exec -T catalog-db psql -U catalog_user -d catalog_db < database/seed.sql
```
