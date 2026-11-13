-- When an already-vetted idea became this issue (#vetted-start-now). A vetted issue counts as confirmed and its filer holds it at once.
ALTER TABLE "Bug" ADD COLUMN "vettedAt" TIMESTAMP(3);
