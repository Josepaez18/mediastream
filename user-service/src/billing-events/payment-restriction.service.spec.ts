import { NotFoundException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PaymentRestrictionService } from './payment-restriction.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Acción compensatoria del Saga (sección 4.3): cada payment.failed restringe
 * la cuenta de forma progresiva en vez de cancelarla de inmediato.
 */
describe('PaymentRestrictionService', () => {
  let account: { id: bigint; failedPaymentAttempts: number; status: AccountStatus } | null;
  let prisma: { account: { findUnique: jest.Mock; update: jest.Mock } };
  let service: PaymentRestrictionService;

  beforeEach(() => {
    account = { id: 7n, failedPaymentAttempts: 0, status: AccountStatus.ACTIVA };
    prisma = {
      account: {
        findUnique: jest.fn(async () => (account ? { ...account } : null)),
        update: jest.fn(async ({ data }) => {
          Object.assign(account as object, data);
          return { ...account };
        }),
      },
    };
    service = new PaymentRestrictionService(prisma as unknown as PrismaService);
  });

  it('1er y 2do pago fallido: la cuenta queda MOROSA', async () => {
    expect(await service.registerFailedPayment('7')).toEqual({
      accountId: '7',
      attempts: 1,
      status: AccountStatus.MOROSA,
    });
    expect((await service.registerFailedPayment('7')).status).toBe(AccountStatus.MOROSA);
  });

  it('3er pago fallido: la cuenta queda SUSPENDIDA', async () => {
    await service.registerFailedPayment('7');
    await service.registerFailedPayment('7');
    const third = await service.registerFailedPayment('7');
    expect(third).toEqual({ accountId: '7', attempts: 3, status: AccountStatus.SUSPENDIDA });
    expect(prisma.account.update).toHaveBeenLastCalledWith({
      where: { id: 7n },
      data: { failedPaymentAttempts: 3, status: AccountStatus.SUSPENDIDA },
    });
  });

  it('una cuenta que no existe responde 404', async () => {
    account = null;
    await expect(service.registerFailedPayment('999')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });
});
