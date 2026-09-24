import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateTitleDto } from './dto/create-title.dto';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';
import { TitleStatus } from '@prisma/client';

// Clasificaciones consideradas aptas para perfiles infantiles.
const KIDS_SAFE_RATINGS = ['G', 'PG'];
const CACHE_PREFIX = 'catalog:titles';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // GET /api/catalog/titles
  // Filtra por región (disponibilidad vigente) y, si el perfil es infantil,
  // solo devuelve contenido con clasificación apta (control parental).
  async listTitles(query: ListTitlesQueryDto) {
    const region = query.region ?? 'GLOBAL';
    const isKids = query.isKids === 'true';
    const cacheKey = `${CACHE_PREFIX}:${region}:${query.category ?? 'all'}:${isKids}`;

    const cached = await this.redis.get<any[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit para ${cacheKey}`);
      return cached;
    }

    const now = new Date();
    const titles = await this.prisma.title.findMany({
      where: {
        status: TitleStatus.AVAILABLE,
        ...(query.category ? { category: query.category } : {}),
        ...(isKids ? { ageRating: { in: KIDS_SAFE_RATINGS } } : {}),
        availabilities: {
          some: {
            region,
            availableFrom: { lte: now },
            OR: [{ availableUntil: null }, { availableUntil: { gte: now } }],
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const serialized = titles.map(this.serializeTitle);
    await this.redis.set(cacheKey, serialized);
    return serialized;
  }

  // GET /api/catalog/titles/{id}
  async getTitleById(id: bigint) {
    const title = await this.prisma.title.findUnique({
      where: { id },
      include: {
        seasons: {
          orderBy: { seasonNumber: 'asc' },
          include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
        },
      },
    });

    if (!title) {
      throw new NotFoundException(`Título ${id} no encontrado`);
    }

    return {
      ...this.serializeTitle(title),
      seasons: title.seasons.map((season) => ({
        id: season.id.toString(),
        seasonNumber: season.seasonNumber,
        episodes: season.episodes.map((ep) => ({
          id: ep.id.toString(),
          episodeNumber: ep.episodeNumber,
          durationSeconds: ep.durationSeconds,
        })),
      })),
    };
  }

  // GET /api/catalog/titles/{id}/availability
  async getAvailability(id: bigint) {
    const title = await this.prisma.title.findUnique({ where: { id } });
    if (!title) {
      throw new NotFoundException(`Título ${id} no encontrado`);
    }

    const availabilities = await this.prisma.availability.findMany({
      where: { titleId: id },
      orderBy: { region: 'asc' },
    });

    const now = new Date();
    return availabilities.map((a) => ({
      id: a.id.toString(),
      region: a.region,
      availableFrom: a.availableFrom,
      availableUntil: a.availableUntil,
      isAvailableNow:
        a.availableFrom <= now && (a.availableUntil === null || a.availableUntil >= now),
    }));
  }

  // POST /api/catalog/titles (uso administrativo)
  async createTitle(dto: CreateTitleDto) {
    const title = await this.prisma.title.create({
      data: {
        name: dto.name,
        synopsis: dto.synopsis,
        type: dto.type,
        category: dto.category,
        ageRating: dto.ageRating,
        status: TitleStatus.PENDING,
        seasons: dto.seasons
          ? {
              create: dto.seasons.map((s) => ({
                seasonNumber: s.seasonNumber,
                episodes: s.episodes
                  ? {
                      create: s.episodes.map((e) => ({
                        episodeNumber: e.episodeNumber,
                        durationSeconds: e.durationSeconds,
                      })),
                    }
                  : undefined,
              })),
            }
          : undefined,
        availabilities: dto.availabilities
          ? {
              create: dto.availabilities.map((a) => ({
                region: a.region,
                availableFrom: new Date(a.availableFrom),
                availableUntil: a.availableUntil ? new Date(a.availableUntil) : null,
              })),
            }
          : undefined,
      },
      include: { seasons: { include: { episodes: true } }, availabilities: true },
    });

    await this.redis.invalidateByPrefix(CACHE_PREFIX);
    return this.serializeTitle(title);
  }

  // Invocado por el consumidor del evento media.ready (Media-Processing-Service).
  // Marca el título como disponible una vez concluida la transcodificación.
  async markTitleAsAvailable(titleId: bigint) {
    const title = await this.prisma.title.update({
      where: { id: titleId },
      data: { status: TitleStatus.AVAILABLE },
    });
    await this.redis.invalidateByPrefix(CACHE_PREFIX);
    this.logger.log(`Título ${titleId} marcado como AVAILABLE (media.ready)`);
    return title;
  }

  // Invocado ante media.processing.failed, para no dejar un título huérfano en PENDING.
  async markTitleAsUnavailable(titleId: bigint) {
    const title = await this.prisma.title.update({
      where: { id: titleId },
      data: { status: TitleStatus.UNAVAILABLE },
    });
    await this.redis.invalidateByPrefix(CACHE_PREFIX);
    this.logger.warn(`Título ${titleId} marcado como UNAVAILABLE (media.processing.failed)`);
    return title;
  }

  private serializeTitle(title: any) {
    return {
      id: title.id.toString(),
      name: title.name,
      synopsis: title.synopsis,
      type: title.type,
      status: title.status,
      category: title.category,
      ageRating: title.ageRating,
      createdAt: title.createdAt,
      updatedAt: title.updatedAt,
    };
  }
}
