-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "autoLabs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "growthReviewAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "labsAppliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LabReport" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "projectId" TEXT,
    "toolId" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT true,
    "summary" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabReport_channelId_createdAt_idx" ON "LabReport"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "LabReport" ADD CONSTRAINT "LabReport_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
