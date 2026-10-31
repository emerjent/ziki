-- Human project members can contribute to the existing project comment feed.
ALTER TABLE "ProjectNoteComment" ALTER COLUMN "agentId" DROP NOT NULL;
