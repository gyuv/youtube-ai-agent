/**
 * Error kinds the OpenShorts integration can recover from, and how.
 *
 * OpenShorts reports failures as an HTTP status (REST/MCP transport) or as a
 * failed job whose log tail says what went wrong. Both are folded into one
 * `kind` so the workflow can decide: retry later, retry differently, or stop.
 */

const KINDS = {
  RATE_LIMITED: 'rate_limited', // 429: per-IP limit or too many jobs; retry after a pause
  UNAVAILABLE: 'unavailable', // network error / 5xx / OpenShorts restarting; retry
  DOWNLOAD_FAILED: 'download_failed', // yt-dlp could not fetch the source
  REFRAME_FAILED: 'reframe_failed', // face/person tracking or a face-based layout failed
  LOW_QUALITY: 'low_quality', // below the quality gate; needs force_low_quality
  NOT_FOUND: 'not_found', // job id unknown (expired or wrong instance)
  CONFIG: 'config', // missing Gemini / Upload-Post key, YouTube ingest disabled
  REJECTED: 'rejected', // other 4xx: bad input, rights not confirmed
  TIMEOUT: 'timeout', // job did not finish within the polling budget
  FAILED: 'failed' // the job failed for a reason we can't classify
};

class OpenShortsError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'OpenShortsError';
    this.kind = kind;
    this.details = details;
  }

  /** Worth trying the same request again after a pause. */
  get retryable() {
    return this.kind === KINDS.RATE_LIMITED || this.kind === KINDS.UNAVAILABLE;
  }
}

const DOWNLOAD_PATTERNS = [
  /yt-dlp/i,
  /sign in to confirm/i,
  /not a bot/i,
  /video unavailable/i,
  /private video/i,
  /download(ing)? (failed|error)/i,
  /unable to download/i,
  /http error 403/i,
  /requested format is not available/i,
  /no video formats/i
];

const REFRAME_PATTERNS = [
  /no face/i,
  /face (detection|tracking)/i,
  /mediapipe/i,
  /active.?speaker/i,
  /reframe/i,
  /speaker_cut/i,
  /split layout/i,
  /yolo/i
];

const QUOTA_PATTERNS = [/quota/i, /rate.?limit/i, /429/, /too many requests/i, /resource.?exhausted/i];

/** Classify a failed job from the error text / log tail OpenShorts returns. */
function classifyJobFailure(text = '') {
  const haystack = String(text);
  if (DOWNLOAD_PATTERNS.some(re => re.test(haystack))) return KINDS.DOWNLOAD_FAILED;
  if (REFRAME_PATTERNS.some(re => re.test(haystack))) return KINDS.REFRAME_FAILED;
  if (QUOTA_PATTERNS.some(re => re.test(haystack))) return KINDS.RATE_LIMITED;
  return KINDS.FAILED;
}

/** Classify an HTTP-level error answer from the REST or MCP endpoint. */
function classifyHttpError(status, detail = '') {
  const text = String(detail || '');
  if (status === 429) return KINDS.RATE_LIMITED;
  if (status === 402 || /quota/i.test(text)) return KINDS.RATE_LIMITED;
  if (status === 404) return KINDS.NOT_FOUND;
  if (status === 401 || status === 403 || /gemini|api key|upload-post/i.test(text)) return KINDS.CONFIG;
  if (status >= 500 || status === 0) return KINDS.UNAVAILABLE;
  return KINDS.REJECTED;
}

module.exports = { KINDS, OpenShortsError, classifyJobFailure, classifyHttpError };
