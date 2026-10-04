import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountPlan, AccountRole, AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (plain: string) => `hash(${plain})`),
  compare: jest.fn(async (plain: string, hash: string) => hash === `hash(${plain})`),
}));

describe('AuthService', () => {
  const ana = {
    id: 1n,
    email: 'ana@correo.com',
    passwordHash: 'hash(Secreta123)',
    status: AccountStatus.ACTIVA,
    role: AccountRole.USER,
    plan: AccountPlan.GRATIS,
    failedPaymentAttempts: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  let prisma: { account: { findUnique: jest.Mock; create: jest.Mock } };
  let profiles: { createFirstProfile: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = { account: { findUnique: jest.fn(), create: jest.fn() } };
    profiles = { createFirstProfile: jest.fn() };
    service = new AuthService(
      prisma as unknown as PrismaService,
      profiles as unknown as ProfilesService,
      new JwtService({}),
    );
  });

  it('registra la cuenta con la contraseña hasheada (bcrypt) y su primer perfil', async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.account.create.mockResolvedValue(ana);
    profiles.createFirstProfile.mockResolvedValue({ id: 1n, name: 'Ana', isKids: false });

    const result = await service.register({
      email: 'ana@correo.com',
      password: 'Secreta123',
      profileName: 'Ana',
    } as any);

    expect(bcrypt.hash).toHaveBeenCalledWith('Secreta123', 10);
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: { email: 'ana@correo.com', passwordHash: 'hash(Secreta123)' },
    });
    expect(result.account.id).toBe('1');
    expect(result.profile.name).toBe('Ana');
  });

  it('no permite registrar dos veces el mismo correo (409)', async () => {
    prisma.account.findUnique.mockResolvedValue(ana);
    await expect(
      service.register({ email: ana.email, password: 'x', profileName: 'Ana' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('login correcto: devuelve AccessToken y RefreshToken', async () => {
    prisma.account.findUnique.mockResolvedValue(ana);
    const result = await service.login({ email: ana.email, password: 'Secreta123' });
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken.split('.')).toHaveLength(3);
    expect(result.accountStatus).toBe(AccountStatus.ACTIVA);
  });

  it('contraseña incorrecta: 401', async () => {
    prisma.account.findUnique.mockResolvedValue(ana);
    await expect(
      service.login({ email: ana.email, password: 'otra' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cuenta SUSPENDIDA por pagos fallidos: 403 al iniciar sesión', async () => {
    prisma.account.findUnique.mockResolvedValue({ ...ana, status: AccountStatus.SUSPENDIDA });
    await expect(
      service.login({ email: ana.email, password: 'Secreta123' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('correo no registrado: 404 ACCOUNT_NOT_FOUND (el frontend lleva al registro)', async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    const err = await service.login({ email: 'nadie@correo.com', password: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getResponse()).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('el AccessToken lleva rol, plan y estado (el Gateway los pasa a los servicios)', async () => {
    prisma.account.findUnique.mockResolvedValue({ ...ana, role: AccountRole.ADMIN, plan: AccountPlan.PREMIUM });
    const { accessToken, account } = await service.login({ email: ana.email, password: 'Secreta123' });
    const claims = new JwtService({}).decode(accessToken) as any;
    expect(claims).toMatchObject({ sub: '1', role: 'ADMIN', plan: 'PREMIUM', status: 'ACTIVA' });
    expect(account).toMatchObject({ role: 'ADMIN', plan: 'PREMIUM' });
  });

  it('/me devuelve el plan actual y un token renovado con ese plan', async () => {
    prisma.account.findUnique.mockResolvedValue({ ...ana, plan: AccountPlan.ESTANDAR, _count: { profiles: 2 } });
    const result = await service.me('1');
    expect(result.account).toMatchObject({ plan: 'ESTANDAR', profiles: 2, profileLimit: 4 });
    expect((new JwtService({}).decode(result.accessToken) as any).plan).toBe('ESTANDAR');
  });
});
