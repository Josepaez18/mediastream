import { allowedCorsOrigins, catalogBaseUrl } from './public-urls';

describe('public-urls', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('PUBLIC_') || key === 'CORS_ORIGINS' || key === 'CATALOG_SERVICE_URL') {
        delete process.env[key];
      }
    }
  });

  it('en local permite cualquier origen y llama a Catalog en localhost', () => {
    expect(allowedCorsOrigins()).toBe('*');
    expect(catalogBaseUrl()).toBe('http://localhost:3002');
  });

  it('en Render solo acepta las URLs de MediaStream y usa la URL pública de Catalog', () => {
    process.env.PUBLIC_CATALOG_URL = 'https://ms-catalog.onrender.com/';
    process.env.PUBLIC_NOTIFICATION_URL = 'https://ms-notification.onrender.com';
    expect(allowedCorsOrigins()).toEqual([
      'https://ms-catalog.onrender.com',
      'https://ms-notification.onrender.com',
    ]);
    expect(catalogBaseUrl()).toBe('https://ms-catalog.onrender.com');
  });

  it('CORS_ORIGINS y CATALOG_SERVICE_URL tienen prioridad', () => {
    process.env.PUBLIC_CATALOG_URL = 'https://ms-catalog.onrender.com';
    process.env.CATALOG_SERVICE_URL = 'http://catalog-service:3002/';
    process.env.CORS_ORIGINS = 'https://app.mediastream.com';
    expect(allowedCorsOrigins()).toEqual(['https://app.mediastream.com']);
    expect(catalogBaseUrl()).toBe('http://catalog-service:3002');
  });
});
