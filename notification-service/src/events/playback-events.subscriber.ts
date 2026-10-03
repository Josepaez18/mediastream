import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { parsePlaybackCompleted } from './event-payloads';

const CHANNEL = process.env.COMPLETED_CHANNEL ?? 'playback.completed';

/**
 * Escucha playback.completed en Redis Pub/Sub (lo publica Playback-Service)
 * para avisar de la continuación de series en curso.
 *
 * Es Pub/Sub, no una cola: si Notification está caído en ese momento, el
 * evento se pierde. Se acepta, igual que en Recommendation (sección 4.2): un
 * aviso de "sigue viendo" perdido no es crítico, y el próximo episodio
 * terminado genera otro.
 */
@Injectable()
export class PlaybackEventsSubscriber implements OnModuleInit {
  private readonly logger = new Logger(PlaybackEventsSubscriber.name);
  private subscribed = false;

  constructor(
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    const sub = this.redis.subscriber;
    const subscribe = () =>
      sub
        .subscribe(CHANNEL)
        .then(() => {
          this.subscribed = true;
          this.logger.log(`Suscrito a Redis Pub/Sub: ${CHANNEL}`);
        })
        .catch((err: Error) => this.logger.warn(`No se pudo suscribir a ${CHANNEL}: ${err.message}`));
    // Se (re)suscribe cada vez que la conexión queda lista, también tras una
    // caída de Redis.
    sub.on('ready', () => void subscribe());
    if (sub.status === 'ready') void subscribe();
    sub.on('end', () => (this.subscribed = false));
    sub.on('close', () => (this.subscribed = false));
    sub.on('message', (_channel: string, raw: string) => void this.handle(raw));
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  private async handle(raw: string) {
    try {
      await this.notifications.onPlaybackCompleted(parsePlaybackCompleted(JSON.parse(raw)));
    } catch (err) {
      this.logger.warn(`playback.completed ignorado: ${(err as Error).message}`);
    }
  }
}
