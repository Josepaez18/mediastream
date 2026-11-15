# Prometheus para el despliegue en Render: la imagen oficial con la
# configuración de los 9 servicios adentro (prometheus.render.yml).
# En local no se usa: docker compose monta prometheus.yml sobre la imagen oficial.
#
# Contexto de build: la carpeta monitoring/ (ver render.yaml).
FROM prom/prometheus:v3.16.0

COPY prometheus.render.yml /etc/prometheus/prometheus.yml

# Render enruta al puerto de la variable PORT (9090 en render.yaml), que es
# donde Prometheus escucha por defecto.
EXPOSE 9090

# El plan gratis de Render no tiene disco persistente: el historial vive
# mientras el servicio esté despierto. Dos días de retención sobran.
CMD ["--config.file=/etc/prometheus/prometheus.yml", \
     "--storage.tsdb.path=/prometheus", \
     "--storage.tsdb.retention.time=2d"]
