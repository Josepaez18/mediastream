import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { NotificationsService } from '../notifications/notifications.service';
import { parseMediaReady, parsePaymentFailed } from './event-payloads';

const RECONNECT_DELAY_MS = 5000;

interface Subscription {
  exchange: string;
  routingKey: string;
  queue: string;
  handle: (payload: unknown) => Promise<unknown>;
}

/**
 * Consume de RabbitMQ los eventos que "no pueden perderse" (sección 4.2):
 *
 *   exchange        routing key     cola propia de Notification
 *   media.events    media.ready     notification.media-events
 *   billing.events  payment.failed  notification_service.payment_failed
 *
 * Cada cola es de Notification-Service: Catalog y User tienen las suyas
 * enlazadas a los mismos exchanges, así que cada servicio recibe su propia
 * copia del evento y lo procesa a su ritmo. Si Notification está caído, sus
 * mensajes esperan en su cola sin afectar a los demás.
 */
@Injectable()
export class RabbitmqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqConsumer.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private closing = false;
  private readonly subscriptions: Subscription[];

  constructor(notifications: NotificationsService) {
    this.subscriptions = [
      {
        exchange: 'media.events',
        routingKey: 'media.ready',
        queue: 'notification.media-events',
        handle: (payload) => notifications.onMediaReady(parseMediaReady(payload)),
      },
      {
        exchange: 'billing.events',
        routingKey: 'payment.failed',
        queue: 'notification_service.payment_failed',
        handle: (payload) => notifications.onPaymentFailed(parsePaymentFailed(payload)),
      },
    ];
  }

  async onModuleInit() {
    // No se espera a RabbitMQ para arrancar: si no está, se reintenta en
    // segundo plano y el historial de notificaciones sigue respondiendo.
    void this.connectWithRetry();
  }

  async onModuleDestroy() {
    this.closing = true;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  isConnected(): boolean {
    return !!this.connection && !!this.channel;
  }

  private async connectWithRetry() {
    const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
    try {
      const connection = await amqp.connect(url);
      const channel = await connection.createChannel();
      await channel.prefetch(10);

      for (const sub of this.subscriptions) {
        await channel.assertExchange(sub.exchange, 'topic', { durable: true });
        await channel.assertQueue(sub.queue, { durable: true });
        await channel.bindQueue(sub.queue, sub.exchange, sub.routingKey);
        await channel.consume(sub.queue, (msg) => this.handleMessage(sub, msg), { noAck: false });
      }

      connection.on('close', () => {
        this.connection = null;
        this.channel = null;
        if (this.closing) return;
        this.logger.warn('Conexión a RabbitMQ cerrada, reintentando...');
        setTimeout(() => this.connectWithRetry(), RECONNECT_DELAY_MS);
      });
      connection.on('error', (err: Error) => this.logger.warn(`Error de conexión RabbitMQ: ${err.message}`));

      this.connection = connection;
      this.channel = channel;
      this.logger.log(
        `Conectado a RabbitMQ, escuchando ${this.subscriptions.map((s) => s.routingKey).join(', ')}`,
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo conectar a RabbitMQ (${(err as Error).message}). Reintentando en ${RECONNECT_DELAY_MS}ms...`,
      );
      if (!this.closing) setTimeout(() => this.connectWithRetry(), RECONNECT_DELAY_MS);
    }
  }

  private async handleMessage(sub: Subscription, msg: amqp.ConsumeMessage | null) {
    const channel = this.channel;
    if (!msg || !channel) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      this.logger.log(`Evento ${sub.routingKey} recibido`);
      await sub.handle(payload);
      channel.ack(msg);
    } catch (err) {
      this.logger.error(`Error procesando ${sub.routingKey}: ${(err as Error).message}`);
      // Reintenta una vez (requeue); si vuelve a fallar se descarta para no
      // bloquear la cola con un mensaje corrupto (sección 4.6).
      channel.nack(msg, false, !msg.fields.redelivered);
    }
  }
}
