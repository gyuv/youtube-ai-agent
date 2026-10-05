#!/usr/bin/env node
/**
 * Clip a long YouTube video into 9:16 shorts with a self-hosted OpenShorts.
 *
 *   npm run openshorts:clip -- <youtube-url> --confirm-rights [--preset hormozi] [--clips 5] [--low-quality]
 *
 * Prints the downloaded clips as JSON. Needs OPENSHORTS_API_URL (default
 * http://openshorts:8000 inside docker-compose, http://localhost:8000 outside).
 */
require('dotenv').config();
const { OpenShortsWorkflow } = require('../utils/openshorts/workflow');
const { OpenShortsClient } = require('../utils/openshorts/client');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.argv.slice(2).find(a => /^https?:\/\//.test(a));
  if (!url) {
    console.error('Usage: npm run openshorts:clip -- <youtube-url> --confirm-rights [--preset hormozi] [--clips 5] [--low-quality]');
    process.exit(2);
  }
  const logger = { info: m => console.error(m), warn: m => console.error(m), error: m => console.error(m) };
  const client = new OpenShortsClient({ logger });
  if (!(await client.health())) {
    console.error(`OpenShorts is not reachable at ${client.baseUrl}. Start it with: docker compose up -d openshorts`);
    process.exit(1);
  }
  const workflow = new OpenShortsWorkflow({ client, logger });
  const result = await workflow.clipVideo({
    url,
    confirmRights: process.argv.includes('--confirm-rights'),
    subtitlePreset: arg('--preset'),
    targetClips: arg('--clips') ? Number(arg('--clips')) : undefined,
    allowLowQuality: process.argv.includes('--low-quality'),
    onProgress: e => console.error(`· ${e.stage}${e.status ? `: ${e.status}` : ''}${e.clip !== undefined ? ` clip ${e.clip + 1}` : ''}`)
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`✖ ${error.kind ? `[${error.kind}] ` : ''}${error.message}`);
  process.exit(1);
});
