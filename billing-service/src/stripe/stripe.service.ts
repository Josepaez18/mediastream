import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

/**
 * SIMULACIÓN de la integración con la pasarela de pago (Stripe).
 *
 * El documento de arquitectura (sección 4.1) indica que Billing-Service debe
 * cobrar la tarjeta llamando a Stripe de forma síncrona ("Billing-Service ->
 * Stripe, para procesar el cobro de una suscripción o de un cambio de plan").
 * Este proyecto de curso no cuenta con credenciales reales de Stripe, así
 * que esta clase simula esa llamada usando la misma convención de "tarjetas
 * de prueba" que usa Stripe en su propio modo de pruebas:
 *
 *   4242 4242 4242 4242  -> cobro EXITOSO   (tarjeta de prueba real de Stripe)
 *   4000 0000 0000 0002  -> cobro FALLIDO   (tarjeta de prueba real de Stripe)
 *   cualquier otro número -> sin respuesta de la pasarela (timeout simulado),
 *                            se trata como PENDIENTE y NO como un rechazo,
 *                            tal como pide la sección 4.5 del documento:
 *                            "tratando el caso 'sin respuesta' como un pago
 *                            pendiente y no como un rechazo automático".
 *
 * Para integrar Stripe de verdad más adelante basta con reemplazar el
 * cuerpo de charge() por una llamada al SDK oficial de Stripe
 * (stripe.paymentIntents.create/confirm) usando STRIPE_SECRET_KEY, la única
 * variable de entorno exclusiva de Billing-Service según la sección 8.3 del
 * documento (ya está documentada en .env.example, sin usarse todavía).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  async charge(cardNumber: string, amount: number): Promise<PaymentStatus> {
    // Simula la latencia de red de una pasarela de pago real.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const normalized = (cardNumber || '').replace(/\s+/g, '');

    if (normalized === '4242424242424242') {
      this.logger.log(`Cobro simulado de ${amount} aprobado.`);
      return PaymentStatus.EXITOSO;
    }

    if (normalized === '4000000000000002') {
      this.logger.warn(`Cobro simulado de ${amount} rechazado por la pasarela.`);
      return PaymentStatus.FALLIDO;
    }

    this.logger.warn(
      `Cobro simulado de ${amount}: sin respuesta de la pasarela (timeout simulado).`,
    );
    return PaymentStatus.PENDIENTE;
  }
}
