import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TitleStatus, TitleType } from '@prisma/client';

describe('CatalogService', () => {
  let service: CatalogService;

  const mockTitle = {
    id: BigInt(1),
    name: 'Test Title',
    synopsis: 'synopsis',
    type: TitleType.MOVIE,
    status: TitleStatus.AVAILABLE,
    category: 'Drama',
    ageRating: 'PG',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prismaMock = {
    title: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    availability: {
      findMany: jest.fn(),
    },
  };

  const redisMock = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    invalidateByPrefix: jest.fn(),
    ping: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  it('debería estar definido', () => {
    expect(service).toBeDefined();
  });

  it('listTitles devuelve el catálogo serializado y lo cachea', async () => {
    prismaMock.title.findMany.mockResolvedValue([mockTitle]);

    const result = await service.listTitles({ region: 'CO' } as any);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(redisMock.set).toHaveBeenCalled();
  });

  it('listTitles devuelve el resultado cacheado sin ir a la base de datos', async () => {
    redisMock.get.mockResolvedValueOnce([{ id: '1' }]);

    const result = await service.listTitles({ region: 'CO' } as any);

    expect(result).toEqual([{ id: '1' }]);
    expect(prismaMock.title.findMany).not.toHaveBeenCalled();
  });

  it('getTitleById lanza NotFoundException si no existe', async () => {
    prismaMock.title.findUnique.mockResolvedValue(null);

    await expect(service.getTitleById(BigInt(999))).rejects.toThrow(NotFoundException);
  });

  it('markTitleAsAvailable actualiza el status e invalida cache', async () => {
    prismaMock.title.update.mockResolvedValue({ ...mockTitle, status: TitleStatus.AVAILABLE });

    await service.markTitleAsAvailable(BigInt(1));

    expect(prismaMock.title.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { status: TitleStatus.AVAILABLE },
    });
    expect(redisMock.invalidateByPrefix).toHaveBeenCalled();
  });
});
