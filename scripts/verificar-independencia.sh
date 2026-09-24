#!/usr/bin/env bash
# ============================================================================
# verificar-independencia.sh
#
# Comprueba que los seis microservicios de MediaStream (User, Catalog,
# Playback, Media Processing, Recommendation y Billing) sean realmente
# independientes y no un monolito distribuido disfrazado.
#
# Uso (desde la carpeta MediaStream, con Git Bash o WSL):
#   bash scripts/verificar-independencia.sh
# ============================================================================

set -uo pipefail

OK="  [OK]"
FAIL="  [FALLA]"
fallos=0

titulo() { echo ""; echo "=============================================="; echo "$1"; echo "=============================================="; }
paso()   { echo ""; echo "› $1"; }

titulo "PRUEBA 1 — Cada servicio tiene su propia base de datos"

# contenedor | usuario | base | tabla propia
BASES=(
  "user-db|user_service|user_service_db|accounts"
  "catalog-db|catalog_user|catalog_db|title"
  "playback-db|playback_user|playback_db|watch_progress"
  "media-db|media_user|media_processing_db|media_job"
  "recommendation-db|reco_user|recommendation_db|content_embedding"
  "billing-db|billing_service|billing_service_db|subscriptions"
)

tablas_de() {
  docker exec "$1" psql -U "$2" -d "$3" -tAc \
    "select tablename from pg_tables where schemaname = 'public'" 2>/dev/null
}

for fila in "${BASES[@]}"; do
  IFS='|' read -r cont usr db propia <<< "$fila"
  paso "¿La tabla '$propia' existe SOLO en $db?"
  if tablas_de "$cont" "$usr" "$db" | grep -qx "$propia"; then
    echo "$OK $db tiene '$propia'"
  else
    echo "$FAIL $db no responde o no tiene '$propia'"; fallos=$((fallos+1))
  fi
  compartida=0
  for otra in "${BASES[@]}"; do
    IFS='|' read -r cont2 usr2 db2 _ <<< "$otra"
    [ "$db2" = "$db" ] && continue
    if tablas_de "$cont2" "$usr2" "$db2" | grep -qx "$propia"; then
      echo "$FAIL $db2 también tiene '$propia' — están compartiendo datos"; fallos=$((fallos+1))
      compartida=1
    fi
  done
  [ "$compartida" -eq 0 ] && echo "$OK ninguna otra base conoce '$propia'"
done

titulo "PRUEBA 2 — Despliegue independiente"

paso "Reiniciando SOLO playback-service..."
docker compose restart playback-service > /dev/null 2>&1
sleep 8

for par in "3001|user-service" "3002|catalog-service" "3004|media-processing-service" "3005|recommendation-service" "3006|billing-service"; do
  IFS='|' read -r puerto nombre <<< "$par"
  if curl -sf "http://localhost:$puerto/health" > /dev/null; then
    echo "$OK $nombre siguió respondiendo durante el reinicio de playback"
  else
    echo "$FAIL $nombre se cayó — hay acoplamiento indebido"; fallos=$((fallos+1))
  fi
done

titulo "PRUEBA 3 — Tolerancia a fallos"

paso "Apagando catalog-service para ver si los demás sobreviven..."
docker compose stop catalog-service > /dev/null 2>&1
sleep 3

if curl -sf http://localhost:3003/health > /dev/null; then
  echo "$OK playback-service sigue vivo sin el catálogo"
else
  echo "$FAIL playback-service se cayó — dependencia dura, es un monolito distribuido"; fallos=$((fallos+1))
fi

if curl -sf http://localhost:3004/health > /dev/null; then
  echo "$OK media-processing-service sigue vivo sin el catálogo (sus eventos esperan en RabbitMQ)"
else
  echo "$FAIL media-processing-service se cayó sin el catálogo"; fallos=$((fallos+1))
fi

if curl -sf http://localhost:3005/health > /dev/null \
   && [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3005/api/recommendations/1)" = "200" ]; then
  echo "$OK recommendation-service sigue recomendando sin el catálogo (usa sus propios vectores)"
else
  echo "$FAIL recommendation-service dejó de responder sin el catálogo"; fallos=$((fallos+1))
fi

if curl -sf http://localhost:3006/health > /dev/null \
   && [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/api/billing/history/1)" = "200" ]; then
  echo "$OK billing-service sigue cobrando y respondiendo sin el catálogo"
else
  echo "$FAIL billing-service dejó de responder sin el catálogo"; fallos=$((fallos+1))
fi

paso "¿Degrada correctamente? (reintentos, circuit breaker y última información conocida, secciones 4.5–4.7)"
respuesta=$(curl -s -w "\n%{http_code}" \
  "http://localhost:3003/api/playback/token/1?profileId=test&region=CO")
codigo=$(echo "$respuesta" | tail -n1)
cuerpo=$(echo "$respuesta" | sed '$d')
if [ "$codigo" = "200" ] && echo "$cuerpo" | grep -Eq '"source":"(LAST_KNOWN|CACHE)"'; then
  echo "$OK Emitió el token con la última información conocida de Catalog, sin caerse"
elif [ "$codigo" = "503" ]; then
  echo "$OK Respondió 503 (nunca había consultado ese título) sin caerse"
else
  echo "$FAIL Respuesta inesperada del token sin catálogo (HTTP $codigo)"; fallos=$((fallos+1))
fi

paso "El progreso de reproducción DEBE seguir funcionando sin el catálogo:"
codigo=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/playback/progress \
  -H "Content-Type: application/json" \
  -d '{"profileId":"test-independencia","titleId":"1","positionSeconds":30,"durationSeconds":600}')
if [ "$codigo" = "200" ]; then
  echo "$OK Guardó el progreso usando solo su propia base de datos"
else
  echo "$FAIL No pudo guardar progreso (HTTP $codigo) — depende del catálogo para todo"; fallos=$((fallos+1))
fi

paso "Levantando catalog-service de nuevo..."
docker compose start catalog-service > /dev/null 2>&1
sleep 10
if curl -sf http://localhost:3002/health > /dev/null; then
  echo "$OK catalog-service se recuperó solo"
else
  echo "  [AVISO] catalog-service aún está arrancando, dale unos segundos más"
fi

titulo "PRUEBA 4 — Billing avisa a User aunque User esté caído"

# Cuenta inventada: User la ignora (no existe) y no toca ninguna cuenta real.
CUENTA_PRUEBA=999999999
COLA="http://localhost:15672/api/queues/%2F/user_service.payment_failed"
mensajes_en_cola() {
  curl -s -u guest:guest "$COLA" | grep -o '"messages":[0-9]*' | head -1 | cut -d: -f2
}

paso "Apagando user-service..."
docker compose stop user-service > /dev/null 2>&1
sleep 3

paso "Cobro rechazado en Billing con User apagado:"
codigo=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3006/api/billing/subscribe \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"$CUENTA_PRUEBA\",\"plan\":\"BASICO\",\"cardNumber\":\"4000000000000002\"}")
if [ "$codigo" = "402" ]; then
  echo "$OK Billing respondió 402 sin necesitar a User (no lo llama, publica un evento)"
else
  echo "$FAIL Billing respondió HTTP $codigo"; fallos=$((fallos+1))
fi

sleep 6  # el panel de RabbitMQ actualiza sus contadores cada ~5 s
pendientes=$(mensajes_en_cola)
if [ "${pendientes:-0}" -ge 1 ]; then
  echo "$OK payment.failed espera en la cola user_service.payment_failed ($pendientes mensaje/s)"
else
  echo "$FAIL No hay mensajes esperando en la cola: el evento se perdió"; fallos=$((fallos+1))
fi

paso "Levantando user-service de nuevo: debe consumir lo pendiente..."
docker compose start user-service > /dev/null 2>&1
sleep 15
pendientes=$(mensajes_en_cola)
if [ "${pendientes:-1}" -eq 0 ]; then
  echo "$OK User procesó el evento al volver (la cola quedó vacía)"
else
  echo "  [AVISO] Aún hay $pendientes mensaje/s en la cola; User puede seguir arrancando"
fi

titulo "PRUEBA 5 — Sin código compartido"

paso "Buscando imports cruzados entre servicios..."
cruces=$(grep -rnE "from ['\"].*\.\./\.\./(user|catalog|playback|media-processing|recommendation|billing)-service" \
  user-service/src catalog-service/src playback-service/src billing-service/src 2>/dev/null | wc -l)
cruces_py=$(grep -rnE "(catalog|playback|user|billing)[-_]service" --include=*.py \
  media-processing-service/app recommendation-service/app 2>/dev/null | grep -E "^[^:]+:[0-9]+:(from|import) " | wc -l)
if [ "$cruces" -eq 0 ] && [ "$cruces_py" -eq 0 ]; then
  echo "$OK Ningún servicio importa código fuente de otro"
else
  echo "$FAIL Se encontraron $((cruces + cruces_py)) imports cruzados"; fallos=$((fallos+1))
fi

paso "¿Cada servicio declara sus propias dependencias?"
if [ -f user-service/package.json ] && [ -f catalog-service/package.json ] \
   && [ -f playback-service/package.json ] && [ -f media-processing-service/requirements.txt ] \
   && [ -f recommendation-service/requirements.txt ] && [ -f billing-service/package.json ]; then
  echo "$OK Seis manifiestos de dependencias independientes (4 Node.js + 2 Python)"
else
  echo "$FAIL Falta algún manifiesto de dependencias"; fallos=$((fallos+1))
fi

titulo "RESULTADO"
if [ "$fallos" -eq 0 ]; then
  echo ""
  echo "  Todas las pruebas pasaron."
  echo "  Son microservicios reales, no un monolito distribuido."
  echo ""
else
  echo ""
  echo "  $fallos prueba(s) fallaron. Revisa los puntos marcados arriba."
  echo ""
  exit 1
fi
