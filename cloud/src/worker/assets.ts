import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { LumenVideoProps, VideoScene } from "../../remotion/timeline";
import type { RenderJob } from "@/services/renderContract";

/**
 * Pull every scene asset onto the runner's disk before rendering. Local files make the render
 * deterministic (no mid-render network flakes) and let us measure clip lengths for looping.
 */

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function downloadFile(
  url: string,
  destWithoutExt: string,
  options: { attempts?: number; timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<string> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 180_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = EXTENSIONS[type] ?? path.extname(new URL(url).pathname).slice(1) ?? "bin";
      const dest = `${destWithoutExt}.${ext || "bin"}`;
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(dest));
      if ((await stat(dest)).size === 0) throw new Error("empty file");
      return dest;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep((options.retryDelayMs ?? 1500) * attempt);
    }
  }
  throw new Error(`Download failed for ${url}: ${String(lastError)}`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface PrepareOptions {
  /** Seconds of a local video file (the worker passes Remotion's getVideoMetadata). */
  measureVideo: (filePath: string) => Promise<number | null>;
  concurrency?: number;
  downloadOptions?: Parameters<typeof downloadFile>[2];
}

/** Download a job's assets into `publicDir` and return composition props that reference them. */
export async function prepareRenderProps(job: RenderJob, publicDir: string, options: PrepareOptions): Promise<LumenVideoProps> {
  await rm(publicDir, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });

  const scenes = await mapLimit(job.scenes, options.concurrency ?? 4, async (scene): Promise<VideoScene> => {
    const prefix = path.join(publicDir, `scene-${String(scene.sceneIndex).padStart(3, "0")}`);
    const audio = await downloadFile(scene.audioUrl, `${prefix}-voice`, options.downloadOptions);
    const video = scene.videoClipUrl ? await downloadFile(scene.videoClipUrl, `${prefix}-clip`, options.downloadOptions) : null;
    // With a clip, the still is only a fallback; skip downloading it.
    const image = !video && scene.imageUrl ? await downloadFile(scene.imageUrl, `${prefix}-image`, options.downloadOptions) : null;
    if (!video && !image) throw new Error(`Scene ${scene.sceneIndex + 1} has no visual to render.`);

    return {
      audioSrc: path.basename(audio),
      imageSrc: image ? path.basename(image) : null,
      videoSrc: video ? path.basename(video) : null,
      videoDurationSeconds: video ? await options.measureVideo(video) : null,
      durationSeconds: scene.durationSeconds,
      words: scene.words,
    };
  });

  return { format: job.format, captions: job.captions, scenes };
}
