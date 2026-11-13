CREATE TABLE "SecurityVerification" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "evidenceId" TEXT,
    "passed" BOOLEAN NOT NULL,
    "notes" TEXT NOT NULL,
    "reopened" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityVerification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SecurityVerification_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "SecurityFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SecurityVerification_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SecurityVerification_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SecurityVerification_findingId_createdAt_idx" ON "SecurityVerification"("findingId", "createdAt");
CREATE INDEX "SecurityVerification_reviewerId_idx" ON "SecurityVerification"("reviewerId");
CREATE INDEX "SecurityVerification_evidenceId_idx" ON "SecurityVerification"("evidenceId");
