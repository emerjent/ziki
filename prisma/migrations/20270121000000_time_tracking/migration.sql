-- #time-tracking: time logged against issues, summed from auditable entries.
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "spentOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeEntry_bugId_spentOn_idx" ON "TimeEntry"("bugId", "spentOn");
CREATE INDEX "TimeEntry_userId_spentOn_idx" ON "TimeEntry"("userId", "spentOn");

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_bugId_fkey"
FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
