const path = require('path');
const { OpenShortsClient } = require('./client');
const { KINDS, OpenShortsError, classifyJobFailure } = require('./errors');

const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)/i;
const TERMINAL = new Set(['completed', 'failed']);

const DEFAULTS = {
  pollIntervalMs: 30_000, // OpenShorts asks agents to poll every 30-60 s
  maxPollIntervalMs: 60_000,
  timeoutMs: 45 * 60_000, // a long video on CPU can take a while
  downloadRetryDelayMs: 60_000,
  rateLimitRetryDelayMs: 5 * 60_000
};

/**
 * Webhook receiver shared by the HTTP route and running workflows.
 *
 * Note: OpenShorts only delivers to *public* URLs (it refuses private and
 * Docker-network addresses), so inside docker-compose polling is the
 * transport; set OPENSHORTS_WEBHOOK_URL only when the agent is reachable
 * from the internet. Polling still runs (slower) as a safety net.
 */
class OpenShortsWebhookHub {
  constructor() {
    this.waiters = new Map();
  }

  wait(jobId) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    this.waiters.set(jobId, resolve);
    return { promise, cancel: () => this.waiters.delete(jobId) };
  }

  /** Called by the webhook route with OpenShorts' payload ({ event, job_id, status, clips, error }). */
  deliver(payload) {
    const resolve = payload && this.waiters.get(payload.job_id);
    if (!resolve) return false;
    this.waiters.delete(payload.job_id);
    resolve(payload);
    return true;
  }
}

const webhookHub = new OpenShortsWebhookHub();

class OpenShortsWorkflow {
  constructor(options = {}) {
    this.client = options.client || new OpenShortsClient({ logger: options.logger });
    this.logger = options.logger || null;
    this.hub = options.webhookHub || webhookHub;
    this.dataRoot = options.dataRoot || path.join(__dirname, '..', '..', 'data', 'openshorts');
    this.webhookUrl = options.webhookUrl ?? process.env.OPENSHORTS_WEBHOOK_URL ?? '';
    this.webhookSecret = options.webhookSecret ?? process.env.OPENSHORTS_WEBHOOK_SECRET ?? '';
    this.settings = { ...DEFAULTS, ...options.settings };
    this.sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.now = options.now || (() => Date.now());
  }

  log(level, message) {
    this.logger?.[level]?.(`[OpenShorts] ${message}`);
  }

  /**
   * Turn a long YouTube video into downloaded 9:16 shorts.
   *
   * @param {object} input
   * @param {string} input.url               long-form YouTube URL
   * @param {boolean} input.confirmRights    the user owns the video or has rights to clip it (required)
   * @param {boolean} [input.captions=true]  burn word-level captions
   * @param {string}  [input.subtitlePreset] restyle captions after rendering (hormozi, pill, lime, oneword, clean)
   * @param {boolean} [input.autoHook=true]  burn the AI hook line over the first seconds
   * @param {string}  [input.hookStyle]      classic | dark | yellow | red | outline | outline_yellow
   * @param {number}  [input.targetClips]    1-15, a target not a guarantee
   * @param {number}  [input.clipMinSeconds] default 15
   * @param {number}  [input.clipMaxSeconds] default 60
   * @param {string[]} [input.layouts]       extra layouts: auto, split, screencast, speaker_cut, punch_in
   * @param {boolean} [input.allowLowQuality=false] continue below OpenShorts' 720p quality gate
   * @param {boolean} [input.download=true]  save MP4s under data/openshorts/<job_id>/
   * @param {function} [input.onProgress]    ({ stage, jobId, status, logs }) => void
   * @returns {Promise<{jobId, attempts, fallbacks, clips}>}
   */
  async clipVideo(input = {}) {
    const url = String(input.url || '').trim();
    if (!YOUTUBE_URL.test(url)) {
      throw new OpenShortsError(KINDS.REJECTED, 'Give a YouTube watch, youtu.be, shorts or live URL.');
    }
    if (input.confirmRights !== true) {
      throw new OpenShortsError(KINDS.REJECTED, 'confirmRights must be true: only clip videos you own or have the rights to process.');
    }

    const request = {
      source_url: url,
      confirm_rights: true,
      output_format: 'vertical',
      captions: input.captions ?? true,
      auto_hook: input.autoHook ?? true,
      ...(input.hookStyle ? { hook_style: input.hookStyle } : {}),
      ...(input.targetClips ? { target_clips: Number(input.targetClips) } : {}),
      ...(input.clipMinSeconds ? { clip_min_seconds: Number(input.clipMinSeconds) } : {}),
      ...(input.clipMaxSeconds ? { clip_max_seconds: Number(input.clipMaxSeconds) } : {}),
      layouts: Array.isArray(input.layouts) ? input.layouts : [],
      force_low_quality: Boolean(input.allowLowQuality)
    };
    const progress = typeof input.onProgress === 'function' ? input.onProgress : () => {};
    const fallbacks = [];
    const attempts = [];
    const tried = new Set();

    for (;;) {
      const jobId = await this.submit(request);
      attempts.push(jobId);
      progress({ stage: 'submitted', jobId });

      const outcome = await this.waitForJob(jobId, progress);
      if (outcome.status === 'completed') {
        let clips = outcome.clips;
        if (input.subtitlePreset && input.subtitlePreset !== 'default' && request.captions) {
          clips = await this.restyleCaptions(jobId, clips, input.subtitlePreset, fallbacks);
        }
        if (!clips.length) {
          throw new OpenShortsError(KINDS.FAILED, 'OpenShorts finished but found no clip-worthy moments in this video.', { jobId });
        }
        const assets = input.download === false ? clips.map(c => this.toAsset(jobId, c)) : await this.downloadAll(jobId, clips, progress);
        progress({ stage: 'done', jobId });
        return { jobId, attempts, fallbacks, clips: assets };
      }

      // The job failed: decide whether a different request can succeed.
      const kind = classifyJobFailure(outcome.error);
      const reason = outcome.error || 'unknown error';
      this.log('warn', `job ${jobId} failed (${kind}): ${reason.slice(0, 200)}`);

      if (kind === KINDS.REFRAME_FAILED && request.layouts.length && !tried.has(kind)) {
        // Face-dependent layouts (split, speaker_cut...) need a detectable
        // face. Drop them: the default tracker falls back from MediaPipe faces
        // to YOLO person detection to a centre crop on its own.
        tried.add(kind);
        fallbacks.push(`Face tracking failed with layouts [${request.layouts.join(', ')}]; retried with the default subject-tracking crop.`);
        request.layouts = [];
        continue;
      }
      if (kind === KINDS.DOWNLOAD_FAILED && !tried.has(kind)) {
        // OpenShorts rotates yt-dlp clients and proxy routes between attempts;
        // one delayed retry clears most transient YouTube refusals.
        tried.add(kind);
        fallbacks.push('YouTube refused the download; retried once after a pause.');
        await this.sleep(this.settings.downloadRetryDelayMs);
        continue;
      }
      if (kind === KINDS.RATE_LIMITED && !tried.has(kind)) {
        tried.add(kind);
        fallbacks.push('Gemini or OpenShorts was rate-limited; retried after a pause.');
        await this.sleep(this.settings.rateLimitRetryDelayMs);
        continue;
      }

      const hint = {
        [KINDS.DOWNLOAD_FAILED]: ' YouTube blocked the download. Set YOUTUBE_COOKIES on the OpenShorts container, or download the video yourself and upload it.',
        [KINDS.REFRAME_FAILED]: ' The video may have no visible person to track; try layouts=[] or a horizontal output.',
        [KINDS.RATE_LIMITED]: ' Gemini quota or OpenShorts rate limit hit twice; try again later.'
      }[kind] || '';
      throw new OpenShortsError(kind, `OpenShorts job ${jobId} failed: ${reason.slice(0, 500)}.${hint}`, { jobId, attempts, fallbacks });
    }
  }

  async submit(request) {
    const data = await this.client.processVideo({
      ...request,
      ...(this.webhookUrl ? { webhook_url: this.webhookUrl } : {}),
      ...(this.webhookUrl && this.webhookSecret ? { webhook_secret: this.webhookSecret } : {})
    });
    if (data.needs_confirmation) {
      throw new OpenShortsError(
        KINDS.LOW_QUALITY,
        `The source is below OpenShorts' quality gate${data.height ? ` (${data.height}p)` : ''}. Re-run with allowLowQuality=true to clip it anyway.`,
        data
      );
    }
    if (!data.job_id) throw new OpenShortsError(KINDS.FAILED, 'OpenShorts did not return a job id.', data);
    this.log('info', `submitted ${request.source_url} as job ${data.job_id}`);
    return data.job_id;
  }

  /**
   * Poll get_job_status until the job is terminal (with a webhook, wait for
   * whichever comes first). Returns { status, clips, error }.
   */
  async waitForJob(jobId, progress = () => {}) {
    const deadline = this.now() + this.settings.timeoutMs;
    const hook = this.webhookUrl ? this.hub.wait(jobId) : null;
    let interval = this.settings.pollIntervalMs;
    let pending = hook?.promise || null;
    let lastStatus = null;
    try {
      while (this.now() < deadline) {
        let status;
        try {
          status = await this.client.getJobStatus(jobId);
        } catch (error) {
          // The client already retried transient errors; a 404 here means the
          // backend restarted without its job, which is final.
          if (error.kind === KINDS.NOT_FOUND) throw new OpenShortsError(KINDS.NOT_FOUND, `OpenShorts lost job ${jobId} (restarted?). Submit it again.`, { jobId });
          throw error;
        }
        if (status.status !== lastStatus) {
          lastStatus = status.status;
          progress({ stage: 'status', jobId, status: status.status, logs: status.recent_logs || [] });
        }
        if (TERMINAL.has(status.status)) {
          return {
            status: status.status,
            clips: status.clips || [],
            error: (status.recent_logs || []).join('\n')
          };
        }
        const delivered = await (pending ? Promise.race([pending, this.sleep(interval)]) : this.sleep(interval));
        if (delivered && delivered.job_id === jobId) {
          // Re-read through the API so clip URLs are in the usual shape; the
          // webhook fires once, so from here on only polling is left.
          pending = null;
          continue;
        }
        interval = Math.min(this.settings.maxPollIntervalMs, Math.round(interval * 1.25));
      }
    } finally {
      hook?.cancel();
    }
    throw new OpenShortsError(KINDS.TIMEOUT, `OpenShorts job ${jobId} did not finish within ${Math.round(this.settings.timeoutMs / 60_000)} minutes. It may still complete: check it with get_job_status.`, { jobId });
  }

  /** Restyle every clip's captions; a clip that fails keeps the default captions. */
  async restyleCaptions(jobId, clips, preset, fallbacks) {
    let failed = 0;
    for (const clip of clips) {
      try {
        await this.client.addSubtitles({ job_id: jobId, clip_index: clip.index, preset });
      } catch (error) {
        failed += 1;
        this.log('warn', `caption preset "${preset}" failed on clip ${clip.index}: ${error.message}`);
      }
    }
    if (failed) fallbacks.push(`${failed} clip(s) kept the default captions because the "${preset}" restyle failed.`);
    const refreshed = await this.client.listClips(jobId);
    return refreshed.clips || clips;
  }

  toAsset(jobId, clip, extra = {}) {
    return {
      jobId,
      index: clip.index,
      title: clip.title || clip.youtube_title || `Clip ${clip.index + 1}`,
      youtubeTitle: clip.youtube_title || clip.title || null,
      tiktokDescription: clip.tiktok_description || null,
      instagramDescription: clip.instagram_description || null,
      durationSeconds: clip.duration_seconds ?? null,
      aspectRatio: '9:16',
      url: this.client.resolveUrl(clip.video_url),
      localPath: null,
      ...extra
    };
  }

  /** Download every clip; one failed download doesn't sink the others. */
  async downloadAll(jobId, clips, progress) {
    const assets = [];
    for (const clip of clips) {
      const file = path.join(this.dataRoot, jobId, `clip-${String(clip.index + 1).padStart(2, '0')}.mp4`);
      try {
        const bytes = await this.client.downloadClip(clip.video_url, file);
        assets.push(this.toAsset(jobId, clip, { localPath: file, bytes }));
        progress({ stage: 'downloaded', jobId, clip: clip.index });
      } catch (error) {
        this.log('warn', `clip ${clip.index} download failed: ${error.message}`);
        assets.push(this.toAsset(jobId, clip, { downloadError: error.message }));
      }
    }
    if (assets.every(a => a.downloadError)) {
      throw new OpenShortsError(KINDS.UNAVAILABLE, `OpenShorts rendered the clips but none could be downloaded from ${this.client.baseUrl}.`, { jobId, clips: assets });
    }
    return assets;
  }
}

module.exports = { OpenShortsWorkflow, OpenShortsWebhookHub, webhookHub, YOUTUBE_URL };
