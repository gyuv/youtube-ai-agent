-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "brandFrame" BOOLEAN NOT NULL DEFAULT false;

-- The operator asked for the branded frame, intro and outro on Kidz Ulagam.
UPDATE "Channel" SET "brandFrame" = true WHERE "name" ILIKE '%kidz%ulagam%';
