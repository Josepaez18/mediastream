#!/usr/bin/env bash
# ============================================================================
# publicar-repos.sh
#
# Publica cada microservicio en su propio repositorio de GitHub
# (Josepaez18/mediastream-<carpeta>), con el historial de commits que tocaron
# su carpeta (git subtree split). Si el repositorio no existe, lo crea público
# con su descripción y el enlace de despliegue.
#
# Este repositorio sigue siendo el de la plataforma: aquí están el
# docker-compose, render.yaml y el pipeline que construye y despliega. Después
# de hacer commits aquí, vuelve a correr el script para actualizar los repos
# de cada servicio (el push no usa --force: si alguien hizo commits directo en
# el repo de un servicio, el script se detiene en vez de borrarlos).
#
# Uso (desde la carpeta MediaStream, con Git Bash y `gh auth login` hecho):
#   bash scripts/publicar-repos.sh                 # todos
#   bash scripts/publicar-repos.sh billing-service # solo uno
# ============================================================================
set -euo pipefail

OWNER="${OWNER:-Josepaez18}"
cd "$(git rev-parse --show-toplevel)"

# carpeta | despliegue | descripción
SERVICIOS=(
  "user-service|https://mediastream-user-3um7.onrender.com|MediaStream · User-Service: registro, login con JWT, perfiles, roles y estado de la cuenta (NestJS, Prisma, PostgreSQL, RabbitMQ)"
  "catalog-service|https://mediastream-catalog-t9f9.onrender.com|MediaStream · Catalog-Service: películas, series, episodios y licencias por región (NestJS, Prisma, PostgreSQL, Redis, RabbitMQ)"
  "playback-service|https://mediastream-playback-0ciy.onrender.com|MediaStream · Playback-Service: token de reproducción, progreso y seguir viendo (NestJS, Prisma, PostgreSQL, Redis)"
  "media-processing-service|https://mediastream-media-zadq.onrender.com|MediaStream · Media-Processing-Service: ingesta y transcodificación de video (FastAPI, PostgreSQL, RabbitMQ, FFmpeg)"
  "recommendation-service|https://mediastream-recommendation-rvk4.onrender.com|MediaStream · Recommendation-Service: recomendaciones híbridas con embeddings (FastAPI, PostgreSQL + pgvector, Redis)"
  "billing-service|https://mediastream-billing-c7bf.onrender.com|MediaStream · Billing-Service: planes, suscripciones y pagos con PayPal sandbox (NestJS, Prisma, PostgreSQL, RabbitMQ)"
  "notification-service|https://mediastream-notification.onrender.com|MediaStream · Notification-Service: avisos a partir de los eventos de la plataforma (NestJS, Redis, RabbitMQ)"
  "analytics-service|https://mediastream-analytics.onrender.com|MediaStream · Analytics-Service: ETL y KPIs de consumo, Top 10 por región (FastAPI, PostgreSQL)"
  "api-gateway|https://mediastream-gateway-5wjw.onrender.com|MediaStream · API Gateway: enrutamiento, validación de JWT, permisos y rate limiting (NestJS)"
  "frontend|https://mediastream-app.onrender.com|MediaStream · Frontend: aplicación web tipo Netflix con pagos PayPal y tráileres de YouTube (HTML, CSS, JS)"
)

FILTRO=("$@")
for linea in "${SERVICIOS[@]}"; do
  IFS='|' read -r carpeta despliegue descripcion <<< "$linea"
  if [ ${#FILTRO[@]} -gt 0 ] && [[ ! " ${FILTRO[*]} " == *" $carpeta "* ]]; then continue; fi
  repo="$OWNER/mediastream-$carpeta"
  echo "== $carpeta → github.com/$repo"

  if ! gh repo view "$repo" >/dev/null 2>&1; then
    gh repo create "$repo" --public --description "$descripcion" --homepage "$despliegue" >/dev/null
    echo "   repositorio creado"
  fi

  sha=$(git subtree split --prefix="$carpeta" HEAD 2>/dev/null)
  git push --quiet "https://github.com/$repo.git" "$sha:refs/heads/main"
  echo "   main → ${sha:0:7} ($(git rev-list --count "$sha") commits)"
done
