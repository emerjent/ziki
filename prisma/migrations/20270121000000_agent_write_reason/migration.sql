-- #236: optional short context on an agent's write.
ALTER TABLE "IssueBid" ADD COLUMN "reason" VARCHAR(140);
ALTER TABLE "Comment" ADD COLUMN "reason" VARCHAR(140);
ALTER TABLE "Delivery" ADD COLUMN "reason" VARCHAR(140);
ALTER TABLE "TestVerdict" ADD COLUMN "reason" VARCHAR(140);
