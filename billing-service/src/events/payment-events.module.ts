import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PaymentEventsService } from './payment-events.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'USER_SERVICE_EVENTS',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
            // OJO: es la MISMA cola que User-Service ya consume con
            // @EventPattern('payment.failed'). No es una cola propia de
            // Billing-Service: es el canal asíncrono que conecta a los dos
            // microservicios (sección 4.2 del documento).
            queue: 'user_service.payment_failed',
            queueOptions: { durable: true },
            // Mensajes persistentes: la cola durable sobrevive a un reinicio de
            // RabbitMQ, pero sin esto los mensajes que esperan en ella no.
            // payment.failed "no puede perderse" (sección 4.2 del documento).
            persistent: true,
          },
        }),
      },
    ]),
  ],
  providers: [PaymentEventsService],
  exports: [PaymentEventsService],
})
export class PaymentEventsModule {}
