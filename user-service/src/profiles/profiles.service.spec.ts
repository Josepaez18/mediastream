import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountPlan, AccountRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from './profiles.service';

describe('ProfilesService', () => {
  const account = (plan: AccountPlan, profiles: number, role: AccountRole = AccountRole.USER) => ({
    id: 1n,
    plan,
    role,
    _count: { profiles },
  });
  let prisma: any;
  let service: ProfilesService;

  beforeEach(() => {
    prisma = {
      account: { findUnique: jest.fn() },
      profile: {
        create: jest.fn(async ({ data }) => ({ id: 9n, ...data })),
        findUnique: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new ProfilesService(prisma as PrismaService);
  });

  it('el plan GRATIS permite un solo perfil', async () => {
    prisma.account.findUnique.mockResolvedValue(account(AccountPlan.GRATIS, 1));
    const err = await service.create(1n, 'Niños', true).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'PROFILE_LIMIT' });
  });

  it('PREMIUM permite hasta cinco y el administrador siempre el máximo', async () => {
    prisma.account.findUnique.mockResolvedValue(account(AccountPlan.PREMIUM, 4));
    await expect(service.create(1n, 'Quinto', false)).resolves.toMatchObject({ name: 'Quinto' });
    prisma.account.findUnique.mockResolvedValue(account(AccountPlan.GRATIS, 3, AccountRole.ADMIN));
    await expect(service.create(1n, 'Otro', false)).resolves.toMatchObject({ name: 'Otro' });
  });

  it('no deja borrar el último perfil ni uno de otra cuenta', async () => {
    prisma.profile.findUnique.mockResolvedValue({ id: 2n, accountId: 1n });
    prisma.profile.count.mockResolvedValue(1);
    await expect(service.remove(1n, 2n)).rejects.toBeInstanceOf(BadRequestException);
    prisma.profile.findUnique.mockResolvedValue({ id: 2n, accountId: 7n });
    await expect(service.remove(1n, 2n)).rejects.toThrow('no existe en esta cuenta');
  });
});
