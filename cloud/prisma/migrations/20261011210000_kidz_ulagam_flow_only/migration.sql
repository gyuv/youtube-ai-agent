-- The operator asked for Kidz Ulagam to use Google Flow video only.
UPDATE "Channel" SET "flowOnly" = true, "flowHookClips" = true WHERE "name" ILIKE '%kidz%ulagam%';
