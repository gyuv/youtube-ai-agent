-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "youtubeCheckedAt" TIMESTAMP(3),
ADD COLUMN     "youtubeLocked" BOOLEAN NOT NULL DEFAULT false;
