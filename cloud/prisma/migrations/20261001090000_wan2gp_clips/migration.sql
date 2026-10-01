-- AlterEnum
ALTER TYPE "VisualSource" ADD VALUE 'WAN2GP';

-- CreateEnum
CREATE TYPE "AiClipStatus" AS ENUM ('QUEUED', 'RUNNING', 'FAILED');

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "aiClipError" TEXT,
ADD COLUMN     "aiClipPrompt" TEXT,
ADD COLUMN     "aiClipStatus" "AiClipStatus",
ADD COLUMN     "aiClipUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Scene_aiClipStatus_aiClipUpdatedAt_idx" ON "Scene"("aiClipStatus", "aiClipUpdatedAt");
