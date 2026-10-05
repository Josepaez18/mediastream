import * as express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { FixedWindowRateLimiter } from '../rate-limit/rate-limiter';
import { createGateway } from './gateway.middleware';

const SECRET = 'test-secret';
const token = (sub = '42', options: jwt.SignOptions = { expiresIn: '5m' }, extra: object = {}) =>
  `Bearer ${jwt.sign({ sub, email: 'ana@correo.com', role: 'USER', plan: 'GRATIS', status: 'ACTIVA', ...extra }, SECRET, options)}`;

/**
 * Servicio de destino falso: responde con lo que recibió (método, ruta,
 * cabeceras y cuerpo) y, como los microservicios reales, con su propia
 * cabecera CORS.
 */
function startUpstream(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url?.startsWith('/api/playback/slow')) return; // nunca responde
      if (req.url?.startsWith('/api/billing/dormido')) {
        // Lo que responde el borde de Render cuando el servicio está dormido.
        res.writeHead(502, { 'Content-Type': 'text/html', 'x-render-routing': 'no-deploy' });
        return res.end('<!DOCTYPE html><title>502</title>');
      }
      if (req.url?.startsWith('/api/billing/error502')) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end('{"message":"error propio del servicio"}');
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    }),
  );
}

describe('API Gateway', () => {
  let upstream: { url: string; close: () => Promise<void> };
  let app: express.Express;

  const build = (limiter = new FixedWindowRateLimiter()) => {
    const env = {
      USER_SERVICE_URL: upstream.url,
      CATALOG_SERVICE_URL: upstream.url,
      PLAYBACK_SERVICE_URL: upstream.url,
      BILLING_SERVICE_URL: upstream.url,
      // Nadie escucha en este puerto: simula un servicio caído.
      ANALYTICS_SERVICE_URL: 'http://127.0.0.1:1',
      MEDIA_SERVICE_URL: upstream.url,
    };
    const a = express();
    a.use(createGateway({ jwtSecret: SECRET, env, limiter, proxyTimeoutMs: 300 }));
    a.get('/health', (_req, res) => res.json({ status: 'ok' }));
    return a;
  };

  beforeAll(async () => {
    upstream = await startUpstream();
  });
  afterAll(() => upstream.close());
  beforeEach(() => {
    app = build();
  });

  it('enruta por prefijo conservando la ruta y el query string', async () => {
    const res = await request(app).get('/api/catalog/titles?region=CO');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/api/catalog/titles?region=CO');
  });

  it('las rutas públicas pasan sin token (login, catálogo)', async () => {
    const res = await request(app).post('/api/users/login').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.body)).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('las rutas protegidas exigen un AccessToken válido', async () => {
    expect((await request(app).get('/api/playback/resume/1')).status).toBe(401);
    expect(
      (await request(app).get('/api/playback/resume/1').set('Authorization', 'Bearer basura')).status,
    ).toBe(401);
    const expired = await request(app)
      .get('/api/playback/resume/1')
      .set('Authorization', token('42', { expiresIn: -10 }));
    expect(expired.status).toBe(401);
    expect(expired.body.message).toContain('expirado');
  });

  it('con token válido inyecta x-account-id e ignora el que intente mandar el cliente', async () => {
    const res = await request(app)
      .get('/api/playback/resume/1')
      .set('Authorization', token('42'))
      .set('x-account-id', '999');
    expect(res.status).toBe(200);
    expect(res.body.headers['x-account-id']).toBe('42');
    expect(res.body.headers['x-account-email']).toBe('ana@correo.com');
  });

  it('pasa rol, plan y estado de la cuenta al servicio, sin dejar que el cliente los falsifique', async () => {
    const res = await request(app)
      .get('/api/playback/resume/1')
      .set('Authorization', token('42', { expiresIn: '5m' }, { plan: 'PREMIUM' }))
      .set('x-account-role', 'ADMIN');
    expect(res.body.headers).toMatchObject({
      'x-account-role': 'USER',
      'x-account-plan': 'PREMIUM',
      'x-account-status': 'ACTIVA',
    });
  });

  it('las rutas de administración exigen rol ADMIN', async () => {
    const user = token('42');
    const admin = token('1', { expiresIn: '5m' }, { role: 'ADMIN' });
    expect((await request(app).delete('/api/catalog/titles/3').set('Authorization', user)).status).toBe(403);
    expect((await request(app).get('/api/users/admin/accounts').set('Authorization', user)).status).toBe(403);
    expect((await request(app).post('/api/media/ingest').set('Authorization', user)).status).toBe(403);
    expect((await request(app).delete('/api/catalog/titles/3').set('Authorization', admin)).status).toBe(200);
    // Leer el catálogo sigue siendo público.
    expect((await request(app).get('/api/catalog/titles')).status).toBe(200);
  });

  it('una ruta pública no deja pasar un x-account-id falsificado', async () => {
    const res = await request(app).get('/api/catalog/titles').set('x-account-id', '999');
    expect(res.body.headers['x-account-id']).toBeUndefined();
  });

  it('no reenvía las cabeceras de la plataforma (Cloudflare/Render) al servicio de destino', async () => {
    const res = await request(app)
      .get('/api/catalog/titles')
      .set('cf-ray', 'abc')
      .set('cf-connecting-ip', '1.2.3.4')
      .set('rndr-id', 'gateway')
      .set('x-render-origin-server', 'Render')
      .set('true-client-ip', '1.2.3.4')
      .set('x-forwarded-host', 'mediastream-gateway.onrender.com');
    expect(res.status).toBe(200);
    for (const h of ['cf-ray', 'cf-connecting-ip', 'rndr-id', 'x-render-origin-server', 'true-client-ip', 'x-forwarded-host']) {
      expect(res.body.headers[h]).toBeUndefined();
    }
  });

  it('quita las cabeceras CORS del servicio de destino (la política es la del Gateway)', async () => {
    const res = await request(app).get('/api/catalog/titles');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('aplica rate limiting estricto al login (10 por minuto por IP)', async () => {
    let last = await request(app).post('/api/users/login').send({});
    for (let i = 0; i < 10; i++) last = await request(app).post('/api/users/login').send({});
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
    // Otras rutas siguen con su propio cupo.
    expect((await request(app).get('/api/catalog/titles')).status).toBe(200);
  });

  it('responde 502 si el servicio de destino está caído y 504 si no responde a tiempo', async () => {
    const down = await request(app)
      .get('/api/analytics/kpis')
      .set('Authorization', token('1', { expiresIn: '5m' }, { role: 'ADMIN' }));
    expect(down.status).toBe(502);
    expect(down.body.message).toContain('analytics-service');

    const slow = await request(app).get('/api/playback/slow').set('Authorization', token());
    expect(slow.status).toBe(504);
  });

  it('servicio dormido en Render → 503 SERVICE_WAKING con el servicio a despertar', async () => {
    const res = await request(app).get('/api/billing/dormido').set('Authorization', token());
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'SERVICE_WAKING', service: 'billing', serviceUrl: upstream.url });
  });

  it('un 502 propio del servicio (sin la marca de Render) pasa tal cual', async () => {
    const res = await request(app).get('/api/billing/error502').set('Authorization', token());
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('error propio del servicio');
  });

  it('404 para rutas /api que ningún servicio atiende; lo demás sigue a Nest', async () => {
    expect((await request(app).get('/api/desconocido')).status).toBe(404);
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
  });
});
