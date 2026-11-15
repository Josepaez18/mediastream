import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as request from 'supertest';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { CatalogModule } from './catalog.module';

/**
 * Prueba de integración: endpoints HTTP reales (supertest) → CatalogService →
 * PostgreSQL real (migraciones de Prisma en una base temporal que se borra al
 * terminar) y Redis real como caché del listado.
 *
 * Necesita TEST_ADMIN_DATABASE_URL (PostgreSQL con permiso para crear bases)
 * y TEST_REDIS_URL. El pipeline de CI define las dos; sin ellas la prueba se
 * omite, igual que las de integración de los servicios Python. Se usa la base
 * lógica 15 de Redis para no tocar la caché de un Redis de desarrollo.
 *
 *   TEST_ADMIN_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci \
 *   TEST_REDIS_URL=redis://localhost:6379 npm test
 */
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL;
const describeWithInfra = ADMIN_URL && REDIS_URL ? describe : describe.skip;

const CACHE_CO = 'catalog:titles:CO:all:false';

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

describeWithInfra('Catalog-Service + PostgreSQL + Redis (integración)', () => {
  const dbName = `catalog_it_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  let admin: PrismaClient;
  let db: PrismaClient;
  let redis: Redis;
  let app: INestApplication;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const url = databaseUrl(ADMIN_URL as string, dbName);

    // Las mismas migraciones que se aplican en Render al arrancar el contenedor.
    execSync('npx prisma migrate deploy', {
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });

    const redisUrl = new URL(REDIS_URL as string);
    redisUrl.pathname = '/15';
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL = redisUrl.toString();
    Logger.overrideLogger(['error']);

    redis = new Redis(process.env.REDIS_URL);
    const stale = await redis.keys('catalog:titles*');
    if (stale.length) await redis.del(...stale);

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RedisModule, CatalogModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Igual que main.ts.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    db = new PrismaClient({ datasourceUrl: url });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (redis) {
      const keys = await redis.keys('catalog:titles*');
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    }
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });

  it('crea, lista por región con caché, edita regiones y borra un título contra la base real', async () => {
    const http = request(app.getHttpServer());
    const names = async (region: string) =>
      (await http.get('/api/catalog/titles').query({ region }).expect(200)).body.map((t: { name: string }) => t.name);

    // 1. Crear una serie publicada, con temporadas, episodios y licencia en CO.
    const created = await http
      .post('/api/catalog/titles')
      .send({
        name: 'Mareas',
        type: 'SERIES',
        category: 'Drama',
        ageRating: 'PG',
        publishImmediately: true,
        seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 2 }, { episodeNumber: 1, durationSeconds: 2400 }] }],
        availabilities: [{ region: 'CO', availableFrom: '2020-01-01T00:00:00.000Z' }],
      })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Mareas', status: 'AVAILABLE', type: 'SERIES' });
    const id = created.body.id as string;

    // Un campo que el DTO no conoce se rechaza y no llega a la base.
    await http.post('/api/catalog/titles').send({ name: 'X', type: 'MOVIE', precio: 10 }).expect(400);
    expect(await db.title.count()).toBe(1);

    // 2. Listado por región: lo filtra la licencia guardada en PostgreSQL y
    //    queda en la caché de Redis.
    expect(await names('CO')).toEqual(['Mareas']);
    expect(await names('MX')).toEqual([]);
    expect(JSON.parse((await redis.get(CACHE_CO)) as string).map((t: { id: string }) => t.id)).toEqual([id]);

    // 3. Crear otro título invalida la caché; uno PENDING no aparece en el listado.
    await http
      .post('/api/catalog/titles')
      .send({ name: 'Sin transcodificar', type: 'MOVIE', availabilities: [{ region: 'CO', availableFrom: '2020-01-01T00:00:00.000Z' }] })
      .expect(201);
    expect(await redis.exists(CACHE_CO)).toBe(0);
    expect(await names('CO')).toEqual(['Mareas']);

    // 4. Detalle con temporadas y episodios en orden.
    const detail = await http.get(`/api/catalog/titles/${id}`).expect(200);
    expect(detail.body.seasons).toHaveLength(1);
    expect(detail.body.seasons[0].episodes.map((e: { episodeNumber: number }) => e.episodeNumber)).toEqual([1, 2]);

    // 5. Editar las regiones reemplaza la disponibilidad en la base.
    await http.patch(`/api/catalog/titles/${id}`).send({ regions: ['mx', 'CO '] }).expect(200);
    const availability = await http.get(`/api/catalog/titles/${id}/availability`).expect(200);
    expect(availability.body.map((a: { region: string }) => a.region)).toEqual(['CO', 'MX']);
    expect(await names('MX')).toEqual(['Mareas']);

    // 6. Borrar: el título y, en cascada, sus temporadas y episodios.
    await http.delete(`/api/catalog/titles/${id}`).expect(200, { deleted: id });
    await http.get(`/api/catalog/titles/${id}`).expect(404);
    expect(await db.season.count({ where: { titleId: BigInt(id) } })).toBe(0);
    expect(await db.episode.count()).toBe(0);
  });
});
