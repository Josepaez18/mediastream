import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CatalogClient } from '../catalog/catalog.client';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let prisma: {
    watchProgress: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    publish: jest.Mock;
    invalidateByPrefix: jest.Mock;
  };
  let catalog: {
    getTitle: jest.Mock;
    isAvailableInRegion: jest.Mock;
    circuitState: string;
  };

  beforeEach(async () => {
    prisma = {
      watchProgress: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
      invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
    };
    catalog = {
      getTitle: jest.fn(),
      isAvailableInRegion: jest.fn(),
      circuitState: 'CLOSED',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: CatalogClient, useValue: catalog },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('jwt-simulado') },
        },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
  });

  const progressRow = (overrides: Partial<any> = {}) => ({
    id: 1n,
    profileId: 'profile-42',
    titleId: 10n,
    episodeId: null,
    positionSeconds: 100,
    durationSeconds: 200,
    completed: false,
    deviceId: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  // El CatalogClient devuelve el dato junto con su origen (LIVE/CACHE/LAST_KNOWN).
  const live = <T>(data: T) => ({ data, source: 'LIVE' as const });

  describe('generateToken', () => {
    it('emite un token cuando el título está disponible en la región', async () => {
      catalog.getTitle.mockResolvedValue(
        live({
          id: '10',
          name: 'El Último Meridiano',
          status: 'AVAILABLE',
          type: 'MOVIE',
        }),
      );
      catalog.isAvailableInRegion.mockResolvedValue(live(true));

      const result = await service.generateToken('10', {
        profileId: 'profile-42',
        region: 'CO',
      });

      expect(result.token).toBe('jwt-simulado');
      expect(result.titleName).toBe('El Último Meridiano');
      expect(result.catalogCheck).toEqual({ source: 'LIVE', circuit: 'CLOSED' });
      expect(result.sessionId).toBeDefined();
      // La sesión debe quedar registrada en Redis para poder revocarla.
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('playback:session:'),
        expect.objectContaining({ profileId: 'profile-42' }),
        expect.any(Number),
      );
    });

    it('rechaza si el título no existe en el catálogo', async () => {
      catalog.getTitle.mockResolvedValue(live(null));

      await expect(
        service.generateToken('999', { profileId: 'p1', region: 'CO' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza si el título aún no está transcodificado (PENDING)', async () => {
      catalog.getTitle.mockResolvedValue(
        live({ id: '10', name: 'Pendiente', status: 'PENDING', type: 'MOVIE' }),
      );

      await expect(
        service.generateToken('10', { profileId: 'p1', region: 'CO' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('responde 451 si no hay licencia vigente en esa región', async () => {
      catalog.getTitle.mockResolvedValue(
        live({ id: '10', name: 'Sin licencia aquí', status: 'AVAILABLE', type: 'MOVIE' }),
      );
      catalog.isAvailableInRegion.mockResolvedValue(live(false));

      const err = await service
        .generateToken('10', { profileId: 'p1', region: 'AR' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(451);
    });

    it('emite el token con la última información conocida si Catalog está caído', async () => {
      catalog.getTitle.mockResolvedValue({
        data: { id: '10', name: 'La Sirenita', status: 'AVAILABLE', type: 'MOVIE' },
        source: 'LAST_KNOWN',
      });
      catalog.isAvailableInRegion.mockResolvedValue({ data: true, source: 'CACHE' });
      catalog.circuitState = 'OPEN';

      const result = await service.generateToken('10', { profileId: 'p1', region: 'CO' });

      expect(result.token).toBe('jwt-simulado');
      expect(result.catalogCheck).toEqual({ source: 'LAST_KNOWN', circuit: 'OPEN' });
    });

    it('rechaza un ID de título que no es numérico sin llamar a Catalog', async () => {
      await expect(
        service.generateToken('abc', { profileId: 'p1', region: 'CO' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(catalog.getTitle).not.toHaveBeenCalled();
    });
  });

  describe('saveProgress', () => {
    it('guarda la posición y publica playback.progress', async () => {
      prisma.watchProgress.create.mockResolvedValue(progressRow());

      const result = await service.saveProgress({
        profileId: 'profile-42',
        titleId: '10',
        positionSeconds: 100,
        durationSeconds: 200,
      });

      expect(result.percentWatched).toBe(50);
      expect(result.completed).toBe(false);
      expect(redis.publish).toHaveBeenCalledWith(
        'playback.progress',
        expect.objectContaining({ profileId: 'profile-42', titleId: '10' }),
      );
      expect(redis.publish).not.toHaveBeenCalledWith(
        'playback.completed',
        expect.anything(),
      );
    });

    it('marca como completado y publica playback.completed al superar el 95%', async () => {
      prisma.watchProgress.create.mockResolvedValue(
        progressRow({ positionSeconds: 195, completed: true }),
      );

      const result = await service.saveProgress({
        profileId: 'profile-42',
        titleId: '10',
        positionSeconds: 195,
        durationSeconds: 200,
      });

      expect(result.completed).toBe(true);
      expect(redis.publish).toHaveBeenCalledWith(
        'playback.completed',
        expect.objectContaining({ profileId: 'profile-42' }),
      );
    });

    it('no calcula porcentaje si no se envía la duración', async () => {
      prisma.watchProgress.create.mockResolvedValue(
        progressRow({ durationSeconds: null }),
      );

      const result = await service.saveProgress({
        profileId: 'profile-42',
        titleId: '10',
        positionSeconds: 100,
      });

      expect(result.percentWatched).toBeNull();
      expect(result.completed).toBe(false);
    });
  });

  describe('getResumePoints', () => {
    it('excluye el contenido terminado por defecto', async () => {
      prisma.watchProgress.findMany.mockResolvedValue([progressRow()]);

      await service.getResumePoints('profile-42');

      expect(prisma.watchProgress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId: 'profile-42', completed: false },
        }),
      );
    });

    it('devuelve el resultado cacheado sin tocar la base de datos', async () => {
      redis.get.mockResolvedValue([{ titleId: '10' }]);

      const result = await service.getResumePoints('profile-42');

      expect(result).toEqual([{ titleId: '10' }]);
      expect(prisma.watchProgress.findMany).not.toHaveBeenCalled();
    });
  });
});
