import { describeBroker, describeConnectionError } from './rabbitmq.consumer';

describe('logs de conexión a RabbitMQ', () => {
  it('muestra host y puerto, nunca usuario ni contraseña', () => {
    expect(describeBroker('amqps://user:secreto@jackal.rmq.cloudamqp.com/vhost')).toBe(
      'amqps://jackal.rmq.cloudamqp.com',
    );
    expect(describeBroker('amqp://guest:guest@localhost:5672')).toBe('amqp://localhost:5672');
    expect(describeBroker('no es una url')).toBe('URL inválida');
  });

  it('explica un AggregateError sin mensaje (ECONNREFUSED en IPv4 e IPv6)', () => {
    const err = Object.assign(new AggregateError([], ''), {
      errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }],
    });
    expect(describeConnectionError(err)).toBe('ECONNREFUSED, ECONNREFUSED');
    expect(describeConnectionError(new Error('ACCESS_REFUSED'))).toBe('ACCESS_REFUSED');
  });
});
