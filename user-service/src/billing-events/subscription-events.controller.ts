import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { AccountPlan, AccountStatus } from '@prisma/client';
import { isPlan } from '../common/plans';
import { PrismaService } from '../prisma/prisma.service';

interface SubscriptionEvent {
  accountId: string;
  plan?: string;
}

/**
 * Eventos de Billing que cambian el plan de la cuenta (exchange
 * billing.events, misma cola user_service.payment_failed):
 *   subscription.activated → plan pagado, cuenta ACTIVA y sin pagos fallidos.
 *   subscription.canceled  → vuelve al plan GRATIS.
 * User no llama a Billing ni lee su base: reacciona a lo que Billing decidió.
 */
@Controller()
export class SubscriptionEventsController {
  private readonly logger = new Logger(SubscriptionEventsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @EventPattern('subscription.activated')
  async activated(@Payload() data: SubscriptionEvent, @Ctx() context: RmqContext) {
    await this.apply(context, data, () => {
      if (!isPlan(data.plan)) throw new Error(`Plan desconocido: ${data.plan}`);
      return { plan: data.plan, status: AccountStatus.ACTIVA, failedPaymentAttempts: 0 };
    });
  }

  @EventPattern('subscription.canceled')
  async canceled(@Payload() data: SubscriptionEvent, @Ctx() context: RmqContext) {
    await this.apply(context, data, () => ({ plan: AccountPlan.GRATIS }));
  }

  private async apply(
    context: RmqContext,
    data: SubscriptionEvent,
    changes: () => { plan: AccountPlan; status?: AccountStatus; failedPaymentAttempts?: number },
  ) {
    const channel = context.getChannelRef();
    const message = context.getMessage();
    try {
      const update = changes();
      const result = await this.prisma.account.updateMany({
        where: { id: BigInt(data.accountId) },
        data: update,
      });
      if (result.count === 0) {
        this.logger.warn(`Evento de suscripción para una cuenta inexistente: ${data.accountId}`);
      } else {
        this.logger.log(`Cuenta ${data.accountId}: plan ${update.plan}`);
      }
      channel.ack(message);
    } catch (err) {
      this.logger.error(`Evento de suscripción inválido, se descarta: ${(err as Error).message}`);
      channel.ack(message); // un mensaje mal formado no se arregla reintentando
    }
  }
}
