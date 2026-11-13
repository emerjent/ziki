-- Marketing notes and credential vault (docs/marketing-notes-and-vault.md).
-- Additive only: two new tables. Existing rows are untouched.

-- CreateTable
CREATE TABLE "MarketingCredential" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "serviceUrl" TEXT,
    "sealed" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCredentialGrant" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCredentialGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingCredential_projectId_revokedAt_idx" ON "MarketingCredential"("projectId", "revokedAt");

-- CreateIndex
CREATE INDEX "MarketingCredential_organisationId_idx" ON "MarketingCredential"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCredentialGrant_credentialId_bugId_key" ON "MarketingCredentialGrant"("credentialId", "bugId");

-- CreateIndex
CREATE INDEX "MarketingCredentialGrant_bugId_idx" ON "MarketingCredentialGrant"("bugId");

-- AddForeignKey
ALTER TABLE "MarketingCredential" ADD CONSTRAINT "MarketingCredential_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCredentialGrant" ADD CONSTRAINT "MarketingCredentialGrant_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "MarketingCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCredentialGrant" ADD CONSTRAINT "MarketingCredentialGrant_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
