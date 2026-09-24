import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { PaymentRestrictionService } from './payment-restriction.service';

interface PaymentFailedEvent {
  accountId: string;
}

@Controller()
export class PaymentFailedController {
  private readonly logger = new Logger(PaymentFailedController.name);

  constructor(private readonly paymentRestriction: PaymentRestrictionService) {}

  // Consumido de forma asíncrona: evento payment.failed publicado por Billing-Service.
  // Es la acción compensatoria del patrón Saga descrita en la sección 4.3 del documento.
  @EventPattern('payment.failed')
  async handlePaymentFailed(
    @Payload() data: PaymentFailedEvent,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.paymentRestriction.registerFailedPayment(data.accountId);
      channel.ack(originalMsg);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) {
        this.logger.warn(
          `payment.failed recibido para una cuenta inexistente: ${data.accountId}`,
        );
        channel.ack(originalMsg); // no reintentar: la cuenta no existe
        return;
      }
      this.logger.error('Error procesando payment.failed, se reintentará.', err as Error);
      channel.nack(originalMsg, false, true); // reintentar (RabbitMQ, sección 4.6)
    }
  }
}
