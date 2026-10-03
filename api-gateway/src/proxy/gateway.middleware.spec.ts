import * as express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { FixedWindowRateLimiter } from '../rate-limit/rate-limiter';
import { createGateway } from './gateway.middleware';

const SECRET = 'test-secret';
const token = (sub = '42', options: jwt.SignOptions = { expiresIn: '5m' }) =>
  `Bearer ${jwt.sign({ sub, email: 'ana@correo.com' }, SECRET, options)}`;

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

  it('una ruta pública no deja pasar un x-account-id falsificado', async () => {
    const res = await request(app).get('/api/catalog/titles').set('x-account-id', '999');
    expect(res.body.headers['x-account-id']).toBeUndefined();
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
    const down = await request(app).get('/api/analytics/kpis').set('Authorization', token());
    expect(down.status).toBe(502);
    expect(down.body.message).toContain('analytics-service');

    const slow = await request(app).get('/api/playback/slow').set('Authorization', token());
    expect(slow.status).toBe(504);
  });

  it('404 para rutas /api que ningún servicio atiende; lo demás sigue a Nest', async () => {
    expect((await request(app).get('/api/desconocido')).status).toBe(404);
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
  });
});
