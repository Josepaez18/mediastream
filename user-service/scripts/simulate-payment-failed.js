/**
 * Simula lo que hará Billing-Service cuando esté implementado: publica un
 * evento payment.failed hacia la cola que consume User-Service.
 *
 * Uso:
 *   node scripts/simulate-payment-failed.js <accountId>
 *
 * Nota: Billing-Service real debería emitir el evento con un ClientProxy de
 * @nestjs/microservices (transport RMQ) apuntando a la misma cola, lo que
 * genera automáticamente el mismo formato de mensaje usado aquí.
 */
const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE = 'user_service.payment_failed';

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('Uso: node scripts/simulate-payment-failed.js <accountId>');
    process.exit(1);
  }

  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });

  const message = { pattern: 'payment.failed', data: { accountId } };
  channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(message)), { persistent: true });

  console.log(`Evento payment.failed publicado para la cuenta ${accountId}`);
  await channel.close();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
