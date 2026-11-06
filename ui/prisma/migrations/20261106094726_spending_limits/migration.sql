-- AlterTable
ALTER TABLE "Org" ADD COLUMN "spendLimitUsd" REAL;
ALTER TABLE "Org" ADD COLUMN "spendReset" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "spendLimitUsd" REAL;
