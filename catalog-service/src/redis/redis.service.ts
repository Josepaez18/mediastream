import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

// Catalog-Service usa Redis para cachear las consultas de lectura más
// frecuentes (listado de títulos por región / perfil), tal como se describe
// en la sección "Stack Tecnológico" del documento.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private readonly defaultTtlSeconds = 60;

  onModuleInit() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.client.on('connect', () => this.logger.log('Conectado a Redis (cache)'));
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Fallo leyendo cache ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = this.defaultTtlSeconds): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Fallo escribiendo cache ${key}: ${(err as Error).message}`);
    }
  }

  async invalidateByPrefix(prefix: string): Promise<void> {
    try {
      const keys = await this.client.keys(`${prefix}*`);
      if (keys.length) await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(`Fallo invalidando cache ${prefix}: ${(err as Error).message}`);
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
