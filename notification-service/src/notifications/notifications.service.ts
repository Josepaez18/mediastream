import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CatalogClient, findNextEpisode } from '../catalog/catalog.client';
import {
  MediaReadyEvent,
  PaymentFailedEvent,
  PlaybackCompletedEvent,
} from '../events/event-payloads';
import { Audience, Channel, Notification, NotificationType } from './notification.types';
import { NotificationsStore } from './notifications.store';

const DAY = 24 * 60 * 60;

interface Draft {
  dedupKey: string;
  dedupTtlSeconds: number;
  type: NotificationType;
  audience: Audience;
  channels: Channel[];
  sourceEvent: string;
  build: () => Promise<Pick<Notification, 'title' | 'message' | 'data'> | null>;
}

/**
 * Traduce eventos de otros servicios en notificaciones para el usuario
 * (sección 3 del documento). No tiene lógica de negocio propia: no decide
 * si un pago falló ni si un título está disponible, solo avisa de lo que
 * otro servicio ya decidió.
 *
 * El envío por correo y push está simulado: cada canal deja una línea JSON
 * en el log, que es donde se conectaría el proveedor real (SES, FCM, …).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly store: NotificationsStore,
    private readonly catalog: CatalogClient,
  ) {}

  /** media.ready → "Nuevo estreno", para todos los perfiles. Una sola vez por título. */
  onMediaReady(event: MediaReadyEvent): Promise<Notification | null> {
    return this.deliver({
      dedupKey: `media.ready:${event.titleId}`,
      dedupTtlSeconds: 30 * DAY,
      type: 'NEW_RELEASE',
      audience: { scope: 'broadcast' },
      channels: ['push'],
      sourceEvent: 'media.ready',
      build: async () => {
        const title = await this.catalog.getTitle(event.titleId);
        const name = title?.name ?? `Título #${event.titleId}`;
        return {
          title: `Nuevo estreno: ${name}`,
          message: `${name} ya está disponible para ver en MediaStream.`,
          data: { titleId: event.titleId, jobId: event.jobId ?? null },
        };
      },
    });
  }

  /** payment.failed → aviso a la cuenta. Uno por evento (eventId), aunque RabbitMQ lo reentregue. */
  onPaymentFailed(event: PaymentFailedEvent): Promise<Notification | null> {
    // Sin eventId (publicadores antiguos), se deduplica por minuto.
    const eventKey = event.eventId ?? `${event.accountId}:${Math.floor(Date.now() / 60000)}`;
    return this.deliver({
      dedupKey: `payment.failed:${eventKey}`,
      dedupTtlSeconds: 7 * DAY,
      type: 'PAYMENT_FAILED',
      audience: { scope: 'account', id: event.accountId },
      channels: ['email', 'push'],
      sourceEvent: 'payment.failed',
      build: async () => ({
        title: 'No pudimos procesar tu pago',
        message:
          'El cobro de tu suscripción fue rechazado. Actualiza tu medio de pago para no perder el acceso a MediaStream.',
        data: { accountId: event.accountId, occurredAt: event.occurredAt ?? null },
      }),
    });
  }

  /**
   * playback.completed de un episodio → "sigue con el siguiente". Las
   * películas y el último episodio de una serie no generan aviso.
   */
  onPlaybackCompleted(event: PlaybackCompletedEvent): Promise<Notification | null> {
    const episodeId = event.episodeId;
    if (!episodeId) return Promise.resolve(null);

    return this.deliver({
      dedupKey: `playback.completed:${event.profileId}:${episodeId}`,
      dedupTtlSeconds: 7 * DAY,
      type: 'CONTINUE_WATCHING',
      audience: { scope: 'profile', id: event.profileId },
      channels: ['push'],
      sourceEvent: 'playback.completed',
      build: async () => {
        const title = await this.catalog.getTitle(event.titleId);
        const next = title ? findNextEpisode(title, episodeId) : null;
        if (!title || !next) return null;
        return {
          title: `Sigue viendo ${title.name}`,
          message: `Ya puedes ver la temporada ${next.seasonNumber}, episodio ${next.episodeNumber}.`,
          data: { titleId: event.titleId, nextEpisodeId: next.id },
        };
      },
    });
  }

  /**
   * Historial de un perfil: sus avisos, los estrenos (broadcast) y, si se
   * indica la cuenta, los avisos de la cuenta (pagos).
   */
  history(profileId: string, accountId: string | undefined, limit: number): Promise<Notification[]> {
    const audiences: Audience[] = [{ scope: 'profile', id: profileId }, { scope: 'broadcast' }];
    if (accountId) audiences.push({ scope: 'account', id: accountId });
    return this.store.list(audiences, limit);
  }

  private async deliver(draft: Draft): Promise<Notification | null> {
    if (!(await this.store.claim(draft.dedupKey, draft.dedupTtlSeconds))) {
      this.logger.log(`Notificación duplicada omitida (${draft.dedupKey})`);
      return null;
    }

    try {
      const content = await draft.build();
      if (!content) {
        // No había nada que avisar (o Catalog no respondió): se libera la
        // reserva para que un evento posterior se vuelva a evaluar.
        await this.store.release(draft.dedupKey);
        return null;
      }

      const notification: Notification = {
        id: uuidv4(),
        type: draft.type,
        audience: draft.audience,
        channels: draft.channels,
        sourceEvent: draft.sourceEvent,
        createdAt: new Date().toISOString(),
        ...content,
      };
      await this.store.save(notification);
      for (const channel of notification.channels) {
        this.logger.log(
          JSON.stringify({
            level: 'info',
            service: 'notification-service',
            event: 'notification.sent',
            channel,
            notificationId: notification.id,
            type: notification.type,
            audience: notification.audience,
            title: notification.title,
          }),
        );
      }
      return notification;
    } catch (err) {
      // Se libera la reserva para que el reintento de RabbitMQ sí la envíe.
      await this.store.release(draft.dedupKey).catch(() => undefined);
      throw err;
    }
  }
}
