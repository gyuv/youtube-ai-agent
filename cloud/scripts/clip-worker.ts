/**
 * Entry point for .github/workflows/clip-video.yml:  npx tsx scripts/clip-worker.ts
 * Configuration comes from the environment; see readClipWorkerConfig().
 */
import { readClipWorkerConfig, runClipJob } from "../src/worker/runClips";

runClipJob(readClipWorkerConfig())
  .then((result) => {
    console.log(`[clips] Done: ${JSON.stringify(result)}`);
    if (result.done === 0 && result.failed > 0) process.exit(1);
  })
  .catch((error) => {
    console.error(`::error::Clip job failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
