import { isAdminRoute, isPublicRoute } from './auth/access-policy';
import { corsOptions } from './cors';
import { findRoute, resolveTarget, ROUTES } from './proxy/routes';
import { FixedWindowRateLimiter, ruleFor } from './rate-limit/rate-limiter';

describe('tabla de rutas', () => {
  it('cada prefijo va a su servicio, sin confundir prefijos parecidos', () => {
    expect(findRoute('/api/catalog/titles/3')?.service).toBe('catalog');
    expect(findRoute('/api/recommendations/1')?.service).toBe('recommendation');
    expect(findRoute('/api/users')?.service).toBe('user');
    expect(findRoute('/api/usersx')).toBeUndefined();
  });

  it('URL del servicio: *_SERVICE_URL, luego PUBLIC_*_URL, luego localhost', () => {
    const catalog = ROUTES.find((r) => r.service === 'catalog')!;
    expect(resolveTarget(catalog, {})).toBe('http://localhost:3002');
    expect(resolveTarget(catalog, { PUBLIC_CATALOG_URL: 'https://c.onrender.com/' })).toBe('https://c.onrender.com');
    expect(
      resolveTarget(catalog, { PUBLIC_CATALOG_URL: 'https://c.onrender.com', CATALOG_SERVICE_URL: 'http://catalog-service:3002' }),
    ).toBe('http://catalog-service:3002');
  });
});

describe('política de acceso', () => {
  it.each([
    ['POST', '/api/users/login', true],
    ['POST', '/api/users/register', true],
    ['POST', '/api/users/refresh', true],
    ['GET', '/api/users/profiles/1', false],
    ['GET', '/api/catalog/titles', true],
    ['POST', '/api/catalog/titles', false],
    ['POST', '/api/billing/webhook', true],
    ['POST', '/api/billing/subscribe', false],
    ['GET', '/api/playback/token/1', false],
    ['OPTIONS', '/api/billing/subscribe', true],
  ])('%s %s → pública: %s', (method, path, expected) => {
    expect(isPublicRoute(method, path)).toBe(expected);
  });
});

describe('rutas de administración', () => {
  it.each([
    ['GET', '/api/users/admin/accounts', true],
    ['PATCH', '/api/users/admin/accounts/3', true],
    ['GET', '/api/billing/admin/overview', true],
    ['GET', '/api/catalog/admin/titles', true],
    ['POST', '/api/catalog/titles', true],
    ['PATCH', '/api/catalog/titles/3', true],
    ['DELETE', '/api/catalog/titles/3', true],
    ['POST', '/api/media/ingest', true],
    ['GET', '/api/analytics/kpis', true],
    ['POST', '/api/analytics/top', true],
    ['GET', '/api/analytics/top', false],
    ['GET', '/api/catalog/titles', false],
    ['GET', '/api/users/profiles/1', false],
    ['POST', '/api/billing/subscribe', false],
    ['GET', '/api/notifications/1', false],
  ])('%s %s → solo admin: %s', (method, path, expected) => {
    expect(isAdminRoute(method, path)).toBe(expected);
  });
});

describe('rate limiting', () => {
  it('ventana fija: corta al pasar el límite y se reinicia al vencer', () => {
    const limiter = new FixedWindowRateLimiter(60_000);
    expect(limiter.hit('k', 2, 0).allowed).toBe(true);
    expect(limiter.hit('k', 2, 1).allowed).toBe(true);
    const third = limiter.hit('k', 2, 2);
    expect(third).toMatchObject({ allowed: false, remaining: 0, resetSeconds: 60 });
    expect(limiter.hit('k', 2, 60_001).allowed).toBe(true);
    expect(limiter.hit('otra', 2, 2).allowed).toBe(true);
  });

  it('más permisivo en lectura del catálogo, estricto en login y cobros', () => {
    expect(ruleFor('GET', '/api/catalog/titles').limit).toBeGreaterThan(ruleFor('GET', '/api/playback/resume/1').limit);
    expect(ruleFor('POST', '/api/users/login').limit).toBeLessThan(ruleFor('GET', '/api/playback/resume/1').limit);
    expect(ruleFor('POST', '/api/billing/subscribe').name).toBe('billing');
    expect(ruleFor('POST', '/api/billing/webhook').name).toBe('default');
  });
});

describe('CORS', () => {
  it('solo los orígenes configurados; en local refleja el origen (cookies con credenciales)', () => {
    expect(corsOptions({}).origin).toBe(true);
    expect(corsOptions({ CORS_ORIGINS: '*' }).origin).toBe(true);
    expect(corsOptions({ PUBLIC_APP_URL: 'https://app.onrender.com/' }).origin).toEqual(['https://app.onrender.com']);
    expect(corsOptions({ CORS_ORIGINS: 'https://a.com,https://b.com' }).origin).toEqual(['https://a.com', 'https://b.com']);
    expect(corsOptions({}).credentials).toBe(true);
  });
});
