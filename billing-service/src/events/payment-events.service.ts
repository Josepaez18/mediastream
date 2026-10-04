import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';

// Tope para no dejar colgada la respuesta HTTP si RabbitMQ no contesta.
const PUBLISH_TIMEOUT_MS = 3000;

/**
 * Contrato del evento payment.failed (no cambiarlo sin cambiar los consumidores):
 *
 *   exchange     billing.events (topic, durable)
 *   routing key  payment.failed
 *   mensaje      { "pattern": "payment.failed",
 *                  "data": { "accountId": "1", "eventId": "…", "occurredAt": "…" } }
 *
 * El mensaje conserva el formato de Nest ({ pattern, data }) porque User-Service
 * lo consume con @EventPattern('payment.failed'). eventId y occurredAt son
 * campos nuevos y opcionales: User los ignora; Notification-Service usa
 * eventId para no avisar dos veces del mismo rechazo si RabbitMQ lo reentrega.
 */
export const BILLING_EXCHANGE = 'billing.events';
export const PAYMENT_FAILED_ROUTING_KEY = 'payment.failed';
/**
 * Cambios de plan, mismo exchange y mismo formato de Nest:
 *   subscription.activated  { accountId, plan }  cobro exitoso (alta, cambio de plan o renovación)
 *   subscription.canceled   { accountId }        la persona canceló: vuelve al plan GRATIS
 * Los consume User-Service (actualiza el plan de la cuenta).
 */
export const SUBSCRIPTION_ACTIVATED_ROUTING_KEY = 'subscription.activated';
export const SUBSCRIPTION_CANCELED_ROUTING_KEY = 'subscription.canceled';
const USER_SERVICE_ROUTING_KEYS = [
  PAYMENT_FAILED_ROUTING_KEY,
  SUBSCRIPTION_ACTIVATED_ROUTING_KEY,
  SUBSCRIPTION_CANCELED_ROUTING_KEY,
];

/**
 * La cola de User-Service se declara y se enlaza aquí para conservar el
 * contrato anterior (cuando Billing publicaba directo en ella): si User está
 * caído o todavía no arrancó, el evento igual queda guardado en su cola.
 * Notification-Service declara y enlaza la suya por su cuenta: Billing no
 * necesita conocerla.
 */
export const USER_SERVICE_QUEUE = 'user_service.payment_failed';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sin respuesta en ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Publica el evento payment.failed hacia RabbitMQ.
 *
 * Es la mitad "Billing-Service" del patrón Saga por coreografía descrito en
 * la sección 4.3 del documento: cuando un cobro es rechazado, Billing-Service
 * primero completa su propia transacción local (registra el pago fallido en
 * su base de datos) y solo después publica este evento. Lo consumen, cada uno
 * desde su propia cola enlazada al exchange:
 *   · User-Service          → restringe el acceso de forma progresiva.
 *   · Notification-Service  → avisa al usuario (sección 4.2).
 *
 * Simplificación pedagógica: si RabbitMQ no está disponible en este momento,
 * el error se registra en el log pero no se revierte el cobro ya guardado en
 * la base de datos de Billing-Service (esa parte de la transacción local ya
 * es válida por sí sola). Un sistema en producción resolvería esto con un
 * patrón Outbox para garantizar que el evento se publique eventualmente.
 */
@Injectable()
export class PaymentEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentEventsService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;

  publishPaymentFailed(accountId: string): Promise<void> {
    return this.emit(PAYMENT_FAILED_ROUTING_KEY, { accountId });
  }

  publishSubscriptionActivated(accountId: string, plan: string): Promise<void> {
    return this.emit(SUBSCRIPTION_ACTIVATED_ROUTING_KEY, { accountId, plan });
  }

  publishSubscriptionCanceled(accountId: string): Promise<void> {
    return this.emit(SUBSCRIPTION_CANCELED_ROUTING_KEY, { accountId });
  }

  private async emit(routingKey: string, data: Record<string, unknown>): Promise<void> {
    const message = {
      pattern: routingKey,
      data: { ...data, eventId: randomUUID(), occurredAt: new Date().toISOString() },
    };
    try {
      await withTimeout(this.publish(routingKey, message), PUBLISH_TIMEOUT_MS);
      this.logger.log(`Evento ${routingKey} publicado para la cuenta ${data.accountId}.`);
    } catch (err) {
      this.logger.error(
        `No se pudo publicar ${routingKey} para la cuenta ${data.accountId} en RabbitMQ: ${describeError(err)}`,
      );
      // Se descarta la conexión para abrir una nueva en el próximo evento:
      // así Billing se recupera solo cuando el broker regresa.
      await this.reset();
    }
  }

  async onModuleDestroy() {
    await this.reset();
  }

  private async publish(routingKey: string, message: object): Promise<void> {
    const channel = await this.getChannel();
    channel.publish(
      BILLING_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      // Mensajes persistentes: payment.failed "no puede perderse" (sección 4.2).
      { persistent: true, contentType: 'application/json' },
    );
    // Canal en modo confirmación: espera a que el broker acepte el mensaje.
    await channel.waitForConfirms();
  }

  private async getChannel(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return this.channel;

    const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    const connection = await amqp.connect(url);
    connection.on('error', (err: Error) =>
      this.logger.warn(`Error de conexión RabbitMQ: ${err.message}`),
    );
    connection.on('close', () => {
      this.connection = null;
      this.channel = null;
    });
    const channel = await connection.createConfirmChannel();

    await channel.assertExchange(BILLING_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(USER_SERVICE_QUEUE, { durable: true });
    for (const key of USER_SERVICE_ROUTING_KEYS) {
      await channel.bindQueue(USER_SERVICE_QUEUE, BILLING_EXCHANGE, key);
    }

    this.connection = connection;
    this.channel = channel;
    return channel;
  }

  private async reset(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.channel = null;
    await connection?.close().catch(() => undefined);
  }
}
