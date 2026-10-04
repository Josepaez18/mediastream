import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountPlan, AccountRole, AccountStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

export class UpdateAccountDto {
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @IsOptional()
  @IsEnum(AccountRole)
  role?: AccountRole;

  @IsOptional()
  @IsEnum(AccountPlan)
  plan?: AccountPlan;
}

function parseId(id: string): bigint {
  if (!/^\d+$/.test(id)) throw new BadRequestException('Id de cuenta inválido.');
  return BigInt(id);
}

/** Administración de cuentas (solo rol ADMIN). */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('api/users/admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'Lista todas las cuentas con su rol, plan, estado y número de perfiles.' })
  async list() {
    const accounts = await this.prisma.account.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { profiles: true } } },
    });
    return accounts.map((a) => ({
      id: a.id.toString(),
      email: a.email,
      role: a.role,
      plan: a.plan,
      status: a.status,
      failedPaymentAttempts: a.failedPaymentAttempts,
      profiles: a._count.profiles,
      createdAt: a.createdAt,
    }));
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Cambia el estado, el rol o el plan de una cuenta.' })
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto, @Req() req: any) {
    const accountId = parseId(id);
    if (req.user.sub === id && (dto.role === AccountRole.USER || dto.status === AccountStatus.SUSPENDIDA)) {
      throw new BadRequestException('No puedes quitarte el rol de administrador ni suspender tu propia cuenta.');
    }
    const existing = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!existing) throw new NotFoundException('La cuenta no existe.');

    const updated = await this.prisma.account.update({
      where: { id: accountId },
      data: {
        ...dto,
        // Reactivar una cuenta limpia sus pagos fallidos.
        ...(dto.status === AccountStatus.ACTIVA ? { failedPaymentAttempts: 0 } : {}),
      },
    });
    return { id: updated.id.toString(), role: updated.role, plan: updated.plan, status: updated.status };
  }

  @Delete('accounts/:id')
  @ApiOperation({ summary: 'Elimina una cuenta y sus perfiles.' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const accountId = parseId(id);
    if (req.user.sub === id) throw new BadRequestException('No puedes eliminar tu propia cuenta.');
    const existing = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!existing) throw new NotFoundException('La cuenta no existe.');
    await this.prisma.account.delete({ where: { id: accountId } });
    return { deleted: id };
  }
}
