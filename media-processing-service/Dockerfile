FROM python:3.12-slim

# FFmpeg es una dependencia de sistema, no de pip: necesaria para el
# wrapper de transcodificación (adaptive bitrate streaming).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=3004
EXPOSE 3004

# DATABASE_NAME (solo en Render): los seis servicios comparten la instancia
# gratuita de Render Postgres, pero cada uno usa SU PROPIA base dentro de
# ella (database-per-service). Si está definida, reemplaza el nombre de la
# base al final de DATABASE_URL y scripts/ensure_database.py la crea si
# todavía no existe. En local no se define y no cambia nada.
# Ejecuta migraciones pendientes (Alembic) y luego arranca el servicio,
# igual que el patrón de arranque del resto de microservicios de MediaStream.
CMD ["sh", "-c", "if [ -n \"$DATABASE_NAME\" ]; then export DATABASE_ADMIN_URL=\"$DATABASE_URL\" DATABASE_URL=\"${DATABASE_URL%/*}/$DATABASE_NAME\" && python scripts/ensure_database.py || exit 1; fi; alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
