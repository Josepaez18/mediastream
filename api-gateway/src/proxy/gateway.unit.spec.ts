import * as jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { FixedWindowRateLimiter } from '../rate-limit/rate-limiter';
import { createGateway } from './gateway.middleware';

/**
 * Pruebas unitarias del middleware del Gateway: autenticación, autorización,
 * limpieza de cabeceras, rate limiting y enrutamiento corren de verdad. Lo único
 * simulado es http-proxy-middleware: cada microservicio de destino es un
 * jest.fn, así que ninguna petición sale por la red.
 */
jest.mock('http-proxy-middleware', () => ({ createProxyMiddleware: jest.fn() }));

const SECRET = 'test-secret';
const ANALYTICS = 'http://analytics-service:3008';
const MEDIA = 'http://media-service:3004';
const ENV = { ANALYTICS_SERVICE_URL: ANALYTICS, MEDIA_SERVICE_URL: MEDIA };

const bearer = (claims: object) => `Bearer ${jwt.sign(claims, SECRET, { expiresIn: '5m' })}`;

/** Servicio de destino simulado por cada target que configura el Gateway. */
let destinos: Map<string, jest.Mock>;

beforeEach(() => {
  destinos = new Map();
  const createProxy = createProxyMiddleware as jest.Mock;
  createProxy.mockReset();
  createProxy.mockImplementation((options: { target: string }) => {
    const destino = jest.fn();
    destinos.set(options.target, destino);
    return destino;
  });
});

function peticion(method: string, path: string, headers: Record<string, string>): any {
  return { method, path, url: path, ip: '203.0.113.7', headers: { ...headers } };
}

function respuesta() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    setHeader: jest.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
    end: jest.fn(),
  };
  return { res, headers, body: () => JSON.parse(res.end.mock.calls[0][0]) };
}

describe('API Gateway (unitarias, destino simulado)', () => {
  it('token ADMIN: reenvía a Analytics con la identidad del token, sin cabeceras falsificadas ni de la plataforma', () => {
    const gateway = createGateway({ jwtSecret: SECRET, env: ENV, limiter: new FixedWindowRateLimiter() });
    const req = peticion('GET', '/api/analytics/kpis', {
      authorization: bearer({ sub: '1', email: 'admin@correo.com', role: 'ADMIN', plan: 'PREMIUM', status: 'ACTIVA' }),
      'x-account-id': '999',
      'cf-ray': 'abc123',
      'x-forwarded-host': 'mediastream-gateway.onrender.com',
    });
    const { res, headers } = respuesta();
    const next = jest.fn();

    gateway(req, res, next);

    // El proxy de Analytics se creó con la URL del entorno y sin X-Forwarded-*.
    expect(createProxyMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({ target: ANALYTICS, changeOrigin: true, xfwd: false }),
    );
    const analytics = destinos.get(ANALYTICS)!;
    expect(analytics).toHaveBeenCalledTimes(1);
    for (const [target, destino] of destinos) {
      if (target !== ANALYTICS) expect(destino).not.toHaveBeenCalled();
    }
    expect(next).not.toHaveBeenCalled();

    const reenviada = analytics.mock.calls[0][0];
    expect(reenviada.headers).toMatchObject({
      'x-account-id': '1',
      'x-account-email': 'admin@correo.com',
      'x-account-role': 'ADMIN',
      'x-account-plan': 'PREMIUM',
      'x-account-status': 'ACTIVA',
    });
    expect(reenviada.headers).not.toHaveProperty('cf-ray');
    expect(reenviada.headers).not.toHaveProperty('x-forwarded-host');

    expect(res.locals).toEqual({ upstream: 'analytics', accountId: '1' });
    expect(headers['x-ratelimit-limit']).toBe('120');
    expect(headers['x-ratelimit-remaining']).toBe('119');
  });

  it('usuario que falsifica x-account-role: ADMIN → 403 en POST /api/media/ingest y nunca llega a Media-Processing', () => {
    const gateway = createGateway({ jwtSecret: SECRET, env: ENV, limiter: new FixedWindowRateLimiter() });
    const req = peticion('POST', '/api/media/ingest', {
      authorization: bearer({ sub: '42', role: 'USER', plan: 'BASICO', status: 'ACTIVA' }),
      'x-account-role': 'ADMIN',
    });
    const { res, body } = respuesta();
    const next = jest.fn();

    gateway(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(body()).toMatchObject({ statusCode: 403, path: '/api/media/ingest', message: 'Requiere rol de administrador.' });
    expect(destinos.get(MEDIA)).toBeDefined();
    for (const destino of destinos.values()) expect(destino).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
