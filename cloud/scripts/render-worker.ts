/**
 * Entry point for .github/workflows/render-video.yml:  npx tsx scripts/render-worker.ts
 * Configuration comes from the environment; see readWorkerConfig().
 */
import { readWorkerConfig, runRender } from "../src/worker/runRender";

runRender(readWorkerConfig())
  .then((result) => {
    console.log(`[render] Done: ${JSON.stringify(result)}`);
  })
  .catch((error) => {
    console.error(`::error::Render failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
