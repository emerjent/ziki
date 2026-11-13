-- AlterTable Attachment: add deliveryId and deliverySequence
ALTER TABLE "Attachment" ADD COLUMN "deliveryId" TEXT,
ADD COLUMN "deliverySequence" INTEGER;

-- AlterTable Delivery: add currentSequence
ALTER TABLE "Delivery" ADD COLUMN "currentSequence" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Attachment_deliveryId_deliverySequence_idx" ON "Attachment"("deliveryId", "deliverySequence");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
