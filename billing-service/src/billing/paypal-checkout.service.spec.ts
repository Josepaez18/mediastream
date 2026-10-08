import { ConflictException, ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import { Plan, SubscriptionStatus } from '@prisma/client';
import { PaymentEventsService } from '../events/payment-events.service';
import { PaypalError, PaypalService } from '../paypal/paypal.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseCustomId, PaypalCheckoutService } from './paypal-checkout.service';

const completed = (customId: string, value = '12.99') => ({
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

  it('el monto lo fija el servidor: precio del plan, o la diferencia si cambia de plan', async () => {
    await service.createOrder('7', Plan.ESTANDAR);
    expect(paypal.createOrder).toHaveBeenCalledWith(12.99, expect.stringContaining('ESTANDAR'), '7:ESTANDAR');

    prisma.subscription.findFirst.mockResolvedValue({ id: 1n, plan: Plan.BASICO });
    const change = await service.createOrder('7', Plan.PREMIUM);
    expect(change).toMatchObject({ mode: 'change', amount: 10 });
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
    expect(data.payments.create).toMatchObject({ amount: 12.99, provider: 'PAYPAL', externalId: 'ORDER1' });
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

  it('custom_id inválido o de un plan desconocido no se acepta', () => {
    expect(parseCustomId('7:PREMIUM')).toEqual({ accountId: '7', plan: 'PREMIUM' });
    expect(parseCustomId('7:ORO')).toBeNull();
    expect(parseCustomId(undefined)).toBeNull();
  });
});
