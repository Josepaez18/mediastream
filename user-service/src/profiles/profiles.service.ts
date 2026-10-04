import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { profileLimit } from '../common/plans';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async createFirstProfile(accountId: bigint, name: string, isKids: boolean) {
    return this.prisma.profile.create({
      data: { accountId, name, isKids },
    });
  }

  async listByAccount(accountId: bigint) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException('La cuenta no existe.');
    }
    return this.prisma.profile.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Crea un perfil respetando el límite del plan de la cuenta. */
  async create(accountId: bigint, name: string, isKids: boolean) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { _count: { select: { profiles: true } } },
    });
    if (!account) throw new NotFoundException('La cuenta no existe.');

    const limit = profileLimit(account.plan, account.role);
    if (account._count.profiles >= limit) {
      throw new ForbiddenException({
        message: `Tu plan ${account.plan} permite ${limit} perfil(es). Mejora tu plan para agregar más.`,
        code: 'PROFILE_LIMIT',
      });
    }
    return this.prisma.profile.create({ data: { accountId, name, isKids } });
  }

  /** Borra un perfil de la propia cuenta; siempre debe quedar al menos uno. */
  async remove(accountId: bigint, profileId: bigint) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile || profile.accountId !== accountId) {
      throw new NotFoundException('El perfil no existe en esta cuenta.');
    }
    const count = await this.prisma.profile.count({ where: { accountId } });
    if (count <= 1) {
      throw new BadRequestException('La cuenta debe conservar al menos un perfil.');
    }
    await this.prisma.profile.delete({ where: { id: profileId } });
    return { deleted: profileId.toString() };
  }
}
