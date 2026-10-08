import { Injectable, Logger } from '@nestjs/common';

export class PaypalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
  ) {
    super(message);
  }
}

export interface PaypalOrder {
  id: string;
  status: string; // CREATED | APPROVED | COMPLETED | ...
  purchase_units?: {
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: { captures?: { id: string; status: string; amount: { value: string } }[] };
  }[];
}

/**
 * Cliente de la API REST de PayPal (Orders v2), en modo sandbox por defecto.
 *
 * Flujo de PayPal Checkout: Billing crea la orden con el monto del plan
 * (calculado en el servidor), el navegador la aprueba en la ventana de PayPal
 * y Billing la captura. Las credenciales (PAYPAL_CLIENT_ID y
 * PAYPAL_CLIENT_SECRET) salen de la app creada en developer.paypal.com; sin
 * ellas PayPal queda deshabilitado y solo funciona la tarjeta simulada.
 */
@Injectable()
export class PaypalService {
  private readonly logger = new Logger(PaypalService.name);
  private token: { value: string; expiresAt: number } | null = null;

  get clientId(): string {
    return process.env.PAYPAL_CLIENT_ID?.trim() ?? '';
  }

  private get secret(): string {
    return process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
  }

  get baseUrl(): string {
    return (process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com').replace(/\/+$/, '');
  }

  get enabled(): boolean {
    return !!this.clientId && !!this.secret;
  }

  get mode(): 'sandbox' | 'live' {
    return this.baseUrl.includes('sandbox') ? 'sandbox' : 'live';
  }

  /** Token OAuth (client credentials); se reutiliza hasta un minuto antes de vencer. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      this.logger.error(`PayPal rechazó las credenciales (HTTP ${res.status}).`);
      throw new PaypalError('No se pudo autenticar con PayPal. Revisa PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET.', 502);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    if (!this.enabled) throw new PaypalError('PayPal no está configurado en este entorno.', 503);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const issue: string | undefined = data?.details?.[0]?.issue;
      this.logger.warn(`PayPal ${method} ${path} → ${res.status} ${issue ?? data?.name ?? ''}`);
      throw new PaypalError(data?.details?.[0]?.description || data?.message || 'PayPal rechazó la operación.', res.status, issue);
    }
    return data as T;
  }

  /** Orden por `amount` USD. custom_id liga la orden a la cuenta y al plan. */
  createOrder(amount: number, description: string, customId: string): Promise<PaypalOrder> {
    return this.request<PaypalOrder>('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          description,
          custom_id: customId,
          amount: { currency_code: 'USD', value: amount.toFixed(2) },
        },
      ],
    });
  }

  getOrder(orderId: string): Promise<PaypalOrder> {
    return this.request<PaypalOrder>('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  /** Captura (cobra) una orden aprobada. PayPal-Request-Id la hace idempotente. */
  captureOrder(orderId: string): Promise<PaypalOrder> {
    return this.request<PaypalOrder>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, {
      'PayPal-Request-Id': `capture-${orderId}`,
      Prefer: 'return=representation',
    });
  }
}
