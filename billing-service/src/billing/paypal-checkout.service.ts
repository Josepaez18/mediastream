import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PaymentStatus, Plan, Prisma, SubscriptionStatus } from '@prisma/client';
import { PaymentEventsService } from '../events/payment-events.service';
import { PaypalError, PaypalOrder, PaypalService } from '../paypal/paypal.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingResult } from './billing.service';
import { PLAN_PRICES } from './plans';

const PAYMENTS_NEWEST_FIRST = { payments: { orderBy: { id: 'desc' as const } } };

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

/** custom_id de la orden: "<accountId>:<plan>" (lo fija el servidor al crearla). */
export function parseCustomId(customId: string | undefined): { accountId: string; plan: Plan } | null {
  const [accountId, plan] = (customId ?? '').split(':');
  if (!/^\d+$/.test(accountId ?? '') || !(plan in PLAN_PRICES)) return null;
  return { accountId, plan: plan as Plan };
}

/**
 * Pago con PayPal Checkout (sandbox). Mismo resultado que el cobro con
 * tarjeta simulada: la suscripción queda ACTIVA y se publica
 * subscription.activated para que User-Service cambie el plan de la cuenta.
 *
 * Reglas de seguridad:
 *  · el monto lo calcula SIEMPRE el servidor (precio del plan, o la diferencia
 *    si se cambia de plan); el navegador solo aprueba la orden;
 *  · al capturar se comprueba que la orden sea de esa cuenta (custom_id);
 *  · el id de la orden se guarda como external_id único del pago: una misma
 *    orden nunca activa dos veces, aunque el navegador reintente.
 */
@Injectable()
export class PaypalCheckoutService {
  private readonly logger = new Logger(PaypalCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypal: PaypalService,
    private readonly events: PaymentEventsService,
  ) {}

  config() {
    return { enabled: this.paypal.enabled, clientId: this.paypal.clientId || null, currency: 'USD', mode: this.paypal.mode };
  }

  /** Monto a cobrar: precio completo, o la diferencia si ya tiene un plan activo. */
  async quote(accountId: bigint, plan: Plan) {
    const active = await this.prisma.subscription.findFirst({
      where: { accountId, status: SubscriptionStatus.ACTIVA },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) return { mode: 'subscribe' as const, amount: PLAN_PRICES[plan] };
    if (active.plan === plan) throw new ConflictException('La cuenta ya está en ese plan.');
    const diff = Number(Math.abs(PLAN_PRICES[plan] - PLAN_PRICES[active.plan as Plan]).toFixed(2));
    return { mode: 'change' as const, amount: diff || PLAN_PRICES[plan] };
  }

  async createOrder(accountIdRaw: string, plan: Plan) {
    const { mode, amount } = await this.quote(BigInt(accountIdRaw), plan);
    const description = `MediaStream · Plan ${plan}${mode === 'change' ? ' (cambio de plan)' : ''}`;
    const order = await this.call(() => this.paypal.createOrder(amount, description, `${accountIdRaw}:${plan}`));
    this.logger.log(`Orden PayPal ${order.id} creada: cuenta ${accountIdRaw}, ${plan}, ${amount} USD`);
    return { orderId: order.id, amount, mode };
  }

  async capture(orderId: string, accountIdRaw: string): Promise<BillingResult> {
    // Ya aplicada (reintento del navegador): se devuelve lo mismo, sin cobrar ni activar otra vez.
    const already = await this.findApplied(orderId);
    if (already) return { httpStatus: HttpStatus.OK, body: already };

    const order = await this.call(() => this.paypal.getOrder(orderId));
    const owner = parseCustomId(order.purchase_units?.[0]?.custom_id);
    if (!owner) throw new BadRequestException('La orden de PayPal no es de MediaStream.');
    if (owner.accountId !== accountIdRaw) throw new ForbiddenException('La orden de PayPal es de otra cuenta.');

    let captured: PaypalOrder;
    try {
      captured = order.status === 'COMPLETED' ? order : await this.paypal.captureOrder(orderId);
    } catch (err) {
      if (err instanceof PaypalError && err.issue === 'INSTRUMENT_DECLINED') {
        throw new HttpException(
          { message: 'PayPal rechazó el medio de pago. Elige otro en la ventana de PayPal.', code: 'PAYPAL_DECLINED' },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      if (err instanceof PaypalError && err.issue === 'ORDER_ALREADY_CAPTURED') {
        captured = await this.call(() => this.paypal.getOrder(orderId));
      } else {
        throw this.toHttp(err);
      }
    }

    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
    if (captured.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
      return {
        httpStatus: HttpStatus.ACCEPTED,
        body: { message: 'PayPal dejó el pago pendiente de revisión. El plan se activará cuando se confirme.', status: capture?.status ?? captured.status },
      };
    }

    const amount = Number(capture.amount.value);
    const accountId = BigInt(owner.accountId);
    const payment = {
      amount,
      status: PaymentStatus.EXITOSO,
      paidAt: new Date(),
      provider: 'PAYPAL',
      externalId: orderId,
    };

    let subscription;
    try {
      const active = await this.prisma.subscription.findFirst({
        where: { accountId, status: SubscriptionStatus.ACTIVA },
        orderBy: { createdAt: 'desc' },
      });
      subscription = active
        ? await this.prisma.subscription.update({
            where: { id: active.id },
            data: { plan: owner.plan, payments: { create: payment } },
            include: PAYMENTS_NEWEST_FIRST,
          })
        : await this.prisma.subscription.create({
            data: {
              accountId,
              plan: owner.plan,
              status: SubscriptionStatus.ACTIVA,
              nextBillingDate: addOneMonth(new Date()),
              payments: { create: payment },
            },
            include: PAYMENTS_NEWEST_FIRST,
          });
    } catch (err) {
      // Otra petición aplicó la misma orden al mismo tiempo (external_id único).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { httpStatus: HttpStatus.OK, body: await this.findApplied(orderId) };
      }
      throw err;
    }

    this.logger.log(`Orden PayPal ${orderId} capturada: cuenta ${owner.accountId} → plan ${owner.plan} (${amount} USD)`);
    await this.events.publishSubscriptionActivated(owner.accountId, owner.plan);
    return { httpStatus: HttpStatus.CREATED, body: subscription };
  }

  private async findApplied(orderId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { externalId: orderId } });
    if (!payment) return null;
    return this.prisma.subscription.findUnique({ where: { id: payment.subscriptionId }, include: PAYMENTS_NEWEST_FIRST });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  private toHttp(err: unknown): HttpException {
    if (err instanceof HttpException) return err;
    if (err instanceof PaypalError) {
      const status = err.status === 503 ? HttpStatus.SERVICE_UNAVAILABLE : err.status === 404 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY;
      return new HttpException({ message: err.message, code: err.issue ?? 'PAYPAL_ERROR' }, status);
    }
    return new HttpException({ message: 'No se pudo comunicar con PayPal.', code: 'PAYPAL_ERROR' }, HttpStatus.BAD_GATEWAY);
  }
}
