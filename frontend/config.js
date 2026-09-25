// URLs públicas de los 6 microservicios de MediaStream. Este frontend es un
// Static Site sin build step, así que no puede leer variables de entorno en
// runtime como los backends: si Render reasigna alguna URL, se corrige aquí.
window.MEDIASTREAM_CONFIG = {
  USER: 'https://mediastream-user-3um7.onrender.com',
  CATALOG: 'https://mediastream-catalog-t9f9.onrender.com',
  PLAYBACK: 'https://mediastream-playback-0ciy.onrender.com',
  MEDIA: 'https://mediastream-media-zadq.onrender.com',
  RECOMMENDATION: 'https://mediastream-recommendation-rvk4.onrender.com',
  BILLING: 'https://mediastream-billing-c7bf.onrender.com',
};
