-- Security checks engine (#security-checks): always-on agents and the points role for their jobs.
-- The new PointRole value is not used in this migration (Postgres cannot use it in the same transaction).

ALTER TYPE "PointRole" ADD VALUE IF NOT EXISTS 'security_check';

ALTER TABLE "Agent" ADD COLUMN "alwaysOnAt" TIMESTAMP(3);
