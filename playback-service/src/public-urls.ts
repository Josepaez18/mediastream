/**
 * URLs públicas de los seis servicios de MediaStream.
 *
 * En local cada consola encuentra a las demás por puerto (mismo host,
 * :3001…:3006). En Render cada servicio tiene su propio dominio y no hay
 * puertos, así que las URLs se configuran con variables de entorno
 * (PUBLIC_USER_URL, PUBLIC_CATALOG_URL, …), iguales en todos los servicios.
 *
 * Con ellas se arman:
 *  - /config.js, que las consolas leen para enlazarse entre sí, y
 *  - la lista de orígenes permitidos por CORS cuando CORS_ORIGINS no está
 *    definida (sección 10: solo se aceptan los orígenes conocidos).
 */
const PUBLIC_URL_VARS: Record<string, string> = {
  user: 'PUBLIC_USER_URL',
  catalog: 'PUBLIC_CATALOG_URL',
  playback: 'PUBLIC_PLAYBACK_URL',
  media: 'PUBLIC_MEDIA_URL',
  recommendation: 'PUBLIC_RECOMMENDATION_URL',
  billing: 'PUBLIC_BILLING_URL',
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
