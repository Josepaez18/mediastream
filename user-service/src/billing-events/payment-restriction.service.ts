import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountStatus } from '@prisma/client';

// Umbral de restricción progresiva (sección 4.3 Patrón Saga / acción compensatoria):
// 1er y 2do intento fallido -> MOROSA (acceso restringido, ej. sin reproducción)
// 3er intento fallido en adelante -> SUSPENDIDA (login bloqueado)
const SUSPEND_AFTER_ATTEMPTS = 3;

export interface PaymentRestrictionResult {
  accountId: string;
  attempts: number;
  status: AccountStatus;
}

/**
 * Lógica compartida de restricción progresiva de acceso por pagos fallidos.
 * La usan dos caminos distintos hacia el mismo resultado:
 *  - PaymentFailedController: consumidor RabbitMQ (evento payment.failed real,
 *    publicado por Billing-Service).
 *  - PaymentDebugController: endpoint REST, solo para poder demostrar el
 *    mismo flujo desde la consola web sin depender de una terminal aparte.
 */
@Injectable()
export class PaymentRestrictionService {
  private readonly logger = new Logger(PaymentRestrictionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerFailedPayment(accountIdRaw: string): Promise<PaymentRestrictionResult> {
    const accountId = BigInt(accountIdRaw);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundException('La cuenta no existe.');
    }

    const attempts = account.failedPaymentAttempts + 1;
    const status: AccountStatus =
      attempts >= SUSPEND_AFTER_ATTEMPTS ? AccountStatus.SUSPENDIDA : AccountStatus.MOROSA;

    await this.prisma.account.update({
      where: { id: accountId },
      data: { failedPaymentAttempts: attempts, status },
    });

    this.logger.log(`Cuenta ${accountIdRaw}: intento fallido #${attempts} -> estado ${status}`);

    return { accountId: accountIdRaw, attempts, status };
  }
}
