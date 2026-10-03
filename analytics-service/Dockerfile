FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=3008
EXPOSE 3008

# DATABASE_NAME (solo en Render): todos los servicios comparten la instancia
# gratuita de Render Postgres, pero cada uno usa SU PROPIA base dentro de
# ella (database-per-service). Si está definida, reemplaza el nombre de la
# base al final de DATABASE_URL y scripts/ensure_database.py la crea si
# todavía no existe. DATABASE_ADMIN_URL conserva la URL original: con ella
# y PLAYBACK/CATALOG_REPLICA_DATABASE_NAME se arman las URLs de las réplicas.
# Luego ejecuta las migraciones pendientes y arranca el servicio.
CMD ["sh", "-c", "if [ -n \"$DATABASE_NAME\" ]; then export DATABASE_ADMIN_URL=\"$DATABASE_URL\" DATABASE_URL=\"${DATABASE_URL%/*}/$DATABASE_NAME\" && python scripts/ensure_database.py || exit 1; fi; alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
