import * as http from 'http';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import * as request from 'supertest';
import { RedisModule } from '../redis/redis.module';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

/**
 * Prueba de integración: Redis real + comunicación real con otros componentes.
 *
 *   Playback (simulado con un cliente Redis) ──PUBLISH playback.completed──▶
 *     PlaybackEventsSubscriber → NotificationsService ──GET /api/catalog/titles/3──▶
 *       Catalog (servidor HTTP local) ; la notificación se guarda en Redis
 *   GET /api/notifications/:profileId (supertest) la lee de Redis.
 *
 * Se usa la base lógica 15 de Redis y un canal propio de la prueba, para no
 * mezclarse con un Redis de desarrollo que tenga datos o suscriptores reales.
 *
 * Necesita TEST_REDIS_URL (el pipeline de CI la define con su Redis efímero).
 * Sin ella la prueba se omite, igual que las de integración con PostgreSQL.
 *
 *   TEST_REDIS_URL=redis://localhost:6379 npm test
 */
const REDIS_URL = process.env.TEST_REDIS_URL;
const describeWithRedis = REDIS_URL ? describe : describe.skip;

// Serie de dos temporadas, como la devuelve Catalog-Service.
const SERIES = {
  id: '3',
  name: 'Mareas',
  type: 'SERIES',
  seasons: [
    { seasonNumber: 1, episodes: [{ id: '11', episodeNumber: 1 }, { id: '12', episodeNumber: 2 }] },
    { seasonNumber: 2, episodes: [{ id: '21', episodeNumber: 1 }] },
  ],
};

async function waitFor<T>(check: () => Promise<T | undefined>, what: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado esperando ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describeWithRedis('Notification-Service + Redis (integración)', () => {
  const run = randomUUID().slice(0, 8);
  const profileId = `perfil-it-${run}`;
  const accountId = `cuenta-it-${run}`;
  const eventId = `evento-it-${run}`;
  const channel = `playback.completed.it-${run}`;

  let catalog: http.Server;
  const catalogRequests: string[] = [];
  let redis: Redis;
  let app: INestApplication;
  let subscriber: { isSubscribed(): boolean };

  beforeAll(async () => {
    // Catalog-Service falso: un servidor HTTP real en un puerto local.
    catalog = http.createServer((req, res) => {
      catalogRequests.push(req.url ?? '');
      if (req.url === '/api/catalog/titles/3') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(SERIES));
      } else {
        res.writeHead(404).end('{}');
      }
    });
    await new Promise<void>((resolve) => catalog.listen(0, '127.0.0.1', resolve));

    const url = new URL(REDIS_URL as string);
    url.pathname = '/15';
    process.env.REDIS_URL = url.toString();
    process.env.CATALOG_SERVICE_URL = `http://127.0.0.1:${(catalog.address() as AddressInfo).port}`;
    // El canal se lee al cargar el suscriptor: se define antes de importarlo.
    process.env.COMPLETED_CHANNEL = channel;
    Logger.overrideLogger(['error', 'warn']);
    const { PlaybackEventsSubscriber } = await import('../events/playback-events.subscriber');

    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule, NotificationsModule],
      providers: [PlaybackEventsSubscriber],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    subscriber = app.get(PlaybackEventsSubscriber);

    redis = new Redis(process.env.REDIS_URL);
  }, 30_000);

  afterAll(async () => {
    await redis?.del(
      `notifications:profile:${profileId}`,
      `notifications:account:${accountId}`,
      `dedup:payment.failed:${eventId}`,
      `dedup:playback.completed:${profileId}:11`,
    );
    await redis?.quit();
    await app?.close();
    catalog?.closeAllConnections?.();
    await new Promise((resolve) => catalog?.close(resolve));
  });

  it('playback.completed por Redis Pub/Sub y payment.failed quedan en Redis y se leen por la API', async () => {
    const api = request(app.getHttpServer());
    const history = () => api.get(`/api/notifications/${profileId}`).query({ accountId });

    // 1. Playback publica playback.completed en Redis; el suscriptor lo recibe,
    //    le pide el título a Catalog por HTTP y guarda el aviso en Redis.
    await waitFor(async () => (subscriber.isSubscribed() ? true : undefined), 'la suscripción a Redis');
    const listeners = await redis.publish(
      channel,
      JSON.stringify({ profileId, titleId: '3', episodeId: '11', completedAt: new Date().toISOString() }),
    );
    expect(listeners).toBe(1);

    const continueWatching = await waitFor(async () => {
      const res = await history().expect(200);
      return res.body.length ? res.body : undefined;
    }, 'el aviso de playback.completed');
    expect(continueWatching).toHaveLength(1);
    expect(continueWatching[0]).toMatchObject({
      type: 'CONTINUE_WATCHING',
      title: 'Sigue viendo Mareas',
      message: 'Ya puedes ver la temporada 1, episodio 2.',
      audience: { scope: 'profile', id: profileId },
      data: { titleId: '3', nextEpisodeId: '12' },
    });
    expect(catalogRequests).toEqual(['/api/catalog/titles/3']);

    // 2. payment.failed (lo que entrega RabbitMQ): el aviso se guarda una sola
    //    vez aunque el evento llegue repetido, gracias a SET NX en Redis.
    const notifications = app.get(NotificationsService);
    expect(await notifications.onPaymentFailed({ accountId, eventId })).not.toBeNull();
    expect(await notifications.onPaymentFailed({ accountId, eventId })).toBeNull();
    expect(await redis.ttl(`dedup:payment.failed:${eventId}`)).toBeGreaterThan(0);
    expect(await redis.llen(`notifications:account:${accountId}`)).toBe(1);

    // 3. El historial del perfil junta sus avisos y los de su cuenta, más recientes primero.
    const all = await history().expect(200);
    expect(all.body.map((n: { type: string }) => n.type)).toEqual(['PAYMENT_FAILED', 'CONTINUE_WATCHING']);
    expect(all.body[0]).toMatchObject({
      audience: { scope: 'account', id: accountId },
      channels: ['email', 'push'],
    });

    // 4. Sin accountId solo aparecen los avisos del perfil.
    const onlyProfile = await api.get(`/api/notifications/${profileId}`).expect(200);
    expect(onlyProfile.body.map((n: { type: string }) => n.type)).toEqual(['CONTINUE_WATCHING']);
  });
});
