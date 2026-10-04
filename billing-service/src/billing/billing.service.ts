import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Plan, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { PaymentEventsService } from '../events/payment-events.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { WebhookDto, WebhookEventType } from './dto/webhook.dto';
import { PLAN_PRICES } from './plans';

export interface BillingResult {
  httpStatus: number;
  body: unknown;
}

// Las respuestas traen los pagos del más reciente al más antiguo, igual que
// el historial: payments[0] es siempre el último cobro.
const PAYMENTS_NEWEST_FIRST = { payments: { orderBy: { id: 'desc' as const } } };

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly paymentEvents: PaymentEventsService,
  ) {}

  // POST /api/billing/subscribe (documento, sección 4.3, paso 2 del Saga de
  // suscripción): Billing-Service procesa el cobro inicial con la pasarela.
  async subscribe(dto: SubscribeDto): Promise<BillingResult> {
    const accountId = BigInt(dto.accountId);

    const existing = await this.prisma.subscription.findFirst({
      where: { accountId, status: SubscriptionStatus.ACTIVA },
    });
    if (existing) {
      throw new ConflictException('Esta cuenta ya tiene una suscripción activa.');
    }

    const amount = PLAN_PRICES[dto.plan];
    const outcome = await this.stripe.charge(dto.cardNumber, amount);

    const subscription = await this.prisma.subscription.create({
      data: {
        accountId,
        plan: dto.plan,
        status: this.statusFromOutcome(outcome),
        nextBillingDate: addOneMonth(new Date()),
        payments: {
          create: {
            amount,
            status: outcome,
            paidAt: outcome === PaymentStatus.EXITOSO ? new Date() : null,
          },
        },
      },
      include: PAYMENTS_NEWEST_FIRST,
    });

    return this.respond(outcome, dto.accountId, subscription, dto.plan);
  }

  // PUT /api/billing/plan: cambia el plan de una suscripción activa y cobra
  // (de forma síncrona) la diferencia a mitad de ciclo.
  async changePlan(dto: ChangePlanDto): Promise<BillingResult> {
    const accountId = BigInt(dto.accountId);
    const subscription = await this.prisma.subscription.findFirst({
      where: { accountId, status: SubscriptionStatus.ACTIVA },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new NotFoundException('No hay una suscripción activa para esta cuenta.');
    }
    if (subscription.plan === dto.newPlan) {
      throw new ConflictException('La cuenta ya está en ese plan.');
    }

    const oldPrice = PLAN_PRICES[subscription.plan as Plan];
    const newPrice = PLAN_PRICES[dto.newPlan];
    // Prorrateo simplificado para la demo: se cobra la diferencia entre
    // planes en vez de calcular los días exactos restantes del ciclo de
    // facturación (proración real de un sistema de facturación productivo).
    const proratedAmount = Number(Math.abs(newPrice - oldPrice).toFixed(2)) || newPrice;

    const outcome = await this.stripe.charge(dto.cardNumber, proratedAmount);

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        plan: outcome === PaymentStatus.EXITOSO ? dto.newPlan : subscription.plan,
        status: this.statusFromOutcome(outcome),
        payments: {
          create: {
            amount: proratedAmount,
            status: outcome,
            paidAt: outcome === PaymentStatus.EXITOSO ? new Date() : null,
          },
        },
      },
      include: PAYMENTS_NEWEST_FIRST,
    });

    return this.respond(outcome, dto.accountId, updated, updated.plan);
  }

  // POST /api/billing/cancel: cancela la suscripción activa. La cuenta vuelve
  // al plan GRATIS cuando User-Service procesa subscription.canceled.
  async cancel(accountIdRaw: string) {
    const accountId = BigInt(accountIdRaw);
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        accountId,
        status: { in: [SubscriptionStatus.ACTIVA, SubscriptionStatus.PAGO_FALLIDO, SubscriptionStatus.PAGO_PENDIENTE] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new NotFoundException('No hay una suscripción vigente para esta cuenta.');
    }
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.CANCELADA },
      include: PAYMENTS_NEWEST_FIRST,
    });
    await this.paymentEvents.publishSubscriptionCanceled(accountIdRaw);
    return updated;
  }

  // GET /api/billing/admin/overview: todas las suscripciones con su último
  // pago, más los totales para el panel de administración.
  async adminOverview() {
    const subscriptions = await this.prisma.subscription.findMany({
      include: { payments: { orderBy: { id: 'desc' as const } } },
      orderBy: { createdAt: 'desc' },
    });
    const byPlan: Record<string, number> = { BASICO: 0, ESTANDAR: 0, PREMIUM: 0 };
    let revenue = 0;
    for (const sub of subscriptions) {
      if (sub.status === SubscriptionStatus.ACTIVA) byPlan[sub.plan] += 1;
      for (const p of sub.payments) if (p.status === PaymentStatus.EXITOSO) revenue += p.amount;
    }
    return {
      totals: {
        subscriptions: subscriptions.length,
        active: Object.values(byPlan).reduce((a, b) => a + b, 0),
        activeByPlan: byPlan,
        revenue: Number(revenue.toFixed(2)),
        monthlyRecurring: Number(
          Object.entries(byPlan)
            .reduce((sum, [plan, n]) => sum + n * PLAN_PRICES[plan as Plan], 0)
            .toFixed(2),
        ),
      },
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id.toString(),
        accountId: sub.accountId.toString(),
        plan: sub.plan,
        status: sub.status,
        nextBillingDate: sub.nextBillingDate,
        createdAt: sub.createdAt,
        lastPayment: sub.payments[0] ?? null,
      })),
    };
  }

  // GET /api/billing/history/{account_id}
  async history(accountIdRaw: string) {
    if (!/^\d+$/.test(accountIdRaw)) {
      throw new BadRequestException(
        'El ID de cuenta debe ser numérico (el mismo ID de la cuenta en User-Service).',
      );
    }
    const accountId = BigInt(accountIdRaw);
    return this.prisma.subscription.findMany({
      where: { accountId },
      include: PAYMENTS_NEWEST_FIRST,
      orderBy: { createdAt: 'desc' },
    });
  }

  // POST /api/billing/webhook: notificación entrante de la pasarela de pago
  // sobre un cobro cuyo resultado se conoce después (por ejemplo, una
  // renovación). Por convención de webhooks, siempre se responde 200 al
  // recibirlo (el controlador fuerza ese código): ese 200 confirma que el
  // aviso fue procesado, no que el cobro haya sido exitoso.
  async handleWebhook(dto: WebhookDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: BigInt(dto.subscriptionId) },
    });
    if (!subscription) {
      throw new NotFoundException('La suscripción no existe.');
    }

    const amount = PLAN_PRICES[subscription.plan as Plan];

    if (dto.eventType === WebhookEventType.PAYMENT_SUCCEEDED) {
      const updated = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVA,
          nextBillingDate: addOneMonth(new Date()),
          payments: { create: { amount, status: PaymentStatus.EXITOSO, paidAt: new Date() } },
        },
        include: PAYMENTS_NEWEST_FIRST,
      });
      await this.paymentEvents.publishSubscriptionActivated(
        subscription.accountId.toString(),
        subscription.plan,
      );
      return updated;
    }

    // payment_failed: acción local (patrón Saga) + evento asíncrono hacia
    // User-Service (sección 4.3 del documento).
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.PAGO_FALLIDO,
        payments: { create: { amount, status: PaymentStatus.FALLIDO, paidAt: null } },
      },
      include: PAYMENTS_NEWEST_FIRST,
    });

    await this.paymentEvents.publishPaymentFailed(subscription.accountId.toString());

    return updated;
  }

  private statusFromOutcome(outcome: PaymentStatus): SubscriptionStatus {
    if (outcome === PaymentStatus.EXITOSO) return SubscriptionStatus.ACTIVA;
    if (outcome === PaymentStatus.FALLIDO) return SubscriptionStatus.PAGO_FALLIDO;
    return SubscriptionStatus.PAGO_PENDIENTE;
  }

  // Traduce el resultado del cobro síncrono a una respuesta HTTP, siguiendo
  // el diagrama de secuencia de la sección 4.8 del documento:
  //   pago exitoso  -> 201 Created
  //   pago rechazado -> 402 Payment Required + evento payment.failed (Saga)
  //   sin respuesta  -> 202 Accepted (pendiente de confirmación, no es error)
  private async respond(
    outcome: PaymentStatus,
    accountId: string,
    subscription: unknown,
    plan: Plan,
  ): Promise<BillingResult> {
    if (outcome === PaymentStatus.FALLIDO) {
      await this.paymentEvents.publishPaymentFailed(accountId);
      throw new HttpException(
        { message: 'El cobro fue rechazado por la pasarela de pago.', subscription },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    if (outcome === PaymentStatus.EXITOSO) {
      // El plan de la cuenta lo actualiza User-Service al recibir este evento.
      await this.paymentEvents.publishSubscriptionActivated(accountId, plan);
    }

    const httpStatus =
      outcome === PaymentStatus.EXITOSO ? HttpStatus.CREATED : HttpStatus.ACCEPTED;
    return { httpStatus, body: subscription };
  }
}
