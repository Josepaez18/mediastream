import { allowedCorsOrigins, publicServiceUrls } from './public-urls';

/** CORS solo para los orígenes conocidos (sección 10) y URLs para las consolas. */
describe('public-urls', () => {
  const saved = { ...process.env };
  const VARS = [
    'CORS_ORIGINS',
    'PUBLIC_USER_URL',
    'PUBLIC_CATALOG_URL',
    'PUBLIC_PLAYBACK_URL',
    'PUBLIC_MEDIA_URL',
    'PUBLIC_RECOMMENDATION_URL',
    'PUBLIC_BILLING_URL',
  ];

  beforeEach(() => VARS.forEach((v) => delete process.env[v]));
  afterAll(() => {
    process.env = saved;
  });

  it('en local (sin variables) permite cualquier origen', () => {
    expect(allowedCorsOrigins()).toBe('*');
    expect(publicServiceUrls()).toEqual({});
  });

  it('en Render permite solo las URLs públicas de MediaStream', () => {
    process.env.PUBLIC_USER_URL = 'https://ms-user.onrender.com/';
    process.env.PUBLIC_CATALOG_URL = 'https://ms-catalog.onrender.com';
    expect(allowedCorsOrigins()).toEqual([
      'https://ms-user.onrender.com',
      'https://ms-catalog.onrender.com',
    ]);
    expect(publicServiceUrls()).toEqual({
      user: 'https://ms-user.onrender.com',
      catalog: 'https://ms-catalog.onrender.com',
    });
  });

  it('CORS_ORIGINS, si está definida, tiene prioridad', () => {
    process.env.PUBLIC_USER_URL = 'https://ms-user.onrender.com';
    process.env.CORS_ORIGINS = 'https://app.mediastream.com, https://staging.mediastream.com';
    expect(allowedCorsOrigins()).toEqual([
      'https://app.mediastream.com',
      'https://staging.mediastream.com',
    ]);
    process.env.CORS_ORIGINS = '*';
    expect(allowedCorsOrigins()).toBe('*');
  });
});
