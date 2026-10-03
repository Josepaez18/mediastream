/**
 * Lectura tolerante de los eventos que consume Notification-Service
 * (patrón "tolerant reader"): cada publicador usa la convención de su
 * lenguaje y Notification no le impone otra.
 *
 *   media.ready         Media-Processing (Python): { "title_id": "1", "job_id": "…" }
 *   payment.failed      Billing (Nest): { "pattern": "payment.failed", "data": { "accountId": "1", "eventId": "…" } }
 *   playback.completed  Playback (Redis): { "profileId": "1", "titleId": "3", "episodeId": "7" | null }
 */

export interface MediaReadyEvent {
  titleId: string;
  jobId?: string;
}

export interface PaymentFailedEvent {
  accountId: string;
  eventId?: string;
  occurredAt?: string;
}

export interface PlaybackCompletedEvent {
  profileId: string;
  titleId: string;
  episodeId: string | null;
}

const present = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== '';

function required(value: unknown, field: string): string {
  if (!present(value)) throw new Error(`El evento no trae ${field}`);
  return String(value).trim();
}

export function parseMediaReady(payload: any): MediaReadyEvent {
  return {
    titleId: required(payload?.title_id ?? payload?.titleId, 'title_id'),
    jobId: present(payload?.job_id ?? payload?.jobId) ? String(payload.job_id ?? payload.jobId) : undefined,
  };
}

export function parsePaymentFailed(payload: any): PaymentFailedEvent {
  // Formato de Nest ({ pattern, data }) o el objeto plano.
  const data = payload?.data ?? payload;
  return {
    accountId: required(data?.accountId ?? data?.account_id, 'accountId'),
    eventId: present(data?.eventId) ? String(data.eventId) : undefined,
    occurredAt: present(data?.occurredAt) ? String(data.occurredAt) : undefined,
  };
}

export function parsePlaybackCompleted(payload: any): PlaybackCompletedEvent {
  const episode = payload?.episodeId ?? payload?.episode_id;
  return {
    profileId: required(payload?.profileId ?? payload?.profile_id, 'profileId'),
    titleId: required(payload?.titleId ?? payload?.title_id, 'titleId'),
    episodeId: present(episode) ? String(episode) : null,
  };
}
