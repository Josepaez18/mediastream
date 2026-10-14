import { ConflictException, ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import { Plan, SubscriptionStatus } from '@prisma/client';
import { PaymentEventsService } from '../events/payment-events.service';
import { PaypalError, PaypalService } from '../paypal/paypal.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseCustomId, PaypalCheckoutService } from './paypal-checkout.service';

const completed = (customId: string, value = '0.02') => ({
  id: 'ORDER1',
  status: 'COMPLETED',
  purchase_units: [{ custom_id: customId, payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value } }] } }],
});

describe('PaypalCheckoutService', () => {
  let prisma: any;
  let paypal: Record<string, jest.Mock>;
  let events: { publishSubscriptionActivated: jest.Mock };
  let service: PaypalCheckoutService;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    prisma = {
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(async ({ data }) => ({ id: 1n, ...data })),
        update: jest.fn(async ({ data }) => ({ id: 1n, ...data })),
      },
      payment: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    paypal = {
      createOrder: jest.fn().mockResolvedValue({ id: 'ORDER1', status: 'CREATED' }),
      getOrder: jest.fn().mockResolvedValue({ id: 'ORDER1', status: 'APPROVED', purchase_units: [{ custom_id: '7:ESTANDAR' }] }),
      captureOrder: jest.fn().mockResolvedValue(completed('7:ESTANDAR')),
    };
    events = { publishSubscriptionActivated: jest.fn() };
    service = new PaypalCheckoutService(
      prisma as PrismaService,
      paypal as unknown as PaypalService,
      events as unknown as PaymentEventsService,
    );
  });

  it('el monto lo fija el servidor: precio en COP y su cobro en USD para PayPal', async () => {
    const order = await service.createOrder('7', Plan.ESTANDAR);
    expect(order).toMatchObject({ amount: 0.2, currency: 'COP', usdAmount: 0.02 });
    expect(paypal.createOrder).toHaveBeenCalledWith(0.02, expect.stringContaining('0.2 COP'), '7:ESTANDAR');
  });

  it('al cambiar de plan se cobra la diferencia (en COP y en USD)', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 1n, plan: Plan.BASICO });
    const change = await service.createOrder('7', Plan.PREMIUM);
    expect(change).toMatchObject({ mode: 'change', amount: 0.2, usdAmount: 0.02 });
  });

  it('no deja pagar el plan que ya tiene', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 1n, plan: Plan.ESTANDAR });
    await expect(service.createOrder('7', Plan.ESTANDAR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('capturar: crea la suscripción ACTIVA con el pago de PayPal y avisa a User', async () => {
    const result: any = await service.capture('ORDER1', '7');
    expect(result.httpStatus).toBe(HttpStatus.CREATED);
    const data = prisma.subscription.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ accountId: 7n, plan: Plan.ESTANDAR, status: SubscriptionStatus.ACTIVA });
    // Se registra el precio del plan en COP, no los USD que cobró PayPal.
    expect(data.payments.create).toMatchObject({ amount: 0.2, provider: 'PAYPAL', externalId: 'ORDER1' });
    expect(events.publishSubscriptionActivated).toHaveBeenCalledWith('7', Plan.ESTANDAR);
  });

  it('una orden de otra cuenta no se puede capturar', async () => {
    await expect(service.capture('ORDER1', '8')).rejects.toBeInstanceOf(ForbiddenException);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it('una orden ya aplicada no cobra ni activa otra vez', async () => {
    prisma.payment.findUnique.mockResolvedValue({ subscriptionId: 1n });
    prisma.subscription.findUnique.mockResolvedValue({ id: 1n, plan: Plan.ESTANDAR });
    const result: any = await service.capture('ORDER1', '7');
    expect(result.httpStatus).toBe(HttpStatus.OK);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(events.publishSubscriptionActivated).not.toHaveBeenCalled();
  });

  it('PayPal rechaza el medio de pago → 402 PAYPAL_DECLINED, sin activar', async () => {
    paypal.captureOrder.mockRejectedValue(new PaypalError('declined', 422, 'INSTRUMENT_DECLINED'));
    const err = await service.capture('ORDER1', '7').catch((e) => e);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toMatchObject({ code: 'PAYPAL_DECLINED' });
    expect(events.publishSubscriptionActivated).not.toHaveBeenCalled();
  });

  it('orden sin aprobar en PayPal → 409 PAYPAL_NOT_APPROVED, sin activar', async () => {
    paypal.captureOrder.mockRejectedValue(new PaypalError('not approved', 422, 'ORDER_NOT_APPROVED'));
    const err = await service.capture('ORDER1', '7').catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'PAYPAL_NOT_APPROVED' });
    expect(events.publishSubscriptionActivated).not.toHaveBeenCalled();
  });

  it('custom_id inválido o de un plan desconocido no se acepta', () => {
    expect(parseCustomId('7:PREMIUM')).toEqual({ accountId: '7', plan: 'PREMIUM' });
    expect(parseCustomId('7:ORO')).toBeNull();
    expect(parseCustomId(undefined)).toBeNull();
  });
});

describe('precios de los planes', () => {
  const { PLAN_PRICES, PAYPAL_USD_PRICES } = jest.requireActual('./plans');
  it('son ascendentes: Básico < Estándar < Premium (en COP y en lo que cobra PayPal)', () => {
    expect(PLAN_PRICES).toEqual({ BASICO: 0.1, ESTANDAR: 0.2, PREMIUM: 0.3 });
    expect(PAYPAL_USD_PRICES.BASICO).toBeLessThan(PAYPAL_USD_PRICES.ESTANDAR);
    expect(PAYPAL_USD_PRICES.ESTANDAR).toBeLessThan(PAYPAL_USD_PRICES.PREMIUM);
    // PayPal no acepta cobros por debajo de 0,01 USD.
    expect(Math.min(...Object.values(PAYPAL_USD_PRICES) as number[])).toBeGreaterThanOrEqual(0.01);
  });
});
