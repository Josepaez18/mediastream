-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountPlan" AS ENUM ('GRATIS', 'BASICO', 'ESTANDAR', 'PREMIUM');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "role" "AccountRole" NOT NULL DEFAULT 'USER',
ADD COLUMN "plan" "AccountPlan" NOT NULL DEFAULT 'GRATIS';
