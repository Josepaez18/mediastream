import * as http from 'http';
import { AddressInfo } from 'net';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { CatalogClient } from './catalog.client';
import { RedisService } from '../redis/redis.service';

/**
 * Prueba el CatalogClient contra un Catalog-Service falso (un servidor HTTP
 * real en un puerto local) para comprobar timeout, reintentos, circuit
 * breaker y la última información conocida (secciones 4.5–4.7).
 */
describe('CatalogClient (resiliencia hacia Catalog-Service)', () => {
  type Mode = 'ok' | 'error500' | 'slow';
  let mode: Mode = 'ok';
  let hits = 0;
  let server: http.Server;
  let baseUrl = '';

  // Redis falso en memoria (sin TTL: no hace falta para estas pruebas).
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k) as string) : null),
    set: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v));
    },
  } as unknown as RedisService;

  const title = { id: 1, name: 'La Sirenita', status: 'AVAILABLE', type: 'MOVIE' };

  beforeAll(async () => {
    Logger.overrideLogger(false); // los reintentos se registran; aquí no hace falta verlos
    server = http.createServer((req, res) => {
      hits++;
      if (mode === 'slow') return; // nunca responde: dispara el timeout
      if (mode === 'error500') {
        res.writeHead(500).end('{}');
        return;
      }
      if (req.url === '/api/catalog/titles/1') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(title));
      } else if (req.url === '/api/catalog/titles/1/availability') {
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify([{ region: 'CO', availableFrom: '2020-01-01T00:00:00Z' }]));
      } else {
        res.writeHead(404).end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const newClient = () => {
    process.env.CATALOG_SERVICE_URL = baseUrl;
    process.env.CATALOG_TIMEOUT_MS = '150';
    process.env.CATALOG_RETRIES = '2';
    process.env.CATALOG_RETRY_BASE_MS = '5';
    process.env.CATALOG_CB_FAILURE_THRESHOLD = '3';
    process.env.CATALOG_CB_OPEN_MS = '60000';
    return new CatalogClient(redis);
  };

  beforeEach(() => {
    mode = 'ok';
    hits = 0;
    store.clear();
  });

  it('consulta a Catalog y luego responde desde la caché', async () => {
    const client = newClient();
    const first = await client.getTitle('1');
    expect(first).toEqual({ data: expect.objectContaining({ name: 'La Sirenita' }), source: 'LIVE' });
    const second = await client.getTitle('1');
    expect(second.source).toBe('CACHE');
    expect(hits).toBe(1);
  });

  it('un título inexistente devuelve null sin reintentar', async () => {
    const client = newClient();
    const res = await client.getTitle('999');
    expect(res).toEqual({ data: null, source: 'LIVE' });
    expect(hits).toBe(1);
  });

  it('reintenta 2 veces (3 intentos) ante un 500', async () => {
    const client = newClient();
    mode = 'error500';
    await expect(client.getTitle('1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(hits).toBe(3);
  });

  it('aplica el timeout por intento y también reintenta', async () => {
    const client = newClient();
    mode = 'slow';
    const started = Date.now();
    await expect(client.getTitle('1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(hits).toBe(3);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('con Catalog caído usa la última información conocida', async () => {
    const client = newClient();
    await client.getTitle('1'); // Catalog respondió: queda la última respuesta conocida
    store.delete('catalog:title:1'); // expiró la caché corta (60 s)
    mode = 'error500';
    const res = await client.getTitle('1');
    expect(res.source).toBe('LAST_KNOWN');
    expect(res.data?.name).toBe('La Sirenita');
  });

  it('tras 3 fallos abre el circuito y deja de llamar a Catalog', async () => {
    const client = newClient();
    await client.isAvailableInRegion('1', 'CO');
    store.delete('catalog:avail:1:CO');
    mode = 'error500';

    for (let i = 0; i < 3; i++) await client.isAvailableInRegion('1', 'CO');
    expect(client.circuitState).toBe('OPEN');

    hits = 0;
    const res = await client.isAvailableInRegion('1', 'CO');
    expect(res).toEqual({ data: true, source: 'LAST_KNOWN' });
    expect(hits).toBe(0); // el circuito abierto no deja pasar la llamada
  });

  it('verifica la región contra la disponibilidad de Catalog', async () => {
    const client = newClient();
    expect((await client.isAvailableInRegion('1', 'co')).data).toBe(true);
    expect((await client.isAvailableInRegion('1', 'AR')).data).toBe(false);
  });
});
