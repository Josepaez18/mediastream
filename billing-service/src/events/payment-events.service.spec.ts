import * as amqp from 'amqplib';
import {
  BILLING_EXCHANGE,
  PAYMENT_FAILED_ROUTING_KEY,
  PaymentEventsService,
  USER_SERVICE_QUEUE,
} from './payment-events.service';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

describe('PaymentEventsService', () => {
  let channel: Record<string, jest.Mock>;
  let connection: Record<string, jest.Mock>;

  beforeEach(() => {
    channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockReturnValue(true),
      waitForConfirms: jest.fn().mockResolvedValue(undefined),
    };
    connection = {
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (amqp.connect as jest.Mock).mockReset().mockResolvedValue(connection);
  });

  it('publica en billing.events con el formato de Nest que lee User-Service', async () => {
    await new PaymentEventsService().publishPaymentFailed('7');

    expect(channel.publish).toHaveBeenCalledWith(
      BILLING_EXCHANGE,
      PAYMENT_FAILED_ROUTING_KEY,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const body = JSON.parse((channel.publish.mock.calls[0][2] as Buffer).toString());
    expect(body.pattern).toBe('payment.failed');
    expect(body.data.accountId).toBe('7');
    expect(body.data.eventId).toEqual(expect.any(String));
  });

  it('mantiene enlazada la cola de User-Service (el evento no se pierde si User está caído)', async () => {
    await new PaymentEventsService().publishPaymentFailed('7');

    expect(channel.assertQueue).toHaveBeenCalledWith(USER_SERVICE_QUEUE, { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      USER_SERVICE_QUEUE,
      BILLING_EXCHANGE,
      PAYMENT_FAILED_ROUTING_KEY,
    );
  });

  it('no lanza si RabbitMQ no está disponible y se reconecta en el siguiente evento', async () => {
    (amqp.connect as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const service = new PaymentEventsService();

    await expect(service.publishPaymentFailed('7')).resolves.toBeUndefined();
    await service.publishPaymentFailed('7');

    expect(amqp.connect).toHaveBeenCalledTimes(2);
    expect(channel.publish).toHaveBeenCalledTimes(1);
  });
});
