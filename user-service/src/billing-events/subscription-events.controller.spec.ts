import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionEventsController } from './subscription-events.controller';

describe('SubscriptionEventsController', () => {
  const channel = { ack: jest.fn() };
  const context: any = { getChannelRef: () => channel, getMessage: () => ({}) };
  let prisma: any;
  let controller: SubscriptionEventsController;

  beforeEach(() => {
    channel.ack.mockReset();
    prisma = { account: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    controller = new SubscriptionEventsController(prisma as PrismaService);
  });

  it('subscription.activated: pone el plan pagado y reactiva la cuenta', async () => {
    await controller.activated({ accountId: '3', plan: 'PREMIUM' }, context);
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { plan: 'PREMIUM', status: 'ACTIVA', failedPaymentAttempts: 0 },
    });
    expect(channel.ack).toHaveBeenCalled();
  });

  it('subscription.canceled: vuelve al plan GRATIS', async () => {
    await controller.canceled({ accountId: '3' }, context);
    expect(prisma.account.updateMany).toHaveBeenCalledWith({ where: { id: 3n }, data: { plan: 'GRATIS' } });
  });

  it('un plan desconocido se descarta sin tocar la cuenta', async () => {
    await controller.activated({ accountId: '3', plan: 'ORO' }, context);
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalled();
  });
});
