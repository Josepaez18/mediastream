# Base de datos de recommendation-service

Base propia del servicio: `recommendation_db` (PostgreSQL 16 con pgvector).

| Archivo | Qué contiene |
| --- | --- |
| `backup.sql` | Respaldo completo: esquema (tablas, índices, tipos y registro de migraciones) y datos. Restaura la base desde cero. |
| `seed.sql` | Solo los datos de ejemplo, como `INSERT … ON CONFLICT DO NOTHING`. Se carga sobre una base ya migrada. |
| `../alembic/versions/` | El esquema como migraciones; el servicio las aplica solo al arrancar. |

## Datos de ejemplo

Salen de usar la plataforma completa en local (registro, pagos, reproducción y procesamiento), así que entre bases son coherentes: los `account_id`, `profile_id` y `title_id` de un servicio existen en los demás.

| Tabla | Filas | Contenido |
| --- | --- | --- |
| `content_embedding` | 119 | vectores de títulos (64 dimensiones, pgvector) |
| `profile_embedding` | 66 | vectores de perfiles |
| `profile_interaction` | 1.191 | interacciones perfil-título |

## Restaurar

Respaldo completo, desde la carpeta del servicio:

```bash
docker compose up -d recommendation-db
docker compose exec -T recommendation-db psql -U reco_user -d recommendation_db < database/backup.sql
```

Solo los datos de ejemplo, con el servicio ya arrancado (migraciones aplicadas):

```bash
docker compose exec -T recommendation-db psql -U reco_user -d recommendation_db < database/seed.sql
```
