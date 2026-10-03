/**
 * Tabla de enrutamiento del API Gateway (sección 5 del documento): cada
 * prefijo de ruta va a un microservicio. El cliente solo conoce al Gateway;
 * mover, escalar o reemplazar un servicio solo cambia su URL aquí.
 *
 * La URL de cada servicio sale de, en este orden:
 *   1. <SERVICIO>_SERVICE_URL  (red Docker: http://catalog-service:3002)
 *   2. PUBLIC_<SERVICIO>_URL   (Render: los servicios gratis no reciben
 *                               tráfico por la red privada)
 *   3. localhost con el puerto de desarrollo.
 */
export interface ServiceRoute {
  prefix: string;
  service: string;
  envVar: string;
  publicEnvVar: string;
  defaultUrl: string;
}

export const ROUTES: ServiceRoute[] = [
  { prefix: '/api/users', service: 'user', envVar: 'USER_SERVICE_URL', publicEnvVar: 'PUBLIC_USER_URL', defaultUrl: 'http://localhost:3001' },
  { prefix: '/api/catalog', service: 'catalog', envVar: 'CATALOG_SERVICE_URL', publicEnvVar: 'PUBLIC_CATALOG_URL', defaultUrl: 'http://localhost:3002' },
  { prefix: '/api/playback', service: 'playback', envVar: 'PLAYBACK_SERVICE_URL', publicEnvVar: 'PUBLIC_PLAYBACK_URL', defaultUrl: 'http://localhost:3003' },
  { prefix: '/api/media', service: 'media', envVar: 'MEDIA_SERVICE_URL', publicEnvVar: 'PUBLIC_MEDIA_URL', defaultUrl: 'http://localhost:3004' },
  { prefix: '/api/recommendations', service: 'recommendation', envVar: 'RECOMMENDATION_SERVICE_URL', publicEnvVar: 'PUBLIC_RECOMMENDATION_URL', defaultUrl: 'http://localhost:3005' },
  { prefix: '/api/billing', service: 'billing', envVar: 'BILLING_SERVICE_URL', publicEnvVar: 'PUBLIC_BILLING_URL', defaultUrl: 'http://localhost:3006' },
  { prefix: '/api/notifications', service: 'notification', envVar: 'NOTIFICATION_SERVICE_URL', publicEnvVar: 'PUBLIC_NOTIFICATION_URL', defaultUrl: 'http://localhost:3007' },
  { prefix: '/api/analytics', service: 'analytics', envVar: 'ANALYTICS_SERVICE_URL', publicEnvVar: 'PUBLIC_ANALYTICS_URL', defaultUrl: 'http://localhost:3008' },
];

const clean = (url: string) => url.trim().replace(/\/+$/, '');

export function resolveTarget(route: ServiceRoute, env: NodeJS.ProcessEnv = process.env): string {
  return clean(env[route.envVar] || env[route.publicEnvVar] || route.defaultUrl);
}

/** Ruta que atiende `path` (sin query string), o undefined si ninguna. */
export function findRoute(path: string): ServiceRoute | undefined {
  return ROUTES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
}
