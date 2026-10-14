import { ForbiddenException } from '@nestjs/common';
import { assertOwnAccount } from './billing.controller';

const req = (headers: Record<string, string>) => ({ headers }) as any;

describe('assertOwnAccount', () => {
  it('detrás del Gateway, solo deja operar sobre la propia cuenta', () => {
    expect(() => assertOwnAccount(req({ 'x-account-id': '3' }), '3')).not.toThrow();
    expect(() => assertOwnAccount(req({ 'x-account-id': '3' }), '4')).toThrow(ForbiddenException);
  });

  it('el administrador puede operar sobre cualquier cuenta', () => {
    expect(() =>
      assertOwnAccount(req({ 'x-account-id': '1', 'x-account-role': 'ADMIN' }), '4'),
    ).not.toThrow();
  });

  it('sin cabeceras del Gateway (llamada directa en desarrollo) no aplica', () => {
    expect(() => assertOwnAccount(req({}), '4')).not.toThrow();
  });
});

describe('assertSimulatedPaymentAllowed (solo PayPal para los usuarios)', () => {
  const { assertSimulatedPaymentAllowed } = jest.requireActual('./billing.controller');
  const req2 = (headers: Record<string, string>) => ({ headers }) as any;

  it('un usuario detrás del Gateway no puede pagar con tarjeta simulada ni usar el webhook', () => {
    expect(() => assertSimulatedPaymentAllowed(req2({ 'x-account-id': '3', 'x-account-role': 'USER' }))).toThrow(
      ForbiddenException,
    );
  });

  it('el administrador y las llamadas directas (scripts) sí', () => {
    expect(() => assertSimulatedPaymentAllowed(req2({ 'x-account-id': '1', 'x-account-role': 'ADMIN' }))).not.toThrow();
    expect(() => assertSimulatedPaymentAllowed(req2({}))).not.toThrow();
  });
});
