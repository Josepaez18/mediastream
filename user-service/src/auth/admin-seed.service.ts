import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AccountPlan, AccountRole, AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cuenta de administrador inicial. Si ADMIN_EMAIL y ADMIN_PASSWORD están
 * definidas, al arrancar se asegura de que exista una cuenta ADMIN con ese
 * correo y esa contraseña (las variables son la fuente de verdad: cambiarlas y
 * reiniciar actualiza la contraseña). Sin las variables no hace nada.
 *
 * El administrador puede, desde el panel, promover a otras cuentas.
 */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const admin = {
        passwordHash,
        role: AccountRole.ADMIN,
        plan: AccountPlan.PREMIUM,
        status: AccountStatus.ACTIVA,
        failedPaymentAttempts: 0,
      };
      const existing = await this.prisma.account.findUnique({ where: { email } });
      if (existing) {
        await this.prisma.account.update({ where: { id: existing.id }, data: admin });
      } else {
        await this.prisma.account.create({
          data: { email, ...admin, profiles: { create: { name: 'Administrador' } } },
        });
      }
      this.logger.log(`Cuenta de administrador lista: ${email}`);
    } catch (err) {
      // No impide arrancar: la base puede no estar lista todavía.
      this.logger.error(`No se pudo crear la cuenta de administrador: ${(err as Error).message}`);
    }
  }
}
