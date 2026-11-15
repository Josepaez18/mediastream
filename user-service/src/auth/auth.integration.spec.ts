import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountPlan, PrismaClient } from '@prisma/client';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AuthModule } from './auth.module';

/**
 * Prueba de integración: endpoints HTTP reales (supertest) → AuthService y
 * ProfilesService → PostgreSQL real, con las migraciones de Prisma aplicadas
 * en una base temporal que se borra al terminar.
 *
 * Necesita TEST_ADMIN_DATABASE_URL: un PostgreSQL con permiso para crear
 * bases (el pipeline de CI la define con su PostgreSQL efímero). Sin ella la
 * prueba se omite, igual que las de integración de los servicios Python.
 *
 *   TEST_ADMIN_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci npm test
 */
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const describeWithDb = ADMIN_URL ? describe : describe.skip;

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

describeWithDb('User-Service + PostgreSQL (integración)', () => {
  const dbName = `user_it_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
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

    // PrismaService lee DATABASE_URL al crearse. Sin ADMIN_EMAIL no se crea el
    // administrador inicial, así la base empieza vacía.
    process.env.DATABASE_URL = url;
    delete process.env.ADMIN_EMAIL;

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule, ProfilesModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Igual que main.ts.
    app.use(cookieParser());
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

  it('registro → login → perfiles: guarda la cuenta, emite los tokens y aplica el límite del plan', async () => {
    const http = request(app.getHttpServer());
    const email = 'ana.integracion@correo.com';
    const password = 'clave-segura-123';

    // 1. Registro: la cuenta y su primer perfil quedan en PostgreSQL.
    const registered = await http
      .post('/api/users/register')
      .send({ email, password, profileName: 'Ana' })
      .expect(201);
    expect(registered.body.account).toMatchObject({ email, status: 'ACTIVA' });
    expect(registered.body.profile).toMatchObject({ name: 'Ana', isKids: false });
    const accountId: string = registered.body.account.id;

    const stored = await db.account.findUnique({
      where: { email },
      include: { profiles: true },
    });
    expect(stored?.id.toString()).toBe(accountId);
    expect(stored?.passwordHash).not.toBe(password); // nunca en texto plano (bcrypt)
    expect(stored?.passwordHash.startsWith('$2')).toBe(true);
    expect(stored?.profiles.map((p) => p.name)).toEqual(['Ana']);

    // 2. El correo es único: un segundo registro responde 409.
    await http
      .post('/api/users/register')
      .send({ email, password, profileName: 'Otra' })
      .expect(409);

    // 3. Login: valida contra el hash guardado y entrega el refresh token en cookie httpOnly.
    const wrongPassword = [...password].reverse().join('');
    await http.post('/api/users/login').send({ email, password: wrongPassword }).expect(401);
    const login = await http.post('/api/users/login').send({ email, password }).expect(200);
    expect(login.body.accessToken.split('.')).toHaveLength(3);
    expect(login.body.account).toMatchObject({ id: accountId, plan: 'GRATIS', role: 'USER' });
    const cookies = ([] as string[]).concat(login.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    // 4. Perfiles de la cuenta, leídos de la base con el AccessToken.
    const profiles = await http.get(`/api/users/profiles/${accountId}`).set(auth).expect(200);
    expect(profiles.body.map((p: { name: string }) => p.name)).toEqual(['Ana']);
    await http.get(`/api/users/profiles/${accountId}`).expect(401);

    // 5. El plan GRATIS permite un solo perfil: el segundo se rechaza (403 PROFILE_LIMIT).
    const limited = await http
      .post('/api/users/profiles')
      .set(auth)
      .send({ name: 'Niños', isKids: true })
      .expect(403);
    expect(limited.body.code).toBe('PROFILE_LIMIT');

    // 6. Con un plan de pago (lo cambia el evento subscription.activated de
    //    Billing), el mismo pedido sí crea el perfil en la base.
    await db.account.update({ where: { email }, data: { plan: AccountPlan.PREMIUM } });
    await http.post('/api/users/profiles').set(auth).send({ name: 'Niños', isKids: true }).expect(201);
    expect(await db.profile.count({ where: { accountId: BigInt(accountId) } })).toBe(2);

    // 7. El refresh token de la cookie emite un AccessToken nuevo.
    const refreshCookie = cookies.find((c) => c.startsWith('refresh_token=')) as string;
    const refreshed = await http
      .post('/api/users/refresh')
      .set('Cookie', refreshCookie.split(';')[0])
      .expect(200);
    expect(refreshed.body.accessToken.split('.')).toHaveLength(3);
  });
});
