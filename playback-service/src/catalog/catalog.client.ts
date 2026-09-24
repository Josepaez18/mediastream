import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { RedisService } from '../redis/redis.service';
import { CircuitBreaker, CircuitOpenError, CircuitState } from './circuit-breaker';

export interface CatalogTitle {
  id: string;
  name: string;
  status: 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE';
  type: 'MOVIE' | 'SERIES';
  category?: string | null;
  ageRating?: string | null;
}

export interface CatalogAvailability {
  region: string;
  availableFrom: string;
  availableUntil?: string | null;
  isAvailableNow?: boolean;
}

/**
 * De dónde salió el dato con el que se decidió:
 *  - LIVE: Catalog respondió en esta solicitud.
 *  - CACHE: respuesta de Catalog de hace menos de CATALOG_CACHE_TTL_SECONDS.
 *  - LAST_KNOWN: Catalog no respondió (o el circuito está abierto) y se usó
 *    la última respuesta conocida (sección 4.7: seguir emitiendo tokens
 *    "aunque sea con información de disponibilidad menos actualizada").
 */
export type CatalogSource = 'LIVE' | 'CACHE' | 'LAST_KNOWN';

export interface CatalogResult<T> {
  data: T;
  source: CatalogSource;
}

const intFromEnv = (name: string, fallback: number) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Catalog no está disponible (red, timeout o 5xx): vale la pena reintentar. */
const isCatalogDown = (err: any): boolean =>
  !err?.response || (typeof err.response.status === 'number' && err.response.status >= 500);

/**
 * Comunicación síncrona con Catalog-Service vía API REST, con los tres
 * mecanismos de resiliencia del documento:
 *
 *  - Timeout (4.5): ~2 s por intento (CATALOG_TIMEOUT_MS).
 *  - Retries (4.6): hasta 2 reintentos con backoff exponencial
 *    (CATALOG_RETRIES, CATALOG_RETRY_BASE_MS) antes de darse por vencido.
 *  - Circuit breaker (4.7): tras CATALOG_CB_FAILURE_THRESHOLD fallos
 *    seguidos deja de llamar a Catalog durante CATALOG_CB_OPEN_MS y responde
 *    con la última información conocida.
 *
 * Además cachea cada respuesta en Redis (60 s) porque la disponibilidad se
 * consulta en cada inicio de reproducción y cambia con baja frecuencia.
 */
@Injectable()
export class CatalogClient {
  private readonly logger = new Logger(CatalogClient.name);
  private readonly http: AxiosInstance;
  private readonly breaker: CircuitBreaker;
  private readonly retries = intFromEnv('CATALOG_RETRIES', 2);
  private readonly retryBaseMs = intFromEnv('CATALOG_RETRY_BASE_MS', 200);
  private readonly cacheTtlSeconds = intFromEnv('CATALOG_CACHE_TTL_SECONDS', 60);
  private readonly lastKnownTtlSeconds = intFromEnv('CATALOG_LAST_KNOWN_TTL_SECONDS', 86400);

  constructor(private readonly redis: RedisService) {
    this.http = axios.create({
      // En Render los servicios gratis no reciben tráfico por la red privada:
      // Playback llama a la URL pública de Catalog (PUBLIC_CATALOG_URL).
      baseURL: (
        process.env.CATALOG_SERVICE_URL ||
        process.env.PUBLIC_CATALOG_URL ||
        'http://localhost:3002'
      ).replace(/\/+$/, ''),
      timeout: intFromEnv('CATALOG_TIMEOUT_MS', 2000),
    });
    this.breaker = new CircuitBreaker({
      failureThreshold: Math.max(1, intFromEnv('CATALOG_CB_FAILURE_THRESHOLD', 3)),
      openMs: intFromEnv('CATALOG_CB_OPEN_MS', 30000),
      onStateChange: (from, to) =>
        this.logger.warn(`Circuit breaker hacia Catalog-Service: ${from} → ${to}`),
    });
  }

  /** Estado del circuito hacia Catalog (se muestra en /health/ready y en el token). */
  get circuitState(): CircuitState {
    return this.breaker.currentState;
  }

  /** El título, o null si Catalog responde 404. */
  async getTitle(titleId: string): Promise<CatalogResult<CatalogTitle | null>> {
    return this.lookup(`title:${titleId}`, `el título ${titleId}`, async () => {
      try {
        const { data } = await this.http.get(`/api/catalog/titles/${encodeURIComponent(titleId)}`);
        return {
          id: String(data.id),
          name: data.name,
          status: data.status,
          type: data.type,
          category: data.category ?? null,
          ageRating: data.ageRating ?? null,
        } as CatalogTitle;
      } catch (err: any) {
        if (err.response?.status === 404) return null;
        throw err;
      }
    });
  }

  /** ¿Tiene el título licencia vigente en la región (o GLOBAL) ahora mismo? */
  async isAvailableInRegion(titleId: string, region: string): Promise<CatalogResult<boolean>> {
    const r = region.toUpperCase();
    return this.lookup(`avail:${titleId}:${r}`, `la disponibilidad de ${titleId} en ${r}`, async () => {
      const { data } = await this.http.get(
        `/api/catalog/titles/${encodeURIComponent(titleId)}/availability`,
      );
      const rows: CatalogAvailability[] = Array.isArray(data) ? data : [];
      const now = Date.now();
      return rows.some((a) => {
        const matchesRegion =
          a.region?.toUpperCase() === r || a.region?.toUpperCase() === 'GLOBAL';
        if (!matchesRegion) return false;
        if (typeof a.isAvailableNow === 'boolean') return a.isAvailableNow;
        const from = new Date(a.availableFrom).getTime();
        const until = a.availableUntil
          ? new Date(a.availableUntil).getTime()
          : Number.POSITIVE_INFINITY;
        return from <= now && now <= until;
      });
    });
  }

  /** Usado por el readiness probe: ¿responde el servicio del que dependemos? */
  async isReachable(): Promise<boolean> {
    try {
      await this.http.get('/health', { timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cache → Catalog (con circuit breaker + reintentos) → última respuesta
   * conocida → 503. Un null (404) no se cachea: el título puede crearse
   * en cualquier momento.
   */
  private async lookup<T>(
    key: string,
    what: string,
    fetcher: () => Promise<T>,
  ): Promise<CatalogResult<T>> {
    const cacheKey = `catalog:${key}`;
    const lastKnownKey = `catalog:last:${key}`;

    const cached = await this.redis.get<T>(cacheKey);
    if (cached !== null) return { data: cached, source: 'CACHE' };

    try {
      const data = await this.breaker.execute(() => this.withRetries(fetcher, what), isCatalogDown);
      if (data !== null) {
        await Promise.all([
          this.redis.set(cacheKey, data, this.cacheTtlSeconds),
          this.redis.set(lastKnownKey, data, this.lastKnownTtlSeconds),
        ]);
      }
      return { data, source: 'LIVE' };
    } catch (err: any) {
      if (!(err instanceof CircuitOpenError) && !isCatalogDown(err)) {
        // Catalog respondió, pero rechazó la consulta (4xx): no es una caída.
        throw new BadRequestException(
          `Catalog-Service rechazó la consulta de ${what} (HTTP ${err.response?.status}).`,
        );
      }

      const lastKnown = await this.redis.get<T>(lastKnownKey);
      if (lastKnown !== null) {
        this.logger.warn(
          `Catalog-Service no disponible (${err.message}); se usa la última información conocida de ${what}.`,
        );
        return { data: lastKnown, source: 'LAST_KNOWN' };
      }

      this.logger.error(`No se pudo consultar ${what} en Catalog-Service: ${err.message}`);
      throw new ServiceUnavailableException(
        'Catalog-Service no responde y no hay información previa de este título: ' +
          'no se puede verificar su licencia. El resto de Playback sigue funcionando.',
      );
    }
  }

  /** Hasta `retries` reintentos con backoff exponencial (200 ms, 400 ms…). */
  private async withRetries<T>(fn: () => Promise<T>, what: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        if (!isCatalogDown(err) || attempt >= this.retries) throw err;
        const delay = this.retryBaseMs * 2 ** attempt;
        this.logger.warn(
          `Catalog-Service falló consultando ${what} (${err.message}); reintento ${attempt + 1}/${this.retries} en ${delay} ms.`,
        );
        await sleep(delay);
      }
    }
  }
}
