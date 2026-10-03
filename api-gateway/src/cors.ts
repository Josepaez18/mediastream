import type { CorsOptions } from 'cors';

const clean = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * CORS (sección 10): el Gateway solo acepta los orígenes conocidos del
 * frontend. CORS_ORIGINS manda si está definida; si no, PUBLIC_APP_URL
 * (el frontend en Render); sin ninguna, cualquier origen (desarrollo local).
 *
 * credentials: true porque el refresh token viaja en una cookie httpOnly. Con
 * credenciales el navegador no acepta "*", así que en desarrollo se refleja
 * el origen de la petición (origin: true).
 */
export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const raw = env.CORS_ORIGINS ?? env.PUBLIC_APP_URL ?? '';
  const origins = raw.split(',').map(clean).filter(Boolean);
  return {
    origin: !origins.length || origins.includes('*') ? true : origins,
    credentials: true,
    exposedHeaders: ['x-request-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  };
}
