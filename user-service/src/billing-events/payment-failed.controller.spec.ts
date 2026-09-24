import { NotFoundException } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { PaymentFailedController } from './payment-failed.controller';
import { PaymentRestrictionService } from './payment-restriction.service';

/**
 * Consumidor de payment.failed (RabbitMQ). El mensaje solo se confirma (ack)
 * cuando se procesó; ante un error temporal se devuelve a la cola (nack con
 * requeue) para reintentarlo (sección 4.6).
 */
describe('PaymentFailedController', () => {
  const message = { content: Buffer.from('{}') };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let context: RmqContext;
  let restriction: { registerFailedPayment: jest.Mock };
  let controller: PaymentFailedController;

  beforeEach(() => {
    channel = { ack: jest.fn(), nack: jest.fn() };
    context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    restriction = { registerFailedPayment: jest.fn() };
    controller = new PaymentFailedController(
      restriction as unknown as PaymentRestrictionService,
    );
  });

  it('procesa el evento y confirma el mensaje', async () => {
    restriction.registerFailedPayment.mockResolvedValue({ attempts: 1, status: 'MOROSA' });
    await controller.handlePaymentFailed({ accountId: '7' }, context);
    expect(restriction.registerFailedPayment).toHaveBeenCalledWith('7');
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('si la cuenta no existe, confirma sin reintentar', async () => {
    restriction.registerFailedPayment.mockRejectedValue(new NotFoundException());
    await controller.handlePaymentFailed({ accountId: '999' }, context);
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('ante un error temporal devuelve el mensaje a la cola', async () => {
    restriction.registerFailedPayment.mockRejectedValue(new Error('Base de datos caída'));
    await controller.handlePaymentFailed({ accountId: '7' }, context);
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
