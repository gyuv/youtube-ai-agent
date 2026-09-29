import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, getVideoMetadata, renderMedia, selectComposition } from "@remotion/renderer";
import { COMPOSITION_ID } from "../../remotion/timeline";
import type { RenderJob } from "@/services/renderContract";
import { prepareRenderProps } from "./assets";
import { planEncoding } from "./encoding";
import { RenderWebhookClient } from "./webhookClient";
import { uploadVideoToYouTube } from "./youtubeUpload";

/**
 * The cloud render job, run on a GitHub Actions runner by scripts/render-worker.ts.
 * It holds no database or storage credentials: the app hands it a signed upload URL and, for
 * auto-publish, a one-hour YouTube access token.
 */

export interface WorkerConfig {
  appUrl: string;
  secret: string;
  projectId: string;
  runId: string;
  runAttempt: number;
  outDir: string;
  entryPoint: string;
  browserExecutable: string | null;
  licenseKey: string | null;
  concurrency: string | null;
}

export function readWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const projectId = required("PROJECT_ID");
  if (!/^[a-z0-9]{20,40}$/.test(projectId)) throw new Error(`PROJECT_ID "${projectId}" is not a valid project id`);

  const appUrl = required("APP_URL");
  const { protocol, hostname } = new URL(appUrl);
  // The webhook secret travels in a header: never send it over plain HTTP except to this machine.
  if (protocol !== "https:" && !["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("APP_URL must use https");
  }

  return {
    appUrl,
    secret: required("RENDER_WEBHOOK_SECRET"),
    projectId,
    runId: env.GITHUB_RUN_ID?.trim() || String(Date.now()),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? "1") || 1,
    outDir: path.resolve(env.RENDER_OUT_DIR?.trim() || "render-out"),
    entryPoint: path.resolve(env.REMOTION_ENTRY?.trim() || "remotion/index.ts"),
    browserExecutable: env.REMOTION_BROWSER_EXECUTABLE?.trim() || null,
    licenseKey: env.REMOTION_LICENSE_KEY?.trim() || null,
    concurrency: env.REMOTION_CONCURRENCY?.trim() || null,
  };
}

const log = (message: string) => console.log(`[render] ${message}`);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function progressLogger(label: string) {
  let lastDecile = -1;
  return (progress: number) => {
    const decile = Math.floor(progress * 10);
    if (decile > lastDecile) {
      lastDecile = decile;
      log(`${label} ${decile * 10}%`);
    }
  };
}

async function uploadRender(upload: RenderJob["upload"], filePath: string): Promise<void> {
  const body = await readFile(filePath);
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(upload.url, {
        method: upload.method,
        headers: { ...upload.headers, "Content-Length": String(body.length) },
        body: new Uint8Array(body),
      });
      if (res.ok) return;
      lastError = `${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`;
      if (res.status < 500) break;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
  throw new Error(`Uploading the render to storage failed: ${lastError}`);
}

export type RenderOutcome =
  | { outcome: "rendered"; videoUrl: string; sizeBytes: number }
  | { outcome: "published"; videoUrl: string; sizeBytes: number; youtubeVideoId: string };

export async function runRender(config: WorkerConfig): Promise<RenderOutcome> {
  const client = new RenderWebhookClient(config.appUrl, config.secret, { projectId: config.projectId, runId: config.runId });
  let stage: "render" | "publish" = "render";

  try {
    const { job } = await client.started({ runAttempt: config.runAttempt });
    log(`Claimed project ${job.projectId}: ${job.scenes.length} scenes, ${job.format}, storage limit ${mb(job.maxBytes)}`);

    const publicDir = path.join(config.outDir, "public");
    const output = path.join(config.outDir, "video.mp4");
    await mkdir(config.outDir, { recursive: true });
    await rm(output, { force: true });

    const inputProps = await prepareRenderProps(job, publicDir, {
      measureVideo: async (file) => {
        try {
          return (await getVideoMetadata(file, { logLevel: "error" })).durationInSeconds ?? null;
        } catch {
          return null;
        }
      },
    });
    log("Assets downloaded");

    if (!config.browserExecutable) await ensureBrowser();
    const bundleProgress = progressLogger("Bundling");
    const serveUrl = await bundle({ entryPoint: config.entryPoint, publicDir, onProgress: (p) => bundleProgress(p / 100) });

    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      browserExecutable: config.browserExecutable,
      logLevel: "warn",
    });
    const durationSeconds = composition.durationInFrames / composition.fps;
    const encoding = planEncoding(durationSeconds, job.maxBytes, job.format);
    log(
      `Rendering ${composition.width}x${composition.height}, ${durationSeconds.toFixed(1)}s, ` +
        `CRF ${encoding.crf} capped at ${encoding.encodingMaxRate}`,
    );

    const renderProgress = progressLogger("Rendering");
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: output,
      crf: encoding.crf,
      encodingMaxRate: encoding.encodingMaxRate,
      encodingBufferSize: encoding.encodingBufferSize,
      audioBitrate: encoding.audioBitrate,
      x264Preset: "medium",
      browserExecutable: config.browserExecutable,
      concurrency: config.concurrency,
      licenseKey: config.licenseKey,
      timeoutInMilliseconds: 120_000,
      logLevel: "warn",
      onProgress: ({ progress }) => renderProgress(progress),
    });

    const { size } = await stat(output);
    if (size > job.maxBytes) throw new Error(`Rendered file is ${mb(size)}, above the ${mb(job.maxBytes)} storage limit.`);
    log(`Rendered ${mb(size)}; uploading`);
    await uploadRender(job.upload, output);

    const rendered = await client.rendered({ sizeBytes: size, durationSeconds });
    log(`Stored at ${rendered.videoUrl}`);
    if (!rendered.publish) return { outcome: "rendered", videoUrl: rendered.videoUrl, sizeBytes: size };

    stage = "publish";
    // Redact the token from the Actions log if anything ever prints it.
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${rendered.publish.accessToken}`);
    log(`Uploading to YouTube (${rendered.publish.metadata.status.privacyStatus})`);
    const { videoId } = await uploadVideoToYouTube({
      filePath: output,
      metadata: rendered.publish.metadata,
      accessToken: rendered.publish.accessToken,
    });
    await client.published({ youtubeVideoId: videoId });
    log(`Published https://youtu.be/${videoId}`);
    return { outcome: "published", videoUrl: rendered.videoUrl, sizeBytes: size, youtubeVideoId: videoId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.failed({ stage, error: message }).catch((e) => log(`Could not report the failure: ${String(e)}`));
    throw error;
  }
}
