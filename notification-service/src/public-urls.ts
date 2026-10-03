/**
 * URLs públicas de los servicios de MediaStream (en Render, cada uno en su
 * propio dominio). Con ellas se arma la lista de orígenes permitidos por CORS
 * cuando CORS_ORIGINS no está definida (sección 10: solo orígenes conocidos).
 */
const PUBLIC_URL_VARS: Record<string, string> = {
  user: 'PUBLIC_USER_URL',
  catalog: 'PUBLIC_CATALOG_URL',
  playback: 'PUBLIC_PLAYBACK_URL',
  media: 'PUBLIC_MEDIA_URL',
  recommendation: 'PUBLIC_RECOMMENDATION_URL',
  billing: 'PUBLIC_BILLING_URL',
  notification: 'PUBLIC_NOTIFICATION_URL',
  analytics: 'PUBLIC_ANALYTICS_URL',
  gateway: 'PUBLIC_GATEWAY_URL',
};

const clean = (url: string) => url.trim().replace(/\/+$/, '');

export function publicServiceUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [key, envVar] of Object.entries(PUBLIC_URL_VARS)) {
    const value = process.env[envVar];
    if (value && value.trim()) urls[key] = clean(value);
  }
  return urls;
}

/**
 * CORS_ORIGINS manda si está definida ("*" = cualquier origen). Si no, se
 * permiten solo las URLs públicas de MediaStream; sin ninguna, "*" (local).
 */
export function allowedCorsOrigins(): string | string[] {
  const explicit = process.env.CORS_ORIGINS;
  const origins = explicit
    ? explicit.split(',').map(clean).filter(Boolean)
    : Object.values(publicServiceUrls());
  if (!origins.length || origins.includes('*')) return '*';
  return origins;
}

/**
 * Catalog-Service: CATALOG_SERVICE_URL (red Docker) o, en Render, su URL
 * pública (los servicios gratis no reciben tráfico por la red privada).
 */
export function catalogBaseUrl(): string {
  const url =
    process.env.CATALOG_SERVICE_URL || process.env.PUBLIC_CATALOG_URL || 'http://localhost:3002';
  return clean(url);
}
