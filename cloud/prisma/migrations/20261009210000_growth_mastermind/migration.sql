-- CreateEnum
CREATE TYPE "GrowthGoal" AS ENUM ('SUBSCRIBERS', 'VIEWS', 'BALANCED');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "channelStatsAt" TIMESTAMP(3),
ADD COLUMN     "growthGoal" "GrowthGoal" NOT NULL DEFAULT 'BALANCED',
ADD COLUMN     "mastermind" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mastermindAt" TIMESTAMP(3),
ADD COLUMN     "mastermindNotes" TEXT,
ADD COLUMN     "shortsViews90d" INTEGER,
ADD COLUMN     "statsHistory" JSONB,
ADD COLUMN     "subscriberCount" INTEGER,
ADD COLUMN     "totalViews" DOUBLE PRECISION,
ADD COLUMN     "watchHours12m" DOUBLE PRECISION,
ADD COLUMN     "youtubeVideoCount" INTEGER;

-- CreateTable
CREATE TABLE "MastermindRequest" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MastermindRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT,
    "text" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MastermindRequest_channelId_status_idx" ON "MastermindRequest"("channelId", "status");

-- CreateIndex
CREATE INDEX "BrandAsset_channelId_kind_createdAt_idx" ON "BrandAsset"("channelId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "MastermindRequest" ADD CONSTRAINT "MastermindRequest_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAsset" ADD CONSTRAINT "BrandAsset_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

