-- CreateEnum
CREATE TYPE "TitleType" AS ENUM ('MOVIE', 'SERIES');

-- CreateEnum
CREATE TYPE "TitleStatus" AS ENUM ('PENDING', 'AVAILABLE', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "title" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "synopsis" TEXT,
    "type" "TitleType" NOT NULL,
    "status" "TitleStatus" NOT NULL DEFAULT 'PENDING',
    "category" TEXT,
    "age_rating" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season" (
    "id" BIGSERIAL NOT NULL,
    "title_id" BIGINT NOT NULL,
    "season_number" INTEGER NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode" (
    "id" BIGSERIAL NOT NULL,
    "season_id" BIGINT NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "duration_seconds" INTEGER,

    CONSTRAINT "episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability" (
    "id" BIGSERIAL NOT NULL,
    "title_id" BIGINT NOT NULL,
    "region" TEXT NOT NULL,
    "available_from" TIMESTAMP(3) NOT NULL,
    "available_until" TIMESTAMP(3),

    CONSTRAINT "availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "title_status_idx" ON "title"("status");

-- CreateIndex
CREATE INDEX "season_title_id_idx" ON "season"("title_id");

-- CreateIndex
CREATE INDEX "episode_season_id_idx" ON "episode"("season_id");

-- CreateIndex
CREATE INDEX "availability_title_id_region_idx" ON "availability"("title_id", "region");

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_title_id_fkey"
    FOREIGN KEY ("title_id") REFERENCES "title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode" ADD CONSTRAINT "episode_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability" ADD CONSTRAINT "availability_title_id_fkey"
    FOREIGN KEY ("title_id") REFERENCES "title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
