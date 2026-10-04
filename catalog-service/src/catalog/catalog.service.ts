import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateTitleDto } from './dto/create-title.dto';
import { UpdateTitleDto } from './dto/update-title.dto';
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
        isFree: dto.isFree ?? false,
        posterUrl: dto.posterUrl || null,
        status: dto.publishImmediately ? TitleStatus.AVAILABLE : TitleStatus.PENDING,
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

  // PATCH /api/catalog/titles/{id} (uso administrativo)
  async updateTitle(id: bigint, dto: UpdateTitleDto) {
    const existing = await this.prisma.title.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Título ${id} no encontrado`);

    const { regions, posterUrl, ...fields } = dto;
    const regionList = regions
      ? [...new Set(regions.map((r) => r.trim().toUpperCase()).filter(Boolean))]
      : undefined;

    const title = await this.prisma.$transaction(async (tx) => {
      if (regionList) {
        await tx.availability.deleteMany({ where: { titleId: id } });
        if (regionList.length) {
          await tx.availability.createMany({
            data: regionList.map((region) => ({ titleId: id, region, availableFrom: new Date() })),
          });
        }
      }
      return tx.title.update({
        where: { id },
        data: {
          ...fields,
          ...(posterUrl !== undefined ? { posterUrl: posterUrl.trim() || null } : {}),
        },
      });
    });

    await this.redis.invalidateByPrefix(CACHE_PREFIX);
    this.logger.log(`Título ${id} actualizado`);
    return this.serializeTitle(title);
  }

  // DELETE /api/catalog/titles/{id} (uso administrativo). Temporadas,
  // episodios y disponibilidad se borran en cascada.
  async deleteTitle(id: bigint) {
    const existing = await this.prisma.title.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Título ${id} no encontrado`);
    await this.prisma.title.delete({ where: { id } });
    await this.redis.invalidateByPrefix(CACHE_PREFIX);
    this.logger.log(`Título ${id} eliminado`);
    return { deleted: id.toString() };
  }

  // GET /api/catalog/admin/titles: todos los títulos, en cualquier estado y
  // región, con sus regiones y número de episodios (panel de administración).
  async adminListTitles() {
    const titles = await this.prisma.title.findMany({
      include: {
        availabilities: { select: { region: true } },
        seasons: { include: { _count: { select: { episodes: true } } } },
      },
      orderBy: { id: 'desc' },
    });
    return titles.map((t) => ({
      ...this.serializeTitle(t),
      regions: [...new Set(t.availabilities.map((a) => a.region))].sort(),
      seasons: t.seasons.length,
      episodes: t.seasons.reduce((sum, s) => sum + s._count.episodes, 0),
    }));
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
      isFree: title.isFree ?? false,
      posterUrl: title.posterUrl ?? null,
      createdAt: title.createdAt,
      updatedAt: title.updatedAt,
    };
  }
}
