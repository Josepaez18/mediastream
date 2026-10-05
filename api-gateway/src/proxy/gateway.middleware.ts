import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { isAdminRoute, isPublicRoute } from '../auth/access-policy';
import { InvalidTokenError, verifyAccessToken } from '../auth/jwt';
import { FixedWindowRateLimiter, ruleFor } from '../rate-limit/rate-limiter';
import { findRoute, resolveTarget, ROUTES } from './routes';

/**
 * Cabeceras internas que solo el Gateway puede poner (sección 5: el servicio
 * de destino confía en ellas "porque solo el Gateway puede inyectarlas").
 * Si el cliente las manda, se borran antes de reenviar la petición.
 */
export const INTERNAL_HEADERS = [
  'x-account-id',
  'x-account-email',
  'x-account-role',
  'x-account-plan',
  'x-account-status',
];

/**
 * Cabeceras que pone la plataforma de hosting a la petición ENTRANTE
 * (Cloudflare y el enrutador de Render). Identifican al Gateway como destino;
 * si se reenvían tal cual al microservicio, el borde de Render puede enrutar
 * la petición a otro sitio y responder 502 "no-deploy". Se quitan antes de
 * reenviar: el microservicio recibe una petición limpia, como la de un cliente.
 */
export const PLATFORM_HEADER = /^(cf-|x-render|rndr|render-|true-client-ip$|cdn-loop$|x-real-ip$|x-forwarded-|forwarded$|via$)/i;

export function stripPlatformHeaders(headers: Record<string, unknown>) {
  for (const name of Object.keys(headers)) {
    if (PLATFORM_HEADER.test(name)) delete headers[name];
  }
}

// Los microservicios también responden cabeceras CORS (para poder probarlos
// solos). Detrás del Gateway, la política CORS es solo la del Gateway: si
// llegaran las dos, el navegador vería el origen permitido repetido y
// rechazaría la respuesta.
const UPSTREAM_CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
];

export interface GatewayOptions {
  jwtSecret: string;
  env?: NodeJS.ProcessEnv;
  limiter?: FixedWindowRateLimiter;
  /** Tiempo máximo de espera de la respuesta de un microservicio (sección 4.5). */
  proxyTimeoutMs?: number;
}

export function sendError(
  res: Response | ServerResponse,
  status: number,
  message: string,
  path = '',
  extra: Record<string, unknown> = {},
) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ statusCode: status, path, timestamp: new Date().toISOString(), message, ...extra }));
}

/**
 * ¿El servicio de destino está dormido? En el plan gratis, Render apaga un
 * servicio tras 15 min sin tráfico. Una visita desde fuera lo despierta, pero
 * a una petición que llega desde otro servicio de Render (como el Gateway) su
 * borde le responde 502 con x-render-routing: no-deploy, sin despertarlo.
 */
export function isSleepingUpstream(status: number | undefined, headers: Record<string, unknown>): boolean {
  return status === 502 && headers['x-render-routing'] === 'no-deploy';
}

export function createGateway(options: GatewayOptions): RequestHandler {
  const env = options.env ?? process.env;
  const limiter = options.limiter ?? new FixedWindowRateLimiter();
  const proxyTimeout = options.proxyTimeoutMs ?? 15_000;

  const proxies = new Map<string, RequestHandler>();
  for (const route of ROUTES) {
    const target = resolveTarget(route, env);
    proxies.set(
      route.prefix,
      createProxyMiddleware<Request, Response>({
        target,
        changeOrigin: true,
        // Sin X-Forwarded-*: el borde de Render podría enrutar por X-Forwarded-Host
        // (el dominio del Gateway) en vez de por el Host del servicio de destino.
        xfwd: false,
        proxyTimeout,
        // La respuesta se escribe a mano (abajo) para poder reemplazar la
        // página HTML de Render por un JSON cuando el servicio está dormido.
        selfHandleResponse: true,
        on: {
          proxyRes: (proxyRes, req: IncomingMessage, res: ServerResponse) => {
            if (isSleepingUpstream(proxyRes.statusCode, proxyRes.headers)) {
              proxyRes.resume(); // descarta la página de Render
              // 503 + SERVICE_WAKING: la petición NO llegó al servicio, así que el
              // cliente puede despertarlo (visitando su URL pública) y reintentar.
              return sendError(res, 503, `${route.service}-service se está iniciando. Reintenta en unos segundos.`, req.url ?? '', {
                code: 'SERVICE_WAKING',
                service: route.service,
                serviceUrl: target,
              });
            }
            for (const header of UPSTREAM_CORS_HEADERS) delete proxyRes.headers[header];
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.headers);
            proxyRes.pipe(res);
          },
          error: (err: NodeJS.ErrnoException, req: IncomingMessage, res: ServerResponse | Socket) => {
            if (!('setHeader' in res)) return; // conexión sin respuesta HTTP (p. ej. websocket)
            // Servicio caído → 502; servicio lento (proxyTimeout) → 504.
            const timedOut = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
            sendError(
              res,
              timedOut ? 504 : 502,
              timedOut
                ? `${route.service}-service no respondió a tiempo.`
                : `${route.service}-service no está disponible en este momento.`,
              req.url ?? '',
            );
          },
        },
      }),
    );
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (!path.startsWith('/api/')) return next();

    const route = findRoute(path);
    if (!route) return sendError(res, 404, `Ninguna ruta del Gateway atiende ${path}.`, path);

    for (const header of INTERNAL_HEADERS) delete req.headers[header];
    stripPlatformHeaders(req.headers);

    // Autenticación centralizada (sección 5).
    let accountId: string | undefined;
    if (!isPublicRoute(req.method, path)) {
      try {
        const claims = verifyAccessToken(req.headers.authorization, options.jwtSecret);
        accountId = claims.accountId;
        req.headers['x-account-id'] = claims.accountId;
        if (claims.email) req.headers['x-account-email'] = claims.email;
        if (claims.role) req.headers['x-account-role'] = claims.role;
        if (claims.plan) req.headers['x-account-plan'] = claims.plan;
        if (claims.status) req.headers['x-account-status'] = claims.status;
        if (isAdminRoute(req.method, path) && claims.role !== 'ADMIN') {
          return sendError(res, 403, 'Requiere rol de administrador.', path);
        }
      } catch (err) {
        const message = err instanceof InvalidTokenError ? err.message : 'AccessToken inválido.';
        return sendError(res, 401, message, path);
      }
    }

    // Rate limiting por cuenta (si hay sesión) o por IP.
    const rule = ruleFor(req.method, path);
    const who = accountId ? `account:${accountId}` : `ip:${req.ip}`;
    const result = limiter.hit(`${rule.name}:${who}`, rule.limit);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetSeconds));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.resetSeconds));
      return sendError(res, 429, 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.', path);
    }

    res.locals.upstream = route.service;
    res.locals.accountId = accountId;
    return proxies.get(route.prefix)!(req, res, next);
  };
}
