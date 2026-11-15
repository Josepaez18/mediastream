import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaymentStatus, PrismaClient, SubscriptionStatus } from '@prisma/client';
import * as request from 'supertest';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from './billing.module';

/**
 * Prueba de integración: endpoints HTTP reales (supertest) → BillingService
 * (con la pasarela simulada) → PostgreSQL real, con las migraciones de
 * Prisma aplicadas en una base temporal que se borra al terminar.
 *
 * RabbitMQ no forma parte de esta prueba: RABBITMQ_URL apunta a un puerto
 * cerrado y Billing sigue respondiendo (registra el error y no publica), que
 * es el comportamiento documentado en PaymentEventsService.
 *
 * Necesita TEST_ADMIN_DATABASE_URL: un PostgreSQL con permiso para crear
 * bases (el pipeline de CI la define con su PostgreSQL efímero). Sin ella la
 * prueba se omite, igual que las de integración de los servicios Python.
 *
 *   TEST_ADMIN_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci npm test
 */
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const describeWithDb = ADMIN_URL ? describe : describe.skip;

const APPROVED_CARD = '4242424242424242';
const DECLINED_CARD = '4000000000000002';

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

describeWithDb('Billing-Service + PostgreSQL (integración)', () => {
  const dbName = `billing_it_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  let admin: PrismaClient;
  let db: PrismaClient;
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

    process.env.DATABASE_URL = url;
    process.env.RABBITMQ_URL = 'amqp://guest:guest@127.0.0.1:1';
    Logger.overrideLogger(['error']);

    // main.ts enseña a JSON a serializar los ids BigInt de Prisma; la API
    // devuelve las suscripciones tal como salen de la base.
    (BigInt.prototype as any).toJSON = function () {
      return this.toString();
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, BillingModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = new PrismaClient({ datasourceUrl: url });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });

  it('suscripción, cobro rechazado, historial y cancelación quedan registrados en la base', async () => {
    const http = request(app.getHttpServer());

    // 1. Cobro aprobado → 201, suscripción ACTIVA y su pago EXITOSO en PostgreSQL.
    const created = await http
      .post('/api/billing/subscribe')
      .send({ accountId: '101', plan: 'ESTANDAR', cardNumber: APPROVED_CARD })
      .expect(201);
    expect(created.body).toMatchObject({ accountId: '101', plan: 'ESTANDAR', status: 'ACTIVA' });
    expect(created.body.payments[0]).toMatchObject({ status: 'EXITOSO', amount: 0.2 });

    const active = await db.subscription.findMany({
      where: { accountId: 101n },
      include: { payments: true },
    });
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe(SubscriptionStatus.ACTIVA);
    expect(active[0].payments.map((p) => p.status)).toEqual([PaymentStatus.EXITOSO]);
    expect(active[0].nextBillingDate.getTime()).toBeGreaterThan(Date.now());

    // 2. La misma cuenta no puede tener dos suscripciones activas (409, sin cobrar).
    await http
      .post('/api/billing/subscribe')
      .send({ accountId: '101', plan: 'PREMIUM', cardNumber: APPROVED_CARD })
      .expect(409);
    expect(await db.payment.count()).toBe(1);

    // 3. Cobro rechazado → 402, pero la transacción local (Saga) ya quedó guardada.
    const declined = await http
      .post('/api/billing/subscribe')
      .send({ accountId: '102', plan: 'BASICO', cardNumber: DECLINED_CARD })
      .expect(402);
    expect(declined.body).toMatchObject({ subscription: { accountId: '102', status: 'PAGO_FALLIDO' } });
    const failed = await db.subscription.findFirst({
      where: { accountId: 102n },
      include: { payments: true },
    });
    expect(failed?.status).toBe(SubscriptionStatus.PAGO_FALLIDO);
    expect(failed?.payments.map((p) => [p.status, p.paidAt])).toEqual([[PaymentStatus.FALLIDO, null]]);

    // 4. Historial de la cuenta, leído de la base.
    const history = await http.get('/api/billing/history/101').expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].payments).toHaveLength(1);
    await http.get('/api/billing/history/abc').expect(400);

    // 5. Cancelar: la suscripción queda CANCELADA.
    const canceled = await http.post('/api/billing/cancel').send({ accountId: '101' }).expect(200);
    expect(canceled.body.status).toBe('CANCELADA');
    const afterCancel = await db.subscription.findUnique({ where: { id: active[0].id } });
    expect(afterCancel?.status).toBe(SubscriptionStatus.CANCELADA);

    // 6. Datos inválidos no llegan a la base (ValidationPipe).
    await http
      .post('/api/billing/subscribe')
      .send({ accountId: 'no-numerico', plan: 'ORO', cardNumber: APPROVED_CARD })
      .expect(400);
    expect(await db.subscription.count()).toBe(2);
  });
});
