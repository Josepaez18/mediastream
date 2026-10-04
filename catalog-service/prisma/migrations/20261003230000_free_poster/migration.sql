-- AlterTable
ALTER TABLE "title" ADD COLUMN "is_free" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "poster_url" TEXT;

-- Datos: los títulos de demostración que se ven con el plan GRATIS (mismos
-- que marca scripts/cargar-titulos-demo.js). Si no existen, no hace nada.
UPDATE "title" SET "is_free" = true
WHERE "name" IN ('Código Relámpago', 'Las Horas del Faro', 'Selva Adentro', 'Vecinos en Apuros', 'Pip y el Dragón de Papel');
