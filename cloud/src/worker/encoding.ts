import type { VideoFormat } from "../../remotion/timeline";

/**
 * x264 settings for the final mp4: constant quality (CRF) with a hard bitrate ceiling. The
 * ceiling is the smaller of a sensible 1080p maximum and whatever still fits the storage
 * backend's object-size limit (50 MB on Supabase's free tier).
 */

export const AUDIO_BITRATE_BPS = 128_000;
const QUALITY_CEILING_BPS: Record<VideoFormat, number> = { SHORT: 10_000_000, LONG_FORM: 8_000_000 };
/** Below this, 1080p looks visibly blocky; better to fail with advice than upload mush. */
const MIN_VIDEO_BPS = 1_200_000;
/** Headroom for container overhead and the encoder briefly overshooting the average. */
const SIZE_SAFETY = 0.88;

type Bitrate = `${number}k`;

export interface EncodingPlan {
  crf: number;
  encodingMaxRate: Bitrate;
  encodingBufferSize: Bitrate;
  audioBitrate: Bitrate;
  maxVideoBps: number;
}

const kbps = (bps: number): Bitrate => `${Math.floor(bps / 1000)}k`;

export function planEncoding(durationSeconds: number, maxBytes: number, format: VideoFormat): EncodingPlan {
  if (!(durationSeconds > 0)) throw new Error("Cannot plan encoding for an empty video.");
  const fitsStorageBps = (maxBytes * 8 * SIZE_SAFETY) / durationSeconds - AUDIO_BITRATE_BPS;
  const maxVideoBps = Math.floor(Math.min(QUALITY_CEILING_BPS[format], fitsStorageBps));
  if (maxVideoBps < MIN_VIDEO_BPS) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    throw new Error(
      `A ${Math.round(durationSeconds)}s video can't fit a ${mb} MB storage object at watchable 1080p quality. ` +
        "Set STORAGE_DRIVER=r2 (Cloudflare R2, 10 GB free) or raise STORAGE_MAX_OBJECT_MB.",
    );
  }
  return {
    crf: 20,
    encodingMaxRate: kbps(maxVideoBps),
    encodingBufferSize: kbps(maxVideoBps * 2),
    audioBitrate: kbps(AUDIO_BITRATE_BPS),
    maxVideoBps,
  };
}
