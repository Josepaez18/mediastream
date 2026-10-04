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
