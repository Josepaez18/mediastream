# Grafana para el despliegue en Render: la imagen oficial con el datasource de
# Prometheus y el tablero "MediaStream — Servicios" ya provisionados.
# En local no se usa: docker compose monta estas mismas carpetas sobre la
# imagen oficial.
#
# Contexto de build: la carpeta monitoring/ (ver render.yaml).
FROM grafana/grafana:12.4.15

COPY grafana/provisioning /etc/grafana/provisioning
COPY grafana/dashboards /var/lib/grafana/dashboards

# El tablero se puede ver sin iniciar sesión (solo lectura) y es la página de
# inicio. Editar exige entrar como admin, con la contraseña que genera Render
# (GF_SECURITY_ADMIN_PASSWORD en render.yaml).
ENV GF_AUTH_ANONYMOUS_ENABLED=true \
    GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer \
    GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/dashboards/mediastream.json

# Render enruta al puerto de la variable PORT (3000 en render.yaml), que es
# donde Grafana escucha por defecto.
EXPOSE 3000
