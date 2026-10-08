-- AlterTable
ALTER TABLE "payments" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'SIMULADO',
ADD COLUMN "external_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_external_id_key" ON "payments"("external_id");
