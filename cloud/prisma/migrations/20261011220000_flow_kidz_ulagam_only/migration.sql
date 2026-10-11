-- The operator wants Google Flow on Kidz Ulagam only.
UPDATE "Channel" SET "flowOnly" = false, "flowHookClips" = false WHERE "name" NOT ILIKE '%kidz%ulagam%';
