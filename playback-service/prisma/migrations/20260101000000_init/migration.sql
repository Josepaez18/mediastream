-- CreateTable
CREATE TABLE "watch_progress" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title_id" BIGINT NOT NULL,
    "episode_id" BIGINT,
    "position_seconds" INTEGER NOT NULL,
    "duration_seconds" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "device_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "watch_progress_profile_id_title_id_episode_id_key"
    ON "watch_progress"("profile_id", "title_id", "episode_id");

-- CreateIndex
CREATE INDEX "watch_progress_profile_id_updated_at_idx"
    ON "watch_progress"("profile_id", "updated_at");

-- CreateIndex
CREATE INDEX "watch_progress_title_id_idx" ON "watch_progress"("title_id");
