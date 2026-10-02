-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN "autopilotRetryAt" TIMESTAMP(3);

-- Autopilot projects that gave up only because an outside service refused (e.g. Pollinations 402)
-- go back to autopilot, which now waits and retries instead of stopping.
UPDATE "VideoProject"
SET "autopilotFailures" = 0, "lastError" = NULL, "autopilotRetryAt" = NULL
WHERE "autopilot" = true
  AND "status" = 'FAILED'
  AND "lastError" LIKE 'Autopilot stopped after % failed attempts. Last error: Asset generation failed: %'
  AND ("lastError" LIKE '%Pollinations%' OR "lastError" LIKE '%Pexels%' OR "lastError" LIKE '%rate limit%');
