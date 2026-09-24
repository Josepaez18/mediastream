import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentStatus, Plan, SubscriptionStatus } from '@prisma/client';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { PaymentEventsService } from '../events/payment-events.service';
import { WebhookEventType } from './dto/webhook.dto';

describe('BillingService', () => {
  let prisma: {
    subscription: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let stripe: { charge: jest.Mock };
  let events: { publishPaymentFailed: jest.Mock };
  let service: BillingService;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    prisma = {
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }) => ({ id: 1n, ...data })),
        update: jest.fn(async ({ data }) => ({ id: 1n, ...data })),
      },
    };
    stripe = { charge: jest.fn() };
    events = { publishPaymentFailed: jest.fn().mockResolvedValue(undefined) };
    service = new BillingService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      events as unknown as PaymentEventsService,
    );
  });

  const subscribe = (cardNumber = '4242424242424242') =>
    service.subscribe({ accountId: '7', plan: Plan.ESTANDAR, cardNumber });

  describe('subscribe (Saga, sección 4.3)', () => {
    it('pago exitoso → 201 y suscripción ACTIVA', async () => {
      stripe.charge.mockResolvedValue(PaymentStatus.EXITOSO);
      const result = await subscribe();
      expect(result.httpStatus).toBe(HttpStatus.CREATED);
      expect(prisma.subscription.create.mock.calls[0][0].data.status).toBe(
        SubscriptionStatus.ACTIVA,
      );
      expect(events.publishPaymentFailed).not.toHaveBeenCalled();
    });

    it('pago rechazado → 402 y publica payment.failed para User-Service', async () => {
      stripe.charge.mockResolvedValue(PaymentStatus.FALLIDO);
      const err = await subscribe('4000000000000002').catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      expect(events.publishPaymentFailed).toHaveBeenCalledWith('7');
      // La transacción local (el pago fallido) se guarda ANTES de publicar el evento.
      expect(prisma.subscription.create.mock.calls[0][0].data.status).toBe(
        SubscriptionStatus.PAGO_FALLIDO,
      );
    });

    it('pasarela sin respuesta → 202 y pago PENDIENTE, no rechazo (sección 4.5)', async () => {
      stripe.charge.mockResolvedValue(PaymentStatus.PENDIENTE);
      const result = await subscribe('1111');
      expect(result.httpStatus).toBe(HttpStatus.ACCEPTED);
      expect(events.publishPaymentFailed).not.toHaveBeenCalled();
    });

    it('una cuenta con suscripción activa no puede suscribirse otra vez (409)', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 1n, status: SubscriptionStatus.ACTIVA });
      await expect(subscribe()).rejects.toBeInstanceOf(ConflictException);
      expect(stripe.charge).not.toHaveBeenCalled();
    });
  });

  it('history rechaza un ID de cuenta no numérico (400)', async () => {
    await expect(service.history('abc')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('webhook payment_failed marca la suscripción y publica payment.failed', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 3n,
      accountId: 7n,
      plan: Plan.BASICO,
      status: SubscriptionStatus.ACTIVA,
    });
    await service.handleWebhook({
      subscriptionId: '3',
      eventType: WebhookEventType.PAYMENT_FAILED,
    } as any);
    expect(prisma.subscription.update.mock.calls[0][0].data.status).toBe(
      SubscriptionStatus.PAGO_FALLIDO,
    );
    expect(events.publishPaymentFailed).toHaveBeenCalledWith('7');
  });
});
