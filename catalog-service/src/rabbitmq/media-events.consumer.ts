import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { CatalogService } from '../catalog/catalog.service';

const EXCHANGE = 'media.events';
const QUEUE = 'catalog.media-events';
const ROUTING_KEYS = ['media.ready', 'media.processing.failed'];
const RECONNECT_DELAY_MS = 5000;

// Media-Processing-Service (Python) publica el id en snake_case (title_id);
// el script de simulación scripts/publish-media-ready.js lo manda en
// camelCase (titleId). Se aceptan ambos (patrón "tolerant reader"): el
// consumidor no le impone al publicador la convención de nombres de su
// propio lenguaje.
interface MediaEventPayload {
  titleId?: string | number;
  title_id?: string | number;
  job_id?: string;
  resolutionsGenerated?: string[];
}

export function extractTitleId(payload: MediaEventPayload): bigint {
  const raw = payload.titleId ?? payload.title_id;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new Error('El evento no trae titleId ni title_id');
  }
  return BigInt(String(raw).trim());
}

// Consume los eventos asíncronos publicados por Media-Processing-Service
// (sección 3 y 4.2 del documento). Usa RabbitMQ porque son eventos que no
// pueden perderse y requieren reintento ante fallo.
@Injectable()
export class MediaEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaEventsConsumer.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;

  constructor(private readonly catalogService: CatalogService) {}

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  isConnected(): boolean {
    return !!this.connection && !!this.channel;
  }

  private async connectWithRetry() {
    const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
    try {
      // Se usan variables locales (en vez de this.connection/this.channel)
      // mientras se configura todo, para que TypeScript pueda garantizar que
      // no son null en cada paso sin necesidad de comprobarlo una y otra vez.
      const connection = await amqp.connect(url);
      const channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      const { queue } = await channel.assertQueue(QUEUE, { durable: true });

      for (const routingKey of ROUTING_KEYS) {
        await channel.bindQueue(queue, EXCHANGE, routingKey);
      }

      await channel.prefetch(10);
      await channel.consume(queue, (msg) => this.handleMessage(msg), { noAck: false });

      connection.on('close', () => {
        this.logger.warn('Conexión a RabbitMQ cerrada, reintentando...');
        this.connection = null;
        this.channel = null;
        setTimeout(() => this.connectWithRetry(), RECONNECT_DELAY_MS);
      });
      connection.on('error', (err: Error) => {
        this.logger.warn(`Error de conexión RabbitMQ: ${err.message}`);
      });

      this.connection = connection;
      this.channel = channel;
      this.logger.log(`Conectado a RabbitMQ, escuchando ${ROUTING_KEYS.join(', ')}`);
    } catch (err) {
      this.logger.warn(
        `No se pudo conectar a RabbitMQ (${(err as Error).message}). Reintentando en ${RECONNECT_DELAY_MS}ms...`,
      );
      setTimeout(() => this.connectWithRetry(), RECONNECT_DELAY_MS);
    }
  }

  private async handleMessage(msg: amqp.ConsumeMessage | null) {
    const channel = this.channel;
    if (!msg || !channel) return;

    try {
      const payload = JSON.parse(msg.content.toString()) as MediaEventPayload;
      const routingKey = msg.fields.routingKey;
      const titleId = extractTitleId(payload);

      this.logger.log(
        `Evento ${routingKey} recibido para título ${titleId}` +
          (payload.job_id ? ` (job ${payload.job_id})` : ''),
      );

      if (routingKey === 'media.ready') {
        await this.catalogService.markTitleAsAvailable(titleId);
      } else if (routingKey === 'media.processing.failed') {
        await this.catalogService.markTitleAsUnavailable(titleId);
      }

      channel.ack(msg);
    } catch (err) {
      this.logger.error(`Error procesando evento: ${(err as Error).message}`);
      // Reintenta una vez (requeue=true); si vuelve a fallar, se descarta para
      // no bloquear la cola indefinidamente con un mensaje corrupto.
      channel.nack(msg, false, !msg.fields.redelivered);
    }
  }
}
