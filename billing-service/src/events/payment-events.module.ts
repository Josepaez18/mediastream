import { Module } from '@nestjs/common';
import { PaymentEventsService } from './payment-events.service';

// Publica payment.failed en el exchange billing.events de RabbitMQ (sección
// 4.2 del documento). Ver el contrato en payment-events.service.ts.
@Module({
  providers: [PaymentEventsService],
  exports: [PaymentEventsService],
})
export class PaymentEventsModule {}
