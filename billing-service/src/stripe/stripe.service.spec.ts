import { Logger } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { StripeService } from './stripe.service';

/** Tarjetas de prueba de Stripe usadas por la simulación de la pasarela. */
describe('StripeService (pasarela simulada)', () => {
  const stripe = new StripeService();
  beforeAll(() => Logger.overrideLogger(false));

  it('4242 4242 4242 4242 → cobro EXITOSO', async () => {
    await expect(stripe.charge('4242 4242 4242 4242', 12.99)).resolves.toBe(PaymentStatus.EXITOSO);
  });

  it('4000 0000 0000 0002 → cobro FALLIDO', async () => {
    await expect(stripe.charge('4000000000000002', 12.99)).resolves.toBe(PaymentStatus.FALLIDO);
  });

  it('cualquier otra tarjeta → sin respuesta: PENDIENTE, no rechazo (sección 4.5)', async () => {
    await expect(stripe.charge('5555555555554444', 12.99)).resolves.toBe(PaymentStatus.PENDIENTE);
  });
});
