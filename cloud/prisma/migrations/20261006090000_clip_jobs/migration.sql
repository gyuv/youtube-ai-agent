-- CreateEnum
CREATE TYPE "ClipJobStatus" AS ENUM ('REVIEW', 'RENDERING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ClipJob" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "status" "ClipJobStatus" NOT NULL DEFAULT 'REVIEW',
    "moments" JSONB NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'crop',
    "burnCaptions" BOOLEAN NOT NULL DEFAULT true,
    "momentSource" TEXT NOT NULL DEFAULT 'transcript',
    "renderRunId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipJob_channelId_createdAt_idx" ON "ClipJob"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClipJob" ADD CONSTRAINT "ClipJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
