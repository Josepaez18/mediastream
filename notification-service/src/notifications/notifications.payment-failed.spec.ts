import { CatalogClient } from '../catalog/catalog.client';
import { NotificationsService } from './notifications.service';
import { NotificationsStore } from './notifications.store';

/**
 * payment.failed de un publicador antiguo, sin eventId: Notification no puede
 * deduplicar por evento, así que reserva la clave por cuenta y minuto.
 *
 * Se simulan las dependencias externas: el almacén en Redis
 * (NotificationsStore), Catalog y el reloj (Date.now).
 */
describe('NotificationsService: payment.failed sin eventId', () => {
  // 2027-01-15 08:00:42 UTC → minuto 30000000 desde la época.
  const AHORA = 1_800_000_042_000;
  let store: { claim: jest.Mock; release: jest.Mock; save: jest.Mock; list: jest.Mock };
  let catalog: { getTitle: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(AHORA);
    store = {
      claim: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      release: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
    };
    catalog = { getTitle: jest.fn() };
    service = new NotificationsService(
      store as unknown as NotificationsStore,
      catalog as unknown as CatalogClient,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('dos rechazos de la misma cuenta en el mismo minuto generan un solo aviso, reservado por 7 días', async () => {
    const primero = await service.onPaymentFailed({ accountId: '2' });
    (Date.now as jest.Mock).mockReturnValue(AHORA + 15_000); // 15 s después, mismo minuto
    const segundo = await service.onPaymentFailed({ accountId: '2' });

    expect(store.claim).toHaveBeenCalledTimes(2);
    expect(store.claim).toHaveBeenNthCalledWith(1, 'payment.failed:2:30000000', 24 * 60 * 60);
    expect(store.claim).toHaveBeenNthCalledWith(2, 'payment.failed:2:30000000', 24 * 60 * 60);

    expect(primero).toMatchObject({
      type: 'PAYMENT_FAILED',
      audience: { scope: 'account', id: '2' },
      channels: ['email', 'push'],
      sourceEvent: 'payment.failed',
      data: { accountId: '2', occurredAt: null },
    });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(primero);

    expect(segundo).toBeNull();
    expect(store.release).not.toHaveBeenCalled();
    expect(catalog.getTitle).not.toHaveBeenCalled();
  });
});
