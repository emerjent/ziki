-- Security checks (#security-checks): an always-on agent collates every part into one posted report.
-- The new enum value is not used in this migration.

ALTER TYPE "SecurityCheckItemKind" ADD VALUE IF NOT EXISTS 'collate';

ALTER TABLE "SecurityCheck" ADD COLUMN "collatingAt" TIMESTAMP(3),
ADD COLUMN "summary" TEXT,
ADD COLUMN "postedAt" TIMESTAMP(3);
