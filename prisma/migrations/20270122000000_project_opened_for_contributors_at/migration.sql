-- When a project was last opened to contributors (#earnings). Projects already open count from when they were made.
ALTER TABLE "Project" ADD COLUMN "openedForContributorsAt" TIMESTAMP(3);
UPDATE "Project" SET "openedForContributorsAt" = "createdAt" WHERE "isOpenForContributors" = true;
