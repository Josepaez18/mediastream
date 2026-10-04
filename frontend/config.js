// URLs públicas de los microservicios de MediaStream y del API Gateway. Este frontend es un
// Static Site sin build step, así que no puede leer variables de entorno en
// runtime como los backends: si Render reasigna alguna URL, se corrige aquí.
window.MEDIASTREAM_CONFIG = {
  USER: 'https://mediastream-user-3um7.onrender.com',
  CATALOG: 'https://mediastream-catalog-t9f9.onrender.com',
  PLAYBACK: 'https://mediastream-playback-0ciy.onrender.com',
  MEDIA: 'https://mediastream-media-zadq.onrender.com',
  RECOMMENDATION: 'https://mediastream-recommendation-rvk4.onrender.com',
  BILLING: 'https://mediastream-billing-c7bf.onrender.com',
  // Todavía sin crear en Render: si les asigna otro slug, corrígelo aquí y
  // en render.yaml (grupo mediastream-urls).
  NOTIFICATION: 'https://mediastream-notification.onrender.com',
  ANALYTICS: 'https://mediastream-analytics.onrender.com',
  GATEWAY: 'https://mediastream-gateway-5wjw.onrender.com',
};

// En local (docker compose) el frontend habla con el Gateway de la máquina.
if (['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:') {
  window.MEDIASTREAM_CONFIG.GATEWAY = 'http://localhost:8080';
}
