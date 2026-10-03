import { parseMediaReady, parsePaymentFailed, parsePlaybackCompleted } from './event-payloads';

// Fija los contratos con los publicadores (ver README raíz).
describe('event-payloads', () => {
  it('media.ready: acepta title_id (Python) y titleId', () => {
    expect(parseMediaReady({ title_id: 1, job_id: 'j' })).toEqual({ titleId: '1', jobId: 'j' });
    expect(parseMediaReady({ titleId: '4' })).toEqual({ titleId: '4', jobId: undefined });
    expect(() => parseMediaReady({ job_id: 'j' })).toThrow('title_id');
  });

  it('payment.failed: lee el formato de Nest que publica Billing y el objeto plano', () => {
    expect(
      parsePaymentFailed({ pattern: 'payment.failed', data: { accountId: '2', eventId: 'e-1' } }),
    ).toMatchObject({ accountId: '2', eventId: 'e-1' });
    expect(parsePaymentFailed({ accountId: 7 })).toMatchObject({ accountId: '7', eventId: undefined });
    expect(() => parsePaymentFailed({ pattern: 'payment.failed', data: {} })).toThrow('accountId');
  });

  it('playback.completed: episodeId null para películas', () => {
    expect(parsePlaybackCompleted({ profileId: '1', titleId: 3, episodeId: null })).toEqual({
      profileId: '1',
      titleId: '3',
      episodeId: null,
    });
    expect(parsePlaybackCompleted({ profileId: '1', titleId: '3', episodeId: 9 }).episodeId).toBe('9');
  });
});
