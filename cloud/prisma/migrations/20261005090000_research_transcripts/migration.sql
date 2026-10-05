-- CreateTable
CREATE TABLE "ResearchTranscript" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "actualLang" TEXT NOT NULL,
    "translated" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchTranscript_videoId_language_key" ON "ResearchTranscript"("videoId", "language");
