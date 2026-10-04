import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Solo administradores. Se usa después de JwtAuthGuard y vuelve a leer el
 * rol de la base: si a alguien le quitaron el rol, su token viejo (que aún
 * dice ADMIN) deja de servir de inmediato. El Gateway hace el mismo filtro
 * antes, con el rol del token.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sub = request.user?.sub;
    const account = sub
      ? await this.prisma.account.findUnique({ where: { id: BigInt(sub) }, select: { role: true } })
      : null;
    if (account?.role !== AccountRole.ADMIN) {
      throw new ForbiddenException('Requiere rol de administrador.');
    }
    return true;
  }
}
