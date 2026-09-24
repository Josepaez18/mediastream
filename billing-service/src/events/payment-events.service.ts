import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';

// Tope para no dejar colgada la respuesta HTTP si RabbitMQ no contesta.
const PUBLISH_TIMEOUT_MS = 3000;

// amqp-connection-manager reporta los fallos como { err, url }, no como Error.
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  const inner = (err as { err?: unknown } | null)?.err;
  if (inner instanceof Error) return inner.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Publica el evento payment.failed hacia RabbitMQ.
 *
 * Es la mitad "Billing-Service" del patrón Saga por coreografía descrito en
 * la sección 4.3 del documento: cuando un cobro es rechazado, Billing-Service
 * primero completa su propia transacción local (registra el pago fallido en
 * su base de datos) y solo después publica este evento para que User-Service
 * ejecute, de forma independiente y desacoplada, su acción compensatoria
 * (restringir el acceso de la cuenta de forma progresiva).
 *
 * Contrato con User-Service (no cambiarlo sin cambiar el consumidor):
 *   cola     user_service.payment_failed (durable)
 *   patrón   payment.failed
 *   payload  { "accountId": "1" }
 * Nest lo envía como { "pattern": "payment.failed", "data": { ... } }, que es
 * justo lo que lee el @EventPattern('payment.failed') de User-Service.
 *
 * Simplificación pedagógica: si RabbitMQ no está disponible en este momento,
 * el error se registra en el log pero no se revierte el cobro ya guardado en
 * la base de datos de Billing-Service (esa parte de la transacción local ya
 * es válida por sí sola). Un sistema en producción resolvería esto con un
 * patrón Outbox para garantizar que el evento se publique eventualmente.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(@Inject('USER_SERVICE_EVENTS') private readonly client: ClientProxy) {}

  async publishPaymentFailed(accountId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.client.emit('payment.failed', { accountId }).pipe(timeout(PUBLISH_TIMEOUT_MS)),
      );
      this.logger.log(`Evento payment.failed publicado para la cuenta ${accountId}.`);
    } catch (err) {
      const detail = describeError(err);
      this.logger.error(
        `No se pudo publicar payment.failed para la cuenta ${accountId} en RabbitMQ: ${detail}`,
      );
      // Si la primera conexión falla, el cliente RMQ de Nest queda "roto" y
      // todos los eventos siguientes fallarían al instante, aunque RabbitMQ
      // vuelva. Cerrarlo obliga a abrir una conexión nueva en el próximo
      // evento: así Billing se recupera solo cuando el broker regresa.
      await Promise.resolve(this.client.close()).catch(() => undefined);
    }
  }
}
