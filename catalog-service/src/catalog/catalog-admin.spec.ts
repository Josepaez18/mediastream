import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TitleStatus, TitleType } from '@prisma/client';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

const title = {
  id: 5n,
  name: 'Mareas',
  synopsis: null,
  type: TitleType.SERIES,
  status: TitleStatus.PENDING,
  category: 'Drama',
  ageRating: 'PG',
  isFree: false,
  posterUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Catalog: administración', () => {
  let tx: any;
  let prisma: any;
  let redis: any;
  let service: CatalogService;

  beforeEach(() => {
    tx = {
      availability: { deleteMany: jest.fn(), createMany: jest.fn() },
      title: { update: jest.fn(async ({ data }) => ({ ...title, ...data })) },
    };
    prisma = {
      title: { findUnique: jest.fn().mockResolvedValue(title), delete: jest.fn() },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    redis = { invalidateByPrefix: jest.fn() };
    service = new CatalogService(prisma, redis);
  });

  it('editar: marca gratis, publica y reemplaza las regiones (sin duplicados, en mayúsculas)', async () => {
    const result = await service.updateTitle(5n, {
      isFree: true,
      status: TitleStatus.AVAILABLE,
      regions: ['co', 'MX', 'CO '],
    });
    expect(tx.availability.deleteMany).toHaveBeenCalledWith({ where: { titleId: 5n } });
    expect(tx.availability.createMany.mock.calls[0][0].data.map((a: any) => a.region)).toEqual(['CO', 'MX']);
    expect(result).toMatchObject({ isFree: true, status: 'AVAILABLE' });
    expect(redis.invalidateByPrefix).toHaveBeenCalled();
  });

  it('editar: una imagen vacía la quita; sin regiones no toca la disponibilidad', async () => {
    await service.updateTitle(5n, { posterUrl: '  ' });
    expect(tx.title.update.mock.calls[0][0].data).toEqual({ posterUrl: null });
    expect(tx.availability.deleteMany).not.toHaveBeenCalled();
  });

  it('borrar un título inexistente → 404', async () => {
    prisma.title.findUnique.mockResolvedValue(null);
    await expect(service.deleteTitle(9n)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('detrás del Gateway, solo un ADMIN puede escribir', async () => {
    const controller = new CatalogController(service);
    const req = (role?: string) => ({ headers: { 'x-account-id': '3', ...(role ? { 'x-account-role': role } : {}) } }) as any;
    await expect(controller.deleteTitle(5, req('USER'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.deleteTitle(5, req('ADMIN'))).resolves.toEqual({ deleted: '5' });
  });
});
