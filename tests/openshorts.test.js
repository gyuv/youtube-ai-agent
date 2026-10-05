const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { OpenShortsClient } = require('../utils/openshorts/client');
const { OpenShortsWorkflow, OpenShortsWebhookHub } = require('../utils/openshorts/workflow');
const { KINDS, classifyJobFailure } = require('../utils/openshorts/errors');
const { OPENSHORTS_TOOLS, toOpenAITools, toGeminiFunctionDeclarations, createOpenShortsToolExecutor } = require('../utils/openshorts/tools');
const { verifySignature } = require('../utils/openshorts/routes');

const URL_OK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const noSleep = async () => undefined;

/** A scripted fake of OpenShorts' /mcp and /videos endpoints. */
function fakeOpenShorts(script) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/videos/')) {
      calls.push({ download: u.pathname });
      if (script.download) return script.download(u.pathname);
      return new Response('MP4DATA', { status: 200 });
    }
    const msg = JSON.parse(init.body);
    const { name, arguments: args } = msg.params;
    calls.push({ name, args });
    const reply = script[name](args, calls);
    if (reply instanceof Response) return reply;
    const { data, isError = false } = reply;
    return Response.json({ jsonrpc: '2.0', id: msg.id, result: { structuredContent: data, isError, content: [{ type: 'text', text: JSON.stringify(data) }] } });
  };
  return { fetch, calls };
}

function setup(script, opts = {}) {
  const fake = fakeOpenShorts(script);
  const client = new OpenShortsClient({ baseUrl: 'http://openshorts:8000', fetch: fake.fetch, sleep: noSleep, retryBaseMs: 1, ...opts.client });
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openshorts-'));
  const workflow = new OpenShortsWorkflow({ client, dataRoot, sleep: noSleep, webhookUrl: '', settings: { pollIntervalMs: 1 }, ...opts.workflow });
  return { ...fake, client, workflow, dataRoot };
}

const clip = (index, extra = {}) => ({ index, title: `Clip ${index}`, duration_seconds: 30, video_url: `/videos/job-1/clip_${index}.mp4`, youtube_title: `YT ${index}`, ...extra });

test('submits, polls until completed and downloads every 9:16 clip', async () => {
  let polls = 0;
  const { workflow, calls, dataRoot } = setup({
    process_video: () => ({ data: { job_id: 'job-1', status: 'queued' } }),
    get_job_status: () => (++polls < 3 ? { data: { status: 'processing', recent_logs: [] } } : { data: { status: 'completed', clips: [clip(0), clip(1)] } })
  });

  const result = await workflow.clipVideo({ url: URL_OK, confirmRights: true, hookStyle: 'yellow' });

  assert.equal(result.jobId, 'job-1');
  assert.equal(result.clips.length, 2);
  assert.equal(result.clips[0].url, 'http://openshorts:8000/videos/job-1/clip_0.mp4');
  assert.equal(result.clips[1].localPath, path.join(dataRoot, 'job-1', 'clip-02.mp4'));
  assert.equal(fs.readFileSync(result.clips[1].localPath, 'utf8'), 'MP4DATA');
  const submit = calls.find(c => c.name === 'process_video').args;
  assert.equal(submit.source_url, URL_OK);
  assert.equal(submit.confirm_rights, true);
  assert.equal(submit.output_format, 'vertical');
  assert.equal(submit.hook_style, 'yellow');
  assert.equal(polls, 3);
});

test('refuses to run without confirmed rights or with a non-YouTube URL', async () => {
  const { workflow } = setup({});
  await assert.rejects(workflow.clipVideo({ url: URL_OK }), /confirmRights/);
  await assert.rejects(workflow.clipVideo({ url: 'https://vimeo.com/1', confirmRights: true }), /YouTube/);
});

test('backs off and retries when OpenShorts answers 429', async () => {
  let attempts = 0;
  const { workflow } = setup({
    process_video: () => (++attempts < 3 ? new Response('Too many requests this hour', { status: 429 }) : { data: { job_id: 'job-1' } }),
    get_job_status: () => ({ data: { status: 'completed', clips: [clip(0)] } })
  });
  const result = await workflow.clipVideo({ url: URL_OK, confirmRights: true, download: false });
  assert.equal(attempts, 3);
  assert.equal(result.clips.length, 1);
});

test('retries a failed YouTube download once, then explains the cookie fix', async () => {
  let submits = 0;
  const { workflow } = setup({
    process_video: () => ({ data: { job_id: `job-${++submits}` } }),
    get_job_status: () => ({ data: { status: 'failed', recent_logs: ['ERROR: [youtube] Sign in to confirm you’re not a bot'] }, isError: true })
  });
  await assert.rejects(workflow.clipVideo({ url: URL_OK, confirmRights: true }), err => {
    assert.equal(err.kind, KINDS.DOWNLOAD_FAILED);
    assert.match(err.message, /YOUTUBE_COOKIES/);
    assert.deepEqual(err.details.attempts, ['job-1', 'job-2']);
    return true;
  });
  assert.equal(submits, 2);
});

test('drops face-dependent layouts when face tracking fails', async () => {
  const submitted = [];
  const { workflow } = setup({
    process_video: args => {
      submitted.push(args.layouts);
      return { data: { job_id: `job-${submitted.length}` } };
    },
    get_job_status: (args) =>
      args.job_id === 'job-1'
        ? { data: { status: 'failed', recent_logs: ['speaker_cut: no face detected in any sampled frame'] }, isError: true }
        : { data: { status: 'completed', clips: [clip(0)] } }
  });
  const result = await workflow.clipVideo({ url: URL_OK, confirmRights: true, layouts: ['speaker_cut'], download: false });
  assert.deepEqual(submitted, [['speaker_cut'], []]);
  assert.match(result.fallbacks[0], /Face tracking failed/);
});

test('surfaces the low-quality gate instead of silently lowering quality', async () => {
  const { workflow } = setup({ process_video: () => ({ data: { needs_confirmation: true, height: 480 } }) });
  await assert.rejects(workflow.clipVideo({ url: URL_OK, confirmRights: true }), err => err.kind === KINDS.LOW_QUALITY && /480p/.test(err.message));
});

test('restyles captions with a preset and re-reads the clips', async () => {
  const { workflow, calls } = setup({
    process_video: () => ({ data: { job_id: 'job-1' } }),
    get_job_status: () => ({ data: { status: 'completed', clips: [clip(0), clip(1)] } }),
    add_subtitles: args => (args.clip_index === 1 ? { data: { error: 'boom', http_status: 500 }, isError: true } : { data: { ok: true } }),
    list_clips: () => ({ data: { job_id: 'job-1', clips: [clip(0, { video_url: '/videos/job-1/subtitled_clip_0.mp4' }), clip(1)] } })
  });
  const result = await workflow.clipVideo({ url: URL_OK, confirmRights: true, subtitlePreset: 'hormozi', download: false });
  assert.equal(calls.filter(c => c.name === 'add_subtitles').length >= 2, true);
  assert.match(result.clips[0].url, /subtitled_clip_0/);
  assert.match(result.fallbacks[0], /kept the default captions/);
});

test('one failed download keeps the other clips', async () => {
  const { workflow } = setup({
    process_video: () => ({ data: { job_id: 'job-1' } }),
    get_job_status: () => ({ data: { status: 'completed', clips: [clip(0), clip(1)] } }),
    download: p => (p.endsWith('clip_1.mp4') ? new Response('gone', { status: 404 }) : new Response('MP4DATA'))
  });
  const result = await workflow.clipVideo({ url: URL_OK, confirmRights: true });
  assert.ok(result.clips[0].localPath);
  assert.match(result.clips[1].downloadError, /404/);
});

test('times out with a resumable error', async () => {
  let t = 0;
  const { workflow } = setup(
    { process_video: () => ({ data: { job_id: 'job-1' } }), get_job_status: () => ({ data: { status: 'processing' } }) },
    { workflow: { now: () => (t += 60_000), settings: { pollIntervalMs: 1, timeoutMs: 5 * 60_000 } } }
  );
  await assert.rejects(workflow.clipVideo({ url: URL_OK, confirmRights: true }), err => err.kind === KINDS.TIMEOUT && /get_job_status/.test(err.message));
});

test('a webhook delivery ends the wait early', async () => {
  const hub = new OpenShortsWebhookHub();
  let polls = 0;
  const { workflow } = setup(
    {
      process_video: () => ({ data: { job_id: 'job-1' } }),
      get_job_status: () => (++polls === 1 ? { data: { status: 'processing' } } : { data: { status: 'completed', clips: [clip(0)] } })
    },
    { workflow: { webhookHub: hub, webhookUrl: 'https://agent.example.com/api/openshorts/webhook', sleep: () => new Promise(() => {}), settings: { pollIntervalMs: 1 } } }
  );
  const running = workflow.clipVideo({ url: URL_OK, confirmRights: true, download: false });
  await new Promise(r => setImmediate(r));
  assert.equal(hub.deliver({ event: 'job.completed', job_id: 'job-1' }), true);
  const result = await running;
  assert.equal(result.clips.length, 1);
});

test('tool executor returns errors to the model instead of throwing', async () => {
  const { client } = setup({ get_job_status: () => ({ data: { error: 'Job not found', http_status: 404 }, isError: true }) });
  const execute = createOpenShortsToolExecutor({ client });
  const out = await execute('get_job_status', { job_id: 'nope' });
  assert.equal(out.ok, false);
  assert.equal(out.kind, KINDS.NOT_FOUND);
  assert.equal((await execute('nope', {})).ok, false);
});

test('tool schemas convert for OpenAI and Gemini', () => {
  const names = OPENSHORTS_TOOLS.map(t => t.name);
  for (const n of ['process_video', 'get_job_status', 'list_clips', 'publish_clip']) assert.ok(names.includes(n));
  assert.equal(toOpenAITools()[0].type, 'function');
  assert.ok(toGeminiFunctionDeclarations()[0].parametersJsonSchema.properties.source_url);
});

test('classifies failures and verifies webhook signatures', () => {
  assert.equal(classifyJobFailure('yt-dlp: HTTP Error 403'), KINDS.DOWNLOAD_FAILED);
  assert.equal(classifyJobFailure('MediaPipe found no face'), KINDS.REFRAME_FAILED);
  assert.equal(classifyJobFailure('429 RESOURCE_EXHAUSTED'), KINDS.RATE_LIMITED);
  const body = Buffer.from('{"job_id":"x"}');
  const sig = `sha256=${crypto.createHmac('sha256', 's3cret').update(body).digest('hex')}`;
  assert.equal(verifySignature(body, sig, 's3cret'), true);
  assert.equal(verifySignature(body, sig, 'other'), false);
  assert.equal(verifySignature(body, undefined, 's3cret'), false);
});
