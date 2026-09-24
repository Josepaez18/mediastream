import { MediaEventsConsumer, extractTitleId } from './media-events.consumer';

// Fija el contrato del evento entre Media-Processing-Service (publicador,
// Python) y Catalog-Service (consumidor). Si alguno de los dos cambia el
// formato, este test lo detecta antes de llegar a la demo.
describe('MediaEventsConsumer', () => {
  const buildMessage = (routingKey: string, body: unknown, redelivered = false) =>
    ({
      content: Buffer.from(JSON.stringify(body)),
      fields: { routingKey, redelivered },
    }) as any;

  let catalogService: {
    markTitleAsAvailable: jest.Mock;
    markTitleAsUnavailable: jest.Mock;
  };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let consumer: MediaEventsConsumer;

  beforeEach(() => {
    catalogService = {
      markTitleAsAvailable: jest.fn().mockResolvedValue(undefined),
      markTitleAsUnavailable: jest.fn().mockResolvedValue(undefined),
    };
    channel = { ack: jest.fn(), nack: jest.fn() };
    consumer = new MediaEventsConsumer(catalogService as any);
    (consumer as any).channel = channel;
  });

  describe('extractTitleId', () => {
    it('acepta title_id (formato de Media-Processing-Service)', () => {
      expect(extractTitleId({ title_id: '7' })).toBe(7n);
    });

    it('acepta titleId (formato del script de simulación)', () => {
      expect(extractTitleId({ titleId: 3 })).toBe(3n);
    });

    it('falla si el evento no trae ningún id', () => {
      expect(() => extractTitleId({})).toThrow();
    });
  });

  it('media.ready publicado por Media-Processing marca el título como AVAILABLE', async () => {
    const msg = buildMessage('media.ready', {
      title_id: '1',
      job_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      processed_at: '2026-09-22T18:00:00Z',
    });

    await (consumer as any).handleMessage(msg);

    expect(catalogService.markTitleAsAvailable).toHaveBeenCalledWith(1n);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('media.processing.failed marca el título como UNAVAILABLE', async () => {
    const msg = buildMessage('media.processing.failed', { title_id: '1', job_id: 'x' });

    await (consumer as any).handleMessage(msg);

    expect(catalogService.markTitleAsUnavailable).toHaveBeenCalledWith(1n);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('un mensaje sin id se reintenta una vez y luego se descarta', async () => {
    const first = buildMessage('media.ready', { foo: 'bar' }, false);
    await (consumer as any).handleMessage(first);
    expect(channel.nack).toHaveBeenLastCalledWith(first, false, true);

    const retry = buildMessage('media.ready', { foo: 'bar' }, true);
    await (consumer as any).handleMessage(retry);
    expect(channel.nack).toHaveBeenLastCalledWith(retry, false, false);
    expect(catalogService.markTitleAsAvailable).not.toHaveBeenCalled();
  });
});
