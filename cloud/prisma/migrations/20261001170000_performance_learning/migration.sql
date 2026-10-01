-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "learnFromAnalytics" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "performanceNotes" TEXT,
ADD COLUMN     "performanceNotesAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "commentCount" INTEGER,
ADD COLUMN     "likeCount" INTEGER,
ADD COLUMN     "statsUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "viewCount" INTEGER;
