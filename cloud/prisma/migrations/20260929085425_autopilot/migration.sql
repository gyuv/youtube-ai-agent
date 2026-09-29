-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "autopilot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autopilotLeadHours" INTEGER NOT NULL DEFAULT 36,
ADD COLUMN     "autopilotReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autopilotVisualSource" "VisualSource" NOT NULL DEFAULT 'POLLINATIONS',
ADD COLUMN     "topicBacklog" TEXT;

-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "autopilot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autopilotFailures" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AutopilotEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "channelId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "AutopilotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutopilotEvent_createdAt_idx" ON "AutopilotEvent"("createdAt");

-- CreateIndex
CREATE INDEX "VideoProject_autopilot_status_idx" ON "VideoProject"("autopilot", "status");

-- Keep Supabase's public Data API out, as for the other tables.
ALTER TABLE "AutopilotEvent" ENABLE ROW LEVEL SECURITY;
