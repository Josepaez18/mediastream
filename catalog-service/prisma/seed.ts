import { PrismaClient, TitleType, TitleStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Sembrando datos de prueba en Catalog-Service...');

  const serie = await prisma.title.create({
    data: {
      name: 'Fronteras del Caribe',
      synopsis: 'Una serie original sobre la costa colombiana.',
      type: TitleType.SERIES,
      status: TitleStatus.AVAILABLE,
      category: 'Drama',
      ageRating: 'PG-13',
      seasons: {
        create: [
          {
            seasonNumber: 1,
            episodes: {
              create: [
                { episodeNumber: 1, durationSeconds: 2700 },
                { episodeNumber: 2, durationSeconds: 2650 },
              ],
            },
          },
        ],
      },
      availabilities: {
        create: [
          {
            region: 'CO',
            availableFrom: new Date('2026-01-01'),
            availableUntil: null,
          },
          {
            region: 'MX',
            availableFrom: new Date('2026-03-01'),
            availableUntil: new Date('2027-03-01'),
          },
        ],
      },
    },
  });

  const pelicula = await prisma.title.create({
    data: {
      name: 'Amanecer en Montería',
      synopsis: 'Película familiar apta para todo público.',
      type: TitleType.MOVIE,
      status: TitleStatus.PENDING,
      category: 'Familiar',
      ageRating: 'G',
      availabilities: {
        create: [
          {
            region: 'CO',
            availableFrom: new Date('2026-06-01'),
          },
        ],
      },
    },
  });

  console.log({ serie: serie.id.toString(), pelicula: pelicula.id.toString() });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
