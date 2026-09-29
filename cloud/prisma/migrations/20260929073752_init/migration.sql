-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'SCRIPTED', 'ASSETS_READY', 'QUEUED_FOR_RENDER', 'RENDERING', 'RENDERED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoFormat" AS ENUM ('SHORT', 'LONG_FORM');

-- CreateEnum
CREATE TYPE "VisualSource" AS ENUM ('POLLINATIONS', 'PEXELS', 'UPLOAD');

-- CreateEnum
CREATE TYPE "PrivacyStatus" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "youtubeChannelId" TEXT,
    "oauthAccessTokenEnc" TEXT,
    "oauthRefreshTokenEnc" TEXT,
    "oauthTokenExpiresAt" TIMESTAMP(3),
    "oauthScopes" TEXT[],
    "niche" TEXT NOT NULL,
    "targetAudience" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "defaultScriptPrompt" TEXT,
    "defaultVisualPrompt" TEXT,
    "defaultVoice" TEXT NOT NULL DEFAULT 'en-US-AriaNeural',
    "defaultFormat" "VideoFormat" NOT NULL DEFAULT 'SHORT',
    "defaultPrivacy" "PrivacyStatus" NOT NULL DEFAULT 'PRIVATE',
    "postingCron" TEXT,
    "postingTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "format" "VideoFormat" NOT NULL DEFAULT 'SHORT',
    "voice" TEXT,
    "script" JSONB,
    "title" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "privacy" "PrivacyStatus" NOT NULL DEFAULT 'PRIVATE',
    "cost" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "renderRunId" TEXT,
    "renderStartedAt" TIMESTAMP(3),
    "renderFinishedAt" TIMESTAMP(3),
    "renderedVideoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "youtubeVideoId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sceneIndex" INTEGER NOT NULL,
    "narrationText" TEXT NOT NULL,
    "voiceAudioUrl" TEXT,
    "wordTimings" JSONB,
    "visualPrompt" TEXT,
    "stockQuery" TEXT,
    "imageUrl" TEXT,
    "videoClipUrl" TEXT,
    "visualSource" "VisualSource" NOT NULL DEFAULT 'POLLINATIONS',
    "durationSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_youtubeChannelId_key" ON "Channel"("youtubeChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProject_youtubeVideoId_key" ON "VideoProject"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "VideoProject_channelId_status_idx" ON "VideoProject"("channelId", "status");

-- CreateIndex
CREATE INDEX "VideoProject_status_scheduledFor_idx" ON "VideoProject"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_projectId_sceneIndex_key" ON "Scene"("projectId", "sceneIndex");

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase exposes the public schema through its Data API (PostgREST). The app only talks to
-- Postgres through Prisma, whose role owns these tables and bypasses RLS, so enabling RLS with
-- no policies closes the Data API without affecting the app.
ALTER TABLE "Channel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VideoProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scene" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
