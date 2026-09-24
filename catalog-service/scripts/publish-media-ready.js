/**
 * Simula lo que hará Media-Processing-Service cuando esté implementado:
 * publica un evento media.ready en RabbitMQ para que Catalog-Service
 * marque un título como AVAILABLE.
 *
 * Uso:
 *   node scripts/publish-media-ready.js <titleId> [routingKey]
 *
 * Ejemplos:
 *   node scripts/publish-media-ready.js 2
 *   node scripts/publish-media-ready.js 2 media.processing.failed
 */
const amqp = require('amqplib');

const EXCHANGE = 'media.events';

async function main() {
  const titleId = process.argv[2];
  const routingKey = process.argv[3] || 'media.ready';

  if (!titleId) {
    console.error('Debes indicar el titleId. Ej: node scripts/publish-media-ready.js 2');
    process.exit(1);
  }

  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  const payload = {
    titleId,
    resolutionsGenerated: ['480p', '720p', '1080p'],
  };

  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });

  console.log(`Evento "${routingKey}" publicado para titleId=${titleId}`);

  await channel.close();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
