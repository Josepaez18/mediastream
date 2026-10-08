/**
 * Carga el catálogo de demostración: películas y series reales, cada una con
 * su póster, categoría, clasificación, regiones y (las series) sus temporadas
 * y episodios. Los datos están en scripts/titulos-demo.json; los marcados con
 * "isFree" se ven con el plan GRATIS.
 *
 * Escribe en la base de datos PROPIA de Catalog-Service (catalog_db): cada
 * servicio carga sus propios datos. Es idempotente: si ya existe un título con
 * el mismo nombre, solo le completa la imagen y la marca de gratis.
 *
 * Uso (desde la carpeta MediaStream):
 *   docker compose exec catalog-service node scripts/cargar-titulos-demo.js
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const TITLES = require(path.join(__dirname, 'titulos-demo.json'));

async function main() {
  const prisma = new PrismaClient();
  const availableFrom = new Date(Date.now() - 24 * 60 * 60 * 1000); // desde ayer
  let created = 0;
  let updated = 0;
  let skipped = 0;

  console.log(`Cargando ${TITLES.length} títulos de demostración en catalog_db...\n`);
  for (const t of TITLES) {
    const existing = await prisma.title.findFirst({ where: { name: t.name } });
    if (existing) {
      if (existing.posterUrl !== t.posterUrl || existing.isFree !== t.isFree) {
        await prisma.title.update({ where: { id: existing.id }, data: { posterUrl: t.posterUrl, isFree: t.isFree } });
        updated++;
        console.log(`  ~  ${t.name}  (id ${existing.id}: imagen/gratis actualizados)`);
      } else {
        skipped++;
      }
      continue;
    }
    const row = await prisma.title.create({
      data: {
        name: t.name,
        synopsis: t.synopsis,
        type: t.type,
        category: t.category,
        ageRating: t.ageRating,
        isFree: t.isFree,
        posterUrl: t.posterUrl,
        status: 'AVAILABLE',
        availabilities: {
          create: (t.regions || ['CO', 'MX']).map((region) => ({ region, availableFrom })),
        },
        seasons: t.seasons
          ? {
              create: t.seasons.map((s) => ({
                seasonNumber: s.seasonNumber,
                episodes: { create: s.episodes.map((e) => ({ episodeNumber: e.episodeNumber, durationSeconds: e.durationSeconds })) },
              })),
            }
          : undefined,
      },
    });
    created++;
    console.log(`  +  ${t.name}  (id ${row.id}, ${t.type === 'SERIES' ? 'serie' : 'película'}, ${t.category}${t.isFree ? ', gratis' : ''})`);
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
  console.log(`\nListo: ${created} creados, ${updated} actualizados, ${skipped} sin cambios.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
