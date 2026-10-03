import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Notification-Service no tiene base de datos relacional (sección 3 del
 * documento): usa Redis como almacenamiento ligero para
 *   · deduplicar las notificaciones ya enviadas, y
 *   · guardar un historial acotado por perfil y por cuenta.
 *
 * Son dos conexiones: una para comandos y otra para Pub/Sub, porque una
 * conexión de Redis suscrita a un canal ya no acepta comandos normales.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  client: Redis;
  subscriber: Redis;

  onModuleInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(url, { maxRetriesPerRequest: 3 });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null });
    this.client.on('connect', () => this.logger.log('Conectado a Redis'));
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
    this.subscriber.on('error', (err) => this.logger.warn(`Redis (Pub/Sub) error: ${err.message}`));
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.client?.quit(), this.subscriber?.quit()]);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
