const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { KINDS, OpenShortsError, classifyHttpError } = require('./errors');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Thin client for a self-hosted OpenShorts backend.
 *
 * Tool calls go through OpenShorts' own MCP endpoint (POST /mcp, JSON-RPC
 * `tools/call`) rather than the raw REST routes: the MCP layer is what
 * OpenShorts documents for agents, applies the same defaults as its
 * dashboard (hook on, captions on) and normalises clip summaries, so this
 * integration does not drift when its REST internals change.
 */
class OpenShortsClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || process.env.OPENSHORTS_API_URL || 'http://openshorts:8000').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.OPENSHORTS_API_KEY ?? '';
    this.geminiKey = options.geminiKey ?? process.env.OPENSHORTS_GEMINI_API_KEY ?? '';
    this.uploadPostKey = options.uploadPostKey ?? process.env.UPLOAD_POST_API_KEY ?? '';
    this.timeoutMs = Number(options.timeoutMs || process.env.OPENSHORTS_REQUEST_TIMEOUT_MS || 120_000);
    this.maxRetries = Number(options.maxRetries ?? 4);
    this.retryBaseMs = Number(options.retryBaseMs ?? 2_000);
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || sleep;
    this.logger = options.logger || null;
    this.rpcId = 0;
  }

  headers(extra = {}) {
    const headers = { Accept: 'application/json, text/event-stream', ...extra };
    // Self-host is BYOK-open; cloud (app.openshorts) needs an osk_ API key.
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    // Optional per-request keys; without them OpenShorts uses its own env.
    if (this.geminiKey) headers['X-Gemini-Key'] = this.geminiKey;
    if (this.uploadPostKey) headers['X-Upload-Post-Key'] = this.uploadPostKey;
    return headers;
  }

  /** One HTTP request with a timeout; network failures become UNAVAILABLE. */
  async request(pathname, init = {}) {
    try {
      return await this.fetch(`${this.baseUrl}${pathname}`, {
        ...init,
        headers: this.headers(init.headers),
        signal: AbortSignal.timeout(init.timeoutMs || this.timeoutMs)
      });
    } catch (error) {
      throw new OpenShortsError(KINDS.UNAVAILABLE, `Cannot reach OpenShorts at ${this.baseUrl}: ${error.message}`, { cause: error.message });
    }
  }

  /** Retry rate-limited / unavailable calls with exponential backoff + jitter. */
  async withRetry(label, fn) {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof OpenShortsError) || !error.retryable || attempt >= this.maxRetries) throw error;
        const retryAfter = Number(error.details?.retryAfterSeconds) * 1000;
        const backoff = this.retryBaseMs * 2 ** attempt;
        const wait = Math.max(retryAfter || 0, backoff) + Math.floor(Math.random() * 500);
        attempt += 1;
        this.logger?.warn?.(`OpenShorts ${label}: ${error.message} (retry ${attempt}/${this.maxRetries} in ${Math.round(wait / 1000)}s)`);
        await this.sleep(wait);
      }
    }
  }

  /** Call an OpenShorts MCP tool; returns its structured result or throws OpenShortsError. */
  async callTool(name, args = {}) {
    return this.withRetry(name, async () => {
      const res = await this.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcId, method: 'tools/call', params: { name, arguments: args } })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new OpenShortsError(classifyHttpError(res.status, text), `OpenShorts ${name} failed (HTTP ${res.status}): ${text.slice(0, 300)}`, {
          httpStatus: res.status,
          retryAfterSeconds: res.headers.get('retry-after')
        });
      }
      const body = await res.json();
      if (body.error) {
        throw new OpenShortsError(KINDS.REJECTED, `OpenShorts ${name}: ${body.error.message}`, { rpcError: body.error });
      }
      const result = body.result || {};
      const data = result.structuredContent ?? safeParse(result.content?.[0]?.text) ?? {};
      if (result.isError) {
        // get_job_status flags a *failed job* as an error but still returns its
        // status and logs; let the caller see that rather than throwing here.
        if (name === 'get_job_status' && data.status === 'failed') return data;
        const status = Number(data.http_status || 0);
        throw new OpenShortsError(
          status ? classifyHttpError(status, data.error) : KINDS.REJECTED,
          `OpenShorts ${name}: ${data.error || 'tool error'}`,
          { httpStatus: status || undefined, ...data }
        );
      }
      return data;
    });
  }

  processVideo(args) {
    return this.callTool('process_video', args);
  }

  getJobStatus(jobId) {
    return this.callTool('get_job_status', { job_id: jobId });
  }

  listClips(jobId) {
    return this.callTool('list_clips', { job_id: jobId });
  }

  addSubtitles(args) {
    return this.callTool('add_subtitles', args);
  }

  publishClip(args) {
    return this.callTool('publish_clip', args);
  }

  /** Is the backend up? (GET /health) */
  async health() {
    try {
      const res = await this.request('/health', { timeoutMs: 5_000 });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Absolute URL for a clip; OpenShorts returns `/videos/...` unless PUBLIC_API_URL is set. */
  resolveUrl(url) {
    if (!url) return null;
    return /^https?:\/\//i.test(url) ? url : `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  /** Stream one clip MP4 to disk, retrying transient failures. Returns bytes written. */
  async downloadClip(url, destination) {
    const absolute = this.resolveUrl(url);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    return this.withRetry('download', async () => {
      let res;
      try {
        res = await this.fetch(absolute, { headers: this.headers(), signal: AbortSignal.timeout(10 * 60_000) });
      } catch (error) {
        throw new OpenShortsError(KINDS.UNAVAILABLE, `Clip download failed: ${error.message}`);
      }
      if (!res.ok || !res.body) {
        throw new OpenShortsError(classifyHttpError(res.status), `Clip download failed (HTTP ${res.status}) for ${absolute}`, { httpStatus: res.status });
      }
      const partial = `${destination}.part`;
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(partial));
      await fsp.rename(partial, destination);
      return (await fsp.stat(destination)).size;
    });
  }
}

function safeParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

module.exports = { OpenShortsClient };
