-- AlterEnum
ALTER TYPE "VisualSource" ADD VALUE 'MUAPI';

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "aiClipEngine" TEXT,
ADD COLUMN     "aiClipRequestId" TEXT;
