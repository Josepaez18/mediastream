import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { Audience, Notification } from './notification.types';

// Cuántas notificaciones se guardan por destinatario. Es un historial
// reciente para la app, no un archivo permanente.
const HISTORY_LIMIT = 100;

export function feedKey(audience: Audience): string {
  return audience.scope === 'broadcast'
    ? 'notifications:broadcast'
    : `notifications:${audience.scope}:${audience.id}`;
}

/**
 * Historial y deduplicación de notificaciones sobre Redis.
 *
 * Deduplicación: antes de enviar, se reserva la clave del evento con
 * SET NX EX. Si ya existía, la notificación ya se envió (por ejemplo, porque
 * RabbitMQ reentregó el mensaje tras un reinicio) y no se repite.
 */
@Injectable()
export class NotificationsStore {
  constructor(private readonly redis: RedisService) {}

  /** true si esta es la primera vez que se ve la clave (y queda reservada). */
  async claim(dedupKey: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.client.set(`dedup:${dedupKey}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Libera la reserva, para que un reintento del mismo evento sí se procese. */
  async release(dedupKey: string): Promise<void> {
    await this.redis.client.del(`dedup:${dedupKey}`);
  }

  async save(notification: Notification): Promise<void> {
    const key = feedKey(notification.audience);
    await this.redis.client
      .multi()
      .lpush(key, JSON.stringify(notification))
      .ltrim(key, 0, HISTORY_LIMIT - 1)
      .exec();
  }

  async list(audiences: Audience[], limit: number): Promise<Notification[]> {
    const feeds = await Promise.all(
      audiences.map((a) => this.redis.client.lrange(feedKey(a), 0, limit - 1)),
    );
    return feeds
      .flat()
      .map((raw) => JSON.parse(raw) as Notification)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
