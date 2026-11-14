-- #902: starring issues to find them again.

CREATE TABLE "IssueFavorite" (
    "userId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueFavorite_pkey" PRIMARY KEY ("userId","bugId")
);

CREATE INDEX "IssueFavorite_userId_createdAt_idx" ON "IssueFavorite"("userId", "createdAt" DESC);
CREATE INDEX "IssueFavorite_bugId_idx" ON "IssueFavorite"("bugId");

ALTER TABLE "IssueFavorite" ADD CONSTRAINT "IssueFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueFavorite" ADD CONSTRAINT "IssueFavorite_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
