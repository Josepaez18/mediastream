# Analytics-Service

<!-- ficha:inicio -->
## Ficha del microservicio

Forma parte de **MediaStream**, una plataforma de streaming construida con microservicios. La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream). Más abajo está el detalle técnico.

### Responsabilidad

Indicadores de negocio. Un ETL periódico lee las réplicas de solo lectura de Playback y Catalog y calcula horas vistas por día, abandono por episodio y popularidad por región. Con esos datos arma el Top 10 que muestra el frontend y el panel de KPIs del administrador.

Lee (solo lectura) las bases de Playback y Catalog; no escribe en ellas.

### Tecnologías

Python 3.12, FastAPI 0.115, SQLAlchemy 2, Alembic y PostgreSQL 16.

### Enlaces

| | |
| --- | --- |
| Despliegue (Render) | https://mediastream-analytics.onrender.com |
| Documentación (Swagger) | https://mediastream-analytics.onrender.com/docs |
| Estado del servicio | https://mediastream-analytics.onrender.com/health |
| Repositorio | https://github.com/Josepaez18/mediastream-analytics-service |

### Base de datos

Base propia: `analytics_db` (PostgreSQL 16). Ningún otro servicio escribe en ella.

- **Tablas:** `hours_watched_daily`, `abandonment_by_episode`, `popularity_by_region`, `title_dim`, `etl_run`.
- **Esquema:** migraciones en `alembic/versions/` (se aplican solas al arrancar el contenedor).
- **Datos de ejemplo:** `database/seed.sql`.
- **Respaldo completo (esquema y datos):** `database/backup.sql`.
- **En producción:** base separada dentro de la instancia Render Postgres `mediastream-db`; la conexión llega por las variables `DATABASE_URL` y `DATABASE_NAME`, nunca en el código.

Restaurar el respaldo en local:

```bash
docker compose up -d analytics-db
docker compose exec -T analytics-db psql -U analytics_user -d analytics_db < database/backup.sql
```

### Endpoints principales

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/analytics/top` | Top 10 de títulos por región |
| GET | `/api/analytics/kpis` | Administrador: horas vistas, abandono y popularidad |
| POST | `/api/analytics/etl/run` | Administrador: ejecuta el ETL en el momento |
| GET | `/health`, `/health/ready` | Estado del servicio y de sus dependencias |

### Variables de entorno

Copia `.env.example` como `.env`. El `.env` real nunca se sube al repositorio (está en `.gitignore`); en Render las variables se configuran en el panel del servicio.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servicio | `3008` |
| `DATABASE_URL` | Conexión a su base PostgreSQL | `postgresql+psycopg2://analytics_user:analytics_pass@localhost:5439/analytics_db` |
| `PLAYBACK_REPLICA_URL` | Réplica de solo lectura de la base de Playback (fuente del ETL) | `postgresql+psycopg2://playback_user:playback_pass@localhost:5434/playback_db` |
| `CATALOG_REPLICA_URL` | Réplica de solo lectura de la base de Catalog (fuente del ETL) | `postgresql+psycopg2://catalog_user:catalog_pass@localhost:5433/catalog_db` |
| `ETL_INTERVAL_SECONDS` | Cada cuánto se recalculan los KPIs (s) | `300` |
| `ETL_INITIAL_DELAY_SECONDS` | Espera antes del primer ETL (s) | `10` |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por coma | `*` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `DATABASE_NAME` | Nombre de su base dentro de la instancia compartida de Render Postgres (se crea al arrancar si no existe) (solo en Render) | `analytics_db` |
| `PLAYBACK_REPLICA_DATABASE_NAME` | Nombre de la base de Playback en Render (solo en Render) | `playback_db` |
| `CATALOG_REPLICA_DATABASE_NAME` | Nombre de la base de Catalog en Render (solo en Render) | `catalog_db` |

### Instalación y ejecución

Con Docker (levanta el servicio con lo que necesita):

```bash
git clone https://github.com/Josepaez18/mediastream-analytics-service.git
cd mediastream-analytics-service
cp .env.example .env
docker compose up -d
```

Sin Docker para el servicio (necesita su base y el broker corriendo):

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 3008
pytest   # pruebas
```

Queda en http://localhost:3008.
<!-- ficha:fin -->


Microservicio de **analítica de audiencia** de MediaStream (Python + FastAPI). Expone un panel
de KPIs calculado con un **ETL periódico sobre réplicas de solo lectura** de Playback-DB y
Catalog-DB, para que las consultas pesadas no compitan con los servicios transaccionales.

- **Puerto**: 3008 · Swagger en `/docs`
- **Base propia**: `analytics_db` (PostgreSQL, puerto 5439 en el host)

## KPIs

| Métrica | Tabla | Cómo se calcula |
|---|---|---|
| Horas vistas | `hours_watched_daily` | Por perfil y día, la suma de lo visto de cada título/episodio (posición guardada en Playback, nunca más que la duración) |
| Tasa de abandono | `abandonment_by_episode` | Por título y episodio: fracción de perfiles que lo empezaron y no lo terminaron. Las películas cuentan como un único episodio (`episode_id` NULL) |
| Popularidad por región | `popularity_by_region` | Perfiles distintos que vieron cada título, en cada región donde Catalog lo tiene licenciado |

Tablas de apoyo: `title_dim` (nombre y categoría de cada título, copiados de Catalog en cada
ETL, para mostrar nombres sin consultar a Catalog en vivo) y `etl_run` (registro de cada
ejecución: cuándo, cuántas filas, si falló).

> Playback no registra desde qué región se reproduce, así que la "región" de la popularidad
> es la del acuerdo de licencia. Registrar la región real requeriría que Playback la guardara.

## El ETL

1. **Extrae** de las réplicas (`app/etl/extract.py`): solo `SELECT` sobre columnas concretas,
   con la conexión en modo `default_transaction_read_only`, así que PostgreSQL rechaza
   cualquier escritura. Todas las consultas a bases ajenas están en ese archivo.
2. **Transforma** con funciones puras (`app/etl/transform.py`), probadas sin base de datos.
3. **Carga** reemplazando las tablas de KPIs en **una sola transacción**: quien consulta el
   panel mientras corre el ETL ve los KPIs anteriores completos, nunca una mezcla.

Corre cada `ETL_INTERVAL_SECONDS` (300 por defecto; 60 en el compose) y también a demanda con
`POST /api/analytics/etl/run`. Si una réplica no responde, el fallo queda en `etl_run`, se
reintenta en el siguiente ciclo y el panel sigue mostrando los últimos KPIs.

### Réplicas en cada entorno

| Entorno | Réplicas |
|---|---|
| Docker Compose | Las bases de Playback y Catalog, en solo lectura (`PLAYBACK_REPLICA_URL`, `CATALOG_REPLICA_URL`) |
| Render (gratis) | No hay réplicas de lectura: las bases originales de la misma instancia, en solo lectura (`*_REPLICA_DATABASE_NAME`) |
| Producción real | Réplicas de lectura de PostgreSQL: solo cambian las URLs |

Es el único lugar de MediaStream donde un servicio lee la base de otro, y es a propósito: así
lo define el documento para Analytics.

## API

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/analytics/kpis?region=&limit=&days=` | Totales, horas por día, rankings de abandono y popularidad, último ETL |
| POST | `/api/analytics/etl/run` | Ejecuta el ETL ahora (útil en la demo) |
| GET | `/health` · `/health/ready` | Vivo · listo (solo su base es obligatoria) |

## Ejecutar

```bash
docker compose up --build          # aislado (las réplicas se alcanzan por mediastream-net)
cd .. && docker compose up -d      # con toda la plataforma
```

## Lint y pruebas

```bash
pip install -r requirements-dev.txt
flake8 .
pytest
```

La prueba de integración (migraciones, ETL contra réplicas reales, bloqueo de escrituras y
endpoint de KPIs) solo corre si `TEST_ADMIN_DATABASE_URL` apunta a un PostgreSQL; el pipeline
de CI la define.
