import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Playback-Service usa Redis para dos cosas distintas:
 *  1. Cache de sesiones activas y de las consultas al catálogo.
 *  2. Pub/Sub para publicar playback.progress y playback.completed, que
 *     Recommendation-Service consume para actualizar el modelo de cada perfil.
 *
 * ioredis exige una conexión dedicada para publicar cuando la otra está en
 * modo suscriptor, por eso mantenemos dos clientes separados.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private publisher: Redis;
  private readonly defaultTtlSeconds = 60;

  onModuleInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const opts = { maxRetriesPerRequest: 3, lazyConnect: false };

    this.client = new Redis(url, opts);
    this.publisher = new Redis(url, opts);

    this.client.on('connect', () =>
      this.logger.log('Conectado a Redis (cache/sesiones)'),
    );
    this.client.on('error', (err) =>
      this.logger.warn(`Redis error: ${err.message}`),
    );
    this.publisher.on('error', (err) =>
      this.logger.warn(`Redis publisher error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await Promise.all([this.client?.quit(), this.publisher?.quit()]);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(
        `Fallo leyendo cache ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds = this.defaultTtlSeconds,
  ): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Fallo escribiendo cache ${key}: ${(err as Error).message}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Fallo borrando ${key}: ${(err as Error).message}`);
    }
  }

  async invalidateByPrefix(prefix: string): Promise<void> {
    try {
      const keys = await this.client.keys(`${prefix}*`);
      if (keys.length) await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(
        `Fallo invalidando cache ${prefix}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Publica un evento de dominio. Los fallos se registran pero no rompen la
   * respuesta HTTP: registrar el progreso es más importante que notificarlo.
   */
  async publish(channel: string, payload: unknown): Promise<void> {
    try {
      await this.publisher.publish(channel, JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(
        `Fallo publicando en ${channel}: ${(err as Error).message}`,
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }
}
