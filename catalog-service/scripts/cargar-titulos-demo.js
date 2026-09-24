/**
 * Carga títulos de ejemplo en el catálogo, ya disponibles (AVAILABLE) en
 * CO y MX, con categorías variadas. Sirven para mostrar el catálogo con
 * contenido y, sobre todo, para que Recommendation-Service tenga entre qué
 * recomendar.
 *
 * Escribe en la base de datos PROPIA de Catalog-Service (catalog_db): cada
 * servicio carga sus propios datos. Es idempotente: si ya existe un título
 * con el mismo nombre, lo salta.
 *
 * Uso (desde la carpeta MediaStream):
 *   docker compose exec catalog-service node scripts/cargar-titulos-demo.js
 */
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const TITLES = [
  // --- Acción
  {
    name: 'Frontera de Acero',
    type: 'MOVIE', category: 'Acción', ageRating: 'PG-13',
    synopsis: 'Un piloto de rescate atraviesa una frontera militarizada para evacuar a su hermana antes de que cierren los pasos de montaña.',
  },
  {
    name: 'Código Relámpago',
    type: 'MOVIE', category: 'Acción', ageRating: 'PG-13',
    synopsis: 'Una hacker y un exagente persiguen un código capaz de apagar la red eléctrica del continente, en una noche de persecuciones y explosiones.',
  },
  {
    name: 'Operación Tormenta Roja',
    type: 'SERIES', category: 'Acción', ageRating: 'PG-13',
    synopsis: 'Un escuadrón de rescate de élite enfrenta misiones imposibles en zonas de desastre, donde cada decisión cuesta vidas.',
  },
  // --- Ciencia ficción
  {
    name: 'Órbita Cero',
    type: 'MOVIE', category: 'Ciencia ficción', ageRating: 'PG-13',
    synopsis: 'La tripulación de una estación espacial abandonada recibe una señal desde la Tierra que no debería existir.',
  },
  {
    name: 'Ecos de Marte',
    type: 'SERIES', category: 'Ciencia ficción', ageRating: 'PG-13',
    synopsis: 'Colonos en Marte descubren que las tormentas de polvo guardan grabaciones de una expedición perdida hace cien años.',
  },
  // --- Drama
  {
    name: 'Las Horas del Faro',
    type: 'MOVIE', category: 'Drama', ageRating: 'PG-13',
    synopsis: 'Un farero viudo y su nieta reconstruyen su relación durante el último invierno antes de que el faro se automatice.',
  },
  {
    name: 'Cartas a Medianoche',
    type: 'MOVIE', category: 'Drama', ageRating: 'PG-13',
    synopsis: 'Una enfermera encuentra cartas nunca enviadas en un hospital antiguo y busca a sus destinatarios para cerrar historias pendientes.',
  },
  {
    name: 'El Peso del Río',
    type: 'SERIES', category: 'Drama', ageRating: 'R',
    synopsis: 'Tres hermanas regresan al pueblo de su infancia tras la muerte de su padre y descubren una deuda familiar que nadie quiso contar.',
  },
  // --- Documental
  {
    name: 'Selva Adentro',
    type: 'MOVIE', category: 'Documental', ageRating: 'PG',
    synopsis: 'Un equipo de biólogos sigue durante un año a una familia de jaguares en la selva amazónica.',
  },
  // --- Comedia
  {
    name: 'Vecinos en Apuros',
    type: 'MOVIE', category: 'Comedia', ageRating: 'PG',
    synopsis: 'Dos vecinos que se detestan deben organizar juntos la fiesta del edificio para salvar la terraza común.',
  },
  {
    name: 'La Boda de Mi Tía',
    type: 'MOVIE', category: 'Comedia', ageRating: 'PG-13',
    synopsis: 'Un organizador de bodas desastroso tiene tres días para sacar adelante la boda de su tía, con una familia empeñada en sabotearla.',
  },
  {
    name: 'Operación Sofá',
    type: 'MOVIE', category: 'Comedia', ageRating: 'PG',
    synopsis: 'Un grupo de amigos intenta devolver un sofá prestado antes de que su dueña regrese de viaje, y todo sale al revés.',
  },
  // --- Infantil / animación (aptos para perfil infantil: G y PG)
  {
    name: 'Pip y el Dragón de Papel',
    type: 'MOVIE', category: 'Animación', ageRating: 'G',
    synopsis: 'Una niña dibuja un dragón que cobra vida y juntos recorren la ciudad para devolver los colores que se llevó la lluvia.',
  },
  {
    name: 'La Liga de los Calcetines',
    type: 'SERIES', category: 'Infantil', ageRating: 'G',
    synopsis: 'Los calcetines perdidos de una lavandería forman un equipo de aventureros para volver a encontrar a sus parejas.',
  },
];

async function main() {
  const prisma = new PrismaClient();
  const availableFrom = new Date(Date.now() - 24 * 60 * 60 * 1000); // desde ayer
  let created = 0;
  let skipped = 0;

  console.log('Cargando títulos de demostración en catalog_db...\n');
  for (const t of TITLES) {
    const existing = await prisma.title.findFirst({ where: { name: t.name } });
    if (existing) {
      skipped++;
      console.log(`  =  ${t.name}  (ya existía, id ${existing.id})`);
      continue;
    }
    const row = await prisma.title.create({
      data: {
        name: t.name,
        synopsis: t.synopsis,
        type: t.type,
        category: t.category,
        ageRating: t.ageRating,
        status: 'AVAILABLE',
        availabilities: {
          create: [
            { region: 'CO', availableFrom },
            { region: 'MX', availableFrom },
          ],
        },
        seasons:
          t.type === 'SERIES'
            ? {
                create: [
                  {
                    seasonNumber: 1,
                    episodes: {
                      create: [1, 2, 3].map((n) => ({ episodeNumber: n, durationSeconds: 2700 })),
                    },
                  },
                ],
              }
            : undefined,
      },
    });
    created++;
    console.log(`  +  ${t.name}  (id ${row.id}, ${t.category}, ${t.ageRating})`);
  }

  // El listado del catálogo se cachea en Redis 60 s. Como este script
  // escribe directo en la base, limpia esa caché para que los títulos se
  // vean de inmediato (solo las claves del propio catálogo).
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    const keys = await redis.keys('catalog:titles*');
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    console.warn(`\n(No se pudo limpiar la caché de Redis: ${err.message}. Los títulos aparecerán en máximo 60 s.)`);
  } finally {
    redis.disconnect();
  }

  await prisma.$disconnect();
  console.log(`\nListo: ${created} creados, ${skipped} ya existían. Todos AVAILABLE en CO y MX.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
