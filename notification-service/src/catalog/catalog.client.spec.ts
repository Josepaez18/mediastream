import { CatalogClient } from './catalog.client';

describe('CatalogClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('devuelve null (sin lanzar) si Catalog no responde', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as any;
    await expect(new CatalogClient().getTitle('3')).resolves.toBeNull();
  });

  it('devuelve null si el título no existe', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
    await expect(new CatalogClient().getTitle('999')).resolves.toBeNull();
  });

  it('devuelve el título si Catalog responde', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '3', name: 'Mareas', type: 'MOVIE' }),
    }) as any;
    await expect(new CatalogClient().getTitle('3')).resolves.toMatchObject({ name: 'Mareas' });
  });
});
