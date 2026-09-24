import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
