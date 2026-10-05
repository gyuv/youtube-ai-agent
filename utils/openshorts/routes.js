const crypto = require('crypto');
const { OpenShortsClient } = require('./client');
const { OpenShortsWorkflow, webhookHub } = require('./workflow');
const { OPENSHORTS_TOOLS, createOpenShortsToolExecutor, isOpenShortsTool } = require('./tools');
const { OpenShortsError } = require('./errors');

const MAX_RUNS = 50;

/** Constant-time check of OpenShorts' `X-OpenShorts-Signature: sha256=<hex>` header. */
function verifySignature(rawBody, header, secret) {
  if (!secret) return true;
  if (!rawBody || !header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * HTTP surface for the OpenShorts integration:
 *   GET  /api/openshorts/health            is the backend reachable
 *   GET  /api/openshorts/tools             the tool schemas exposed to the LLM
 *   POST /api/openshorts/tools/:name       run one tool call
 *   POST /api/openshorts/clip              start the full workflow in the background
 *   GET  /api/openshorts/runs/:runId       progress and, when done, the clip assets
 *   POST /api/openshorts/webhook           OpenShorts completion callback (public deployments)
 */
function registerOpenShortsRoutes(app, { protect, logger } = {}) {
  const guard = protect || ((_req, _res, next) => next());
  const client = new OpenShortsClient({ logger });
  const workflow = new OpenShortsWorkflow({ client, logger });
  const execute = createOpenShortsToolExecutor({ client, workflow, logger });
  const runs = new Map();

  app.get('/api/openshorts/health', async (_req, res) => {
    res.json({ success: true, baseUrl: client.baseUrl, reachable: await client.health() });
  });

  app.get('/api/openshorts/tools', (_req, res) => {
    res.json({ success: true, tools: OPENSHORTS_TOOLS });
  });

  app.post('/api/openshorts/tools/:name', guard, async (req, res) => {
    if (!isOpenShortsTool(req.params.name)) {
      return res.status(404).json({ success: false, error: `Unknown tool ${req.params.name}` });
    }
    const outcome = await execute(req.params.name, req.body || {});
    res.status(outcome.ok ? 200 : 502).json({ success: outcome.ok, ...outcome });
  });

  app.post('/api/openshorts/clip', guard, (req, res) => {
    const body = req.body || {};
    if (body.confirmRights !== true) {
      return res.status(400).json({ success: false, error: 'confirmRights must be true: only clip videos you own or have the rights to process.' });
    }
    const runId = crypto.randomUUID();
    const run = { runId, url: body.url, status: 'running', startedAt: new Date().toISOString(), events: [], result: null, error: null };
    runs.set(runId, run);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);

    workflow
      .clipVideo({
        ...body,
        onProgress: event => {
          run.jobId = event.jobId || run.jobId;
          run.events.push({ at: new Date().toISOString(), stage: event.stage, status: event.status, clip: event.clip });
          if (run.events.length > 100) run.events.shift();
        }
      })
      .then(result => {
        run.status = 'completed';
        run.result = result;
      })
      .catch(error => {
        run.status = 'failed';
        run.error = { message: error.message, kind: error instanceof OpenShortsError ? error.kind : 'failed' };
        logger?.error?.(`OpenShorts run ${runId} failed: ${error.message}`);
      })
      .finally(() => {
        run.finishedAt = new Date().toISOString();
      });

    res.status(202).json({ success: true, runId, statusUrl: `/api/openshorts/runs/${runId}` });
  });

  app.get('/api/openshorts/runs/:runId', (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(404).json({ success: false, error: 'Run not found' });
    res.json({ success: true, run });
  });

  app.post('/api/openshorts/webhook', (req, res) => {
    const secret = process.env.OPENSHORTS_WEBHOOK_SECRET || '';
    if (!verifySignature(req.rawBody, req.get('x-openshorts-signature'), secret)) {
      return res.status(401).json({ success: false, error: 'Bad signature' });
    }
    const accepted = webhookHub.deliver(req.body);
    res.json({ success: true, accepted });
  });

  return { client, workflow, execute, runs };
}

module.exports = { registerOpenShortsRoutes, verifySignature };
