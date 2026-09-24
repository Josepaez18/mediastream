import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CatalogClient, CatalogSource } from '../catalog/catalog.client';
import { CreateProgressDto } from './dto/create-progress.dto';
import { GenerateTokenQueryDto } from './dto/generate-token-query.dto';

// Umbral a partir del cual se considera que el usuario terminó el contenido.
// Netflix y similares usan valores cercanos al 90-95%.
const COMPLETION_THRESHOLD = 0.95;

// 451 Unavailable For Legal Reasons: el título existe pero no tiene licencia
// en la región del usuario (sección 4.4 del documento).
const UNAVAILABLE_FOR_LEGAL_REASONS = 451;

@Injectable()
export class PlaybackService {
  private readonly logger = new Logger(PlaybackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly catalog: CatalogClient,
  ) {}

  /**
   * Genera un token DRM de corta duración para iniciar la reproducción.
   *
   * Antes de emitirlo consulta de forma síncrona al Catalog-Service (REST)
   * para verificar que el título exista, esté AVAILABLE y tenga disponibilidad
   * vigente en la región del usuario. Esta es la comunicación síncrona que
   * describe el documento: no se entrega un token para contenido que el
   * usuario no tiene derecho a ver en su región.
   *
   * Si Catalog no responde, el CatalogClient reintenta y, con el circuito
   * abierto, usa la última información conocida (sección 4.7). La respuesta
   * indica de dónde salió la verificación en `catalogCheck`.
   */
  async generateToken(titleId: string, query: GenerateTokenQueryDto) {
    const { profileId, region, deviceId } = query;

    if (!/^\d+$/.test(titleId)) {
      throw new BadRequestException(
        'El ID del título es numérico (el #ID que muestra Catalog).',
      );
    }

    const titleCheck = await this.catalog.getTitle(titleId);
    const title = titleCheck.data;
    if (!title) {
      throw new NotFoundException(`El título ${titleId} no existe en el catálogo`);
    }
    if (title.status !== 'AVAILABLE') {
      throw new ForbiddenException(
        `El título "${title.name}" no está disponible para reproducción (estado ${title.status})`,
      );
    }

    const regionCheck = await this.catalog.isAvailableInRegion(titleId, region);
    if (!regionCheck.data) {
      throw new HttpException(
        {
          statusCode: UNAVAILABLE_FOR_LEGAL_REASONS,
          error: 'Unavailable For Legal Reasons',
          message: `El título "${title.name}" no tiene licencia vigente en la región ${region}`,
        },
        UNAVAILABLE_FOR_LEGAL_REASONS,
      );
    }

    const sessionId = uuidv4();
    const ttlSeconds = parseInt(process.env.DRM_TOKEN_TTL_SECONDS ?? '300', 10);

    // El payload del token es lo que el reproductor presentará al CDN/edge
    // para desencriptar el stream. Se mantiene corto a propósito.
    const payload = {
      sub: profileId,
      titleId,
      region,
      deviceId: deviceId ?? null,
      sessionId,
      scope: 'playback',
    };

    const token = await this.jwt.signAsync(payload, { expiresIn: ttlSeconds });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Registramos la sesión activa en Redis para poder revocarla y para
    // controlar el límite de streams concurrentes por perfil.
    await this.redis.set(
      `playback:session:${sessionId}`,
      { profileId, titleId, deviceId: deviceId ?? null, region },
      ttlSeconds,
    );

    this.logger.log(
      `Token DRM emitido | perfil=${profileId} titulo=${titleId} region=${region} sesion=${sessionId}`,
    );

    return {
      token,
      sessionId,
      titleId,
      titleName: title.name,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: ttlSeconds,
      manifestUrl: `${process.env.CDN_BASE_URL ?? 'https://cdn.mediastream.local'}/titles/${titleId}/master.m3u8`,
      // LIVE: Catalog respondió ahora; CACHE: respuesta de hace < 60 s;
      // LAST_KNOWN: Catalog no respondió y se usó lo último que se supo.
      catalogCheck: {
        source: this.worstSource(titleCheck.source, regionCheck.source),
        circuit: this.catalog.circuitState,
      },
    };
  }

  /** La fuente menos fresca de las dos verificaciones es la que se informa. */
  private worstSource(a: CatalogSource, b: CatalogSource): CatalogSource {
    const rank: Record<CatalogSource, number> = { LIVE: 0, CACHE: 1, LAST_KNOWN: 2 };
    return rank[a] >= rank[b] ? a : b;
  }

  /**
   * Registra la posición actual de reproducción de un perfil.
   *
   * Es el endpoint de mayor tráfico del sistema (el reproductor lo llama cada
   * pocos segundos), por eso escribe con un upsert y publica el evento de
   * forma asíncrona por Redis Pub/Sub sin bloquear la respuesta.
   */
  async saveProgress(dto: CreateProgressDto) {
    const {
      profileId,
      titleId,
      episodeId,
      positionSeconds,
      durationSeconds,
      deviceId,
    } = dto;

    const completed =
      durationSeconds && durationSeconds > 0
        ? positionSeconds / durationSeconds >= COMPLETION_THRESHOLD
        : false;

    const titleIdBig = BigInt(titleId);
    const episodeIdBig = episodeId ? BigInt(episodeId) : null;

    // Prisma no admite NULL dentro de una clave única compuesta (en SQL,
    // NULL nunca es igual a NULL), y episodeId es nulo para las películas.
    // Por eso buscamos primero y decidimos entre crear o actualizar, en vez
    // de usar upsert.
    const existing = await this.prisma.watchProgress.findFirst({
      where: {
        profileId,
        titleId: titleIdBig,
        episodeId: episodeIdBig,
      },
      select: { id: true },
    });

    const progress = existing
      ? await this.prisma.watchProgress.update({
          where: { id: existing.id },
          data: {
            positionSeconds,
            durationSeconds: durationSeconds ?? undefined,
            deviceId: deviceId ?? undefined,
            completed,
          },
        })
      : await this.prisma.watchProgress.create({
          data: {
            profileId,
            titleId: titleIdBig,
            episodeId: episodeIdBig,
            positionSeconds,
            durationSeconds: durationSeconds ?? null,
            deviceId: deviceId ?? null,
            completed,
          },
        });

    // Cache del punto de continuación, para que /resume no golpee la base
    // de datos en cada carga de la pantalla de inicio.
    await this.redis.invalidateByPrefix(`playback:resume:${profileId}`);

    // Eventos asincrónicos por Redis Pub/Sub. Recommendation-Service escucha
    // playback.completed para actualizar el modelo de cada perfil.
    const eventPayload = {
      profileId,
      titleId,
      episodeId: episodeId ?? null,
      positionSeconds,
      durationSeconds: durationSeconds ?? null,
      occurredAt: new Date().toISOString(),
    };

    await this.redis.publish('playback.progress', eventPayload);
    if (completed) {
      await this.redis.publish('playback.completed', eventPayload);
      this.logger.log(
        `Contenido completado | perfil=${profileId} titulo=${titleId}`,
      );
    }

    return this.serialize(progress);
  }

  /**
   * Devuelve los puntos de continuación de un perfil ("Seguir viendo").
   * Excluye por defecto lo ya terminado, que no tiene sentido reanudar.
   */
  async getResumePoints(profileId: string, includeCompleted = false) {
    const cacheKey = `playback:resume:${profileId}:${includeCompleted}`;
    const cached = await this.redis.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.watchProgress.findMany({
      where: {
        profileId,
        ...(includeCompleted ? {} : { completed: false }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });

    const result = rows.map((r) => this.serialize(r));
    await this.redis.set(cacheKey, result, 30);
    return result;
  }

  /** Punto de continuación de un título puntual (o null si nunca se vio). */
  async getResumeForTitle(profileId: string, titleId: string) {
    const rows = await this.prisma.watchProgress.findMany({
      where: { profileId, titleId: BigInt(titleId) },
      orderBy: { updatedAt: 'desc' },
      take: 1,
    });
    return rows.length ? this.serialize(rows[0]) : null;
  }

  /**
   * Prisma devuelve BigInt, que JSON.stringify no sabe serializar.
   * Los convertimos a string y agregamos el porcentaje ya calculado para
   * que el frontend no tenga que hacerlo.
   */
  private serialize(row: {
    id: bigint;
    profileId: string;
    titleId: bigint;
    episodeId: bigint | null;
    positionSeconds: number;
    durationSeconds: number | null;
    completed: boolean;
    deviceId: string | null;
    updatedAt: Date;
  }) {
    const percent =
      row.durationSeconds && row.durationSeconds > 0
        ? Math.min(100, Math.round((row.positionSeconds / row.durationSeconds) * 100))
        : null;

    return {
      id: row.id.toString(),
      profileId: row.profileId,
      titleId: row.titleId.toString(),
      episodeId: row.episodeId ? row.episodeId.toString() : null,
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      percentWatched: percent,
      completed: row.completed,
      deviceId: row.deviceId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
