# Analytics-Service

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
