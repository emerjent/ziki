-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN "publishedUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'ready_to_use',
ADD COLUMN "previousStatus" TEXT,
ADD COLUMN "implementedAt" TIMESTAMP(3),
ADD COLUMN "implementedById" TEXT,
ADD COLUMN "verifiedPublishedAt" TIMESTAMP(3),
ADD COLUMN "verifiedByManagerId" TEXT,
ADD COLUMN "verificationEvidence" JSONB,
ADD COLUMN "manualOverrideReason" TEXT;

-- CreateIndex
CREATE INDEX "Delivery_deliveryStatus_idx" ON "Delivery"("deliveryStatus");

-- CreateIndex
CREATE INDEX "Delivery_verifiedPublishedAt_idx" ON "Delivery"("verifiedPublishedAt");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_implementedById_fkey" FOREIGN KEY ("implementedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_verifiedByManagerId_fkey" FOREIGN KEY ("verifiedByManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
