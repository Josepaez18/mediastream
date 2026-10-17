# Base de datos de analytics-service

Base propia del servicio: `analytics_db` (PostgreSQL 16).

| Archivo | Qué contiene |
| --- | --- |
| `backup.sql` | Respaldo completo: esquema (tablas, índices, tipos y registro de migraciones) y datos. Restaura la base desde cero. |
| `seed.sql` | Solo los datos de ejemplo, como `INSERT … ON CONFLICT DO NOTHING`. Se carga sobre una base ya migrada. |
| `../alembic/versions/` | El esquema como migraciones; el servicio las aplica solo al arrancar. |

## Datos de ejemplo

Salen de usar la plataforma completa en local (registro, pagos, reproducción y procesamiento), así que entre bases son coherentes: los `account_id`, `profile_id` y `title_id` de un servicio existen en los demás.

| Tabla | Filas | Contenido |
| --- | --- | --- |
| `hours_watched_daily` | 68 | horas vistas por perfil y día |
| `abandonment_by_episode` | 97 | tasa de abandono por título o episodio |
| `popularity_by_region` | 188 | reproducciones por título y región |
| `title_dim` | 104 | nombres y categorías de los títulos |
| `etl_run` | 50 | últimas corridas del ETL |

## Restaurar

Respaldo completo, desde la carpeta del servicio:

```bash
docker compose up -d analytics-db
docker compose exec -T analytics-db psql -U analytics_user -d analytics_db < database/backup.sql
```

Solo los datos de ejemplo, con el servicio ya arrancado (migraciones aplicadas):

```bash
docker compose exec -T analytics-db psql -U analytics_user -d analytics_db < database/seed.sql
```
