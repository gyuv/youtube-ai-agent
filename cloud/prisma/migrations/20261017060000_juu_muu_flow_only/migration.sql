-- The operator asked for Juu-Muu to use Google Flow only, from its own Google Flow account.
UPDATE "Channel" SET "flowOnly" = true, "flowHookClips" = true, "brandFrame" = true WHERE "name" = 'Juu-Muu';

-- Reserve Juu-Muu for its dedicated worker right away (offline until it first checks in), so the shared worker
-- never spends the Kidz Ulagam account's credits on Juu-Muu clips.
INSERT INTO "WorkerHeartbeat" ("engine", "seenAt", "creditsLeft")
VALUES ('FLOW:Juu-Muu', '1970-01-01T00:00:00Z', NULL)
ON CONFLICT ("engine") DO NOTHING;
