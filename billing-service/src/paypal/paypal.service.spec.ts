import { Logger } from '@nestjs/common';
import { PaypalError, PaypalService } from './paypal.service';

describe('PaypalService', () => {
  const env = { ...process.env };
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => {
    process.env.PAYPAL_CLIENT_ID = 'client';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    delete process.env.PAYPAL_API_BASE;
    fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'TOKEN', expires_in: 3600 }) };
      return { ok: true, json: async () => ({ id: 'ORDER1', status: 'CREATED' }) };
    });
    global.fetch = fetchMock as any;
  });
  afterEach(() => {
    process.env = { ...env };
    global.fetch = realFetch;
  });

  it('usa el sandbox por defecto y pide el token con las credenciales', async () => {
    const paypal = new PaypalService();
    expect(paypal.mode).toBe('sandbox');
    await paypal.createOrder(12.99, 'Plan', '7:ESTANDAR');
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`);
    const [orderUrl, orderInit] = fetchMock.mock.calls[1];
    expect(orderUrl).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(JSON.parse(orderInit.body).purchase_units[0]).toMatchObject({
      custom_id: '7:ESTANDAR',
      amount: { currency_code: 'USD', value: '12.99' },
    });
  });

  it('reutiliza el token mientras no venza', async () => {
    const paypal = new PaypalService();
    await paypal.getOrder('A');
    await paypal.getOrder('B');
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/oauth2/token'))).toHaveLength(1);
  });

  it('la captura es idempotente (PayPal-Request-Id)', async () => {
    await new PaypalService().captureOrder('ORDER1');
    expect(fetchMock.mock.calls[1][1].headers['PayPal-Request-Id']).toBe('capture-ORDER1');
  });

  it('sin credenciales queda deshabilitado', async () => {
    delete process.env.PAYPAL_CLIENT_SECRET;
    const paypal = new PaypalService();
    expect(paypal.enabled).toBe(false);
    await expect(paypal.createOrder(1, 'x', '1:BASICO')).rejects.toMatchObject({ status: 503 });
  });

  it('traduce los errores de PayPal con su "issue"', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/v1/oauth2/token')
        ? { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
        : { ok: false, status: 422, json: async () => ({ details: [{ issue: 'INSTRUMENT_DECLINED', description: 'declinado' }] }) },
    );
    const err = await new PaypalService().captureOrder('ORDER1').catch((e) => e);
    expect(err).toBeInstanceOf(PaypalError);
    expect(err).toMatchObject({ status: 422, issue: 'INSTRUMENT_DECLINED' });
  });
});
