import { CatalogClient, CatalogTitle } from '../catalog/catalog.client';
import { Audience, Notification } from './notification.types';
import { feedKey, NotificationsStore } from './notifications.store';
import { NotificationsService } from './notifications.service';

// Almacén en memoria con la misma interfaz que el de Redis.
class InMemoryStore {
  claimed = new Set<string>();
  feeds = new Map<string, Notification[]>();

  async claim(key: string) {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
  async release(key: string) {
    this.claimed.delete(key);
  }
  async save(n: Notification) {
    const key = feedKey(n.audience);
    this.feeds.set(key, [n, ...(this.feeds.get(key) ?? [])]);
  }
  async list(audiences: Audience[], limit: number) {
    return audiences
      .flatMap((a) => this.feeds.get(feedKey(a)) ?? [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

const SERIES: CatalogTitle = {
  id: '3',
  name: 'Mareas',
  type: 'SERIES',
  seasons: [
    { seasonNumber: 2, episodes: [{ id: '21', episodeNumber: 1 }] },
    {
      seasonNumber: 1,
      episodes: [
        { id: '12', episodeNumber: 2 },
        { id: '11', episodeNumber: 1 },
      ],
    },
  ],
};

describe('NotificationsService', () => {
  let store: InMemoryStore;
  let catalog: { getTitle: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    store = new InMemoryStore();
    catalog = { getTitle: jest.fn().mockResolvedValue(SERIES) };
    service = new NotificationsService(
      store as unknown as NotificationsStore,
      catalog as unknown as CatalogClient,
    );
  });

  describe('media.ready', () => {
    it('anuncia el estreno a todos los perfiles con el nombre que da Catalog', async () => {
      const n = await service.onMediaReady({ titleId: '3', jobId: 'job-1' });

      expect(n).toMatchObject({ type: 'NEW_RELEASE', audience: { scope: 'broadcast' } });
      expect(n?.title).toContain('Mareas');
      expect(await service.history('99', undefined, 10)).toHaveLength(1);
    });

    it('no repite el aviso si RabbitMQ reentrega el evento', async () => {
      await service.onMediaReady({ titleId: '3' });
      expect(await service.onMediaReady({ titleId: '3' })).toBeNull();
      expect(store.feeds.get('notifications:broadcast')).toHaveLength(1);
    });

    it('si Catalog está caído, avisa igual con un texto genérico', async () => {
      catalog.getTitle.mockResolvedValue(null);
      const n = await service.onMediaReady({ titleId: '8' });
      expect(n?.title).toBe('Nuevo estreno: Título #8');
    });
  });

  describe('payment.failed', () => {
    it('avisa a la cuenta por correo y push, una vez por eventId', async () => {
      const n = await service.onPaymentFailed({ accountId: '2', eventId: 'e-1' });
      expect(n).toMatchObject({
        type: 'PAYMENT_FAILED',
        audience: { scope: 'account', id: '2' },
        channels: ['email', 'push'],
      });
      expect(await service.onPaymentFailed({ accountId: '2', eventId: 'e-1' })).toBeNull();
      // Un segundo rechazo real (otro eventId) sí genera otro aviso.
      expect(await service.onPaymentFailed({ accountId: '2', eventId: 'e-2' })).not.toBeNull();
    });

    it('el historial de un perfil solo incluye los avisos de su cuenta si se indica', async () => {
      await service.onPaymentFailed({ accountId: '2', eventId: 'e-1' });
      expect(await service.history('5', undefined, 10)).toHaveLength(0);
      expect(await service.history('5', '2', 10)).toHaveLength(1);
    });
  });

  describe('playback.completed', () => {
    it('al terminar un episodio sugiere el siguiente, cruzando de temporada', async () => {
      const n = await service.onPlaybackCompleted({ profileId: '1', titleId: '3', episodeId: '12' });
      expect(n).toMatchObject({ type: 'CONTINUE_WATCHING', audience: { scope: 'profile', id: '1' } });
      expect(n?.message).toBe('Ya puedes ver la temporada 2, episodio 1.');
    });

    it('no avisa al terminar una película ni el último episodio', async () => {
      expect(await service.onPlaybackCompleted({ profileId: '1', titleId: '3', episodeId: null })).toBeNull();
      expect(await service.onPlaybackCompleted({ profileId: '1', titleId: '3', episodeId: '21' })).toBeNull();
      expect(catalog.getTitle).toHaveBeenCalledTimes(1);
    });

    it('si Catalog no respondió, un evento posterior se vuelve a evaluar', async () => {
      catalog.getTitle.mockResolvedValueOnce(null);
      expect(await service.onPlaybackCompleted({ profileId: '1', titleId: '3', episodeId: '11' })).toBeNull();
      expect(await service.onPlaybackCompleted({ profileId: '1', titleId: '3', episodeId: '11' })).not.toBeNull();
    });
  });

  it('si falla el guardado, libera la reserva para que el reintento lo envíe', async () => {
    jest.spyOn(store, 'save').mockRejectedValueOnce(new Error('Redis caído'));
    await expect(service.onMediaReady({ titleId: '3' })).rejects.toThrow('Redis caído');
    expect(await service.onMediaReady({ titleId: '3' })).not.toBeNull();
  });
});
