import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLIP_WEBHOOK_PATH, type CaptionLine, type ClipEvent, type ClipLayout, type ClipWorkOrder } from "../services/clipContract";

/**
 * GitHub Actions side of "long video -> Shorts": downloads just the selected sections with
 * yt-dlp, then FFmpeg cuts each one exactly, reframes it to 1080x1920 and burns the captions.
 * Talks to the app only through the clip webhook; it never sees database or storage keys.
 */

const W = 1080;
const H = 1920;
const PAD = 1.5; // seconds downloaded either side of a moment so the exact cut has keyframes

export interface ClipWorkerConfig {
  appUrl: string;
  secret: string;
  jobId: string;
  runId: string;
  cookiesFile?: string;
  workDir?: string;
}

export function readClipWorkerConfig(env: Record<string, string | undefined> = process.env): ClipWorkerConfig {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    appUrl: need("APP_URL").replace(/\/+$/, ""),
    secret: need("RENDER_WEBHOOK_SECRET"),
    jobId: need("JOB_ID"),
    runId: need("GITHUB_RUN_ID"),
    cookiesFile: env.YOUTUBE_COOKIES_FILE || undefined,
  };
}

type EventBody = ClipEvent extends infer E ? (E extends ClipEvent ? Omit<E, "jobId" | "runId"> : never) : never;

async function send<T>(cfg: ClipWorkerConfig, body: EventBody, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${cfg.appUrl}${CLIP_WEBHOOK_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, jobId: cfg.jobId, runId: cfg.runId }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as T;
      last = new Error(`${body.event} webhook returned ${res.status}: ${text.slice(0, 300)}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      err += d;
      if (err.length > 20_000) err = err.slice(-10_000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().split("\n").slice(-6).join(" | ")}`))));
  });
}

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** Bold, outlined captions in the lower third, timed relative to the clip's start. */
export function buildAss(captions: CaptionLine[], clipStart: number, clipEnd: number): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,DejaVu Sans,78,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,80,80,560,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines = captions
    .filter((c) => c.end > clipStart && c.start < clipEnd)
    .map((c) => {
      const text = c.text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
      return `Dialogue: 0,${assTime(Math.max(0, c.start - clipStart))},${assTime(Math.min(clipEnd, c.end) - clipStart)},Default,,0,0,0,,${text}`;
    });
  return [...header, ...lines, ""].join("\n");
}

/** FFmpeg filter graph that turns any source frame into 1080x1920. */
export function reframeFilter(layout: ClipLayout, src: { width: number; height: number }, focusX: number, assFile?: string): string {
  const subs = assFile ? `,ass='${assFile.replace(/'/g, "")}'` : "";
  const sourceIsVertical = src.width / src.height <= W / H + 0.01;
  if (layout === "fit" && !sourceIsVertical) {
    return (
      `[0:v]split[a][b];` +
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:4,eq=brightness=-0.08[bg];` +
      `[b]scale=${W}:-2[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${subs}[v]`
    );
  }
  if (sourceIsVertical) {
    return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1${subs}[v]`;
  }
  // Fill the frame: a 9:16 window of the full height, centred on the subject.
  const cropW = Math.floor((src.height * W) / H / 2) * 2;
  const x = Math.round(Math.max(0, Math.min(src.width - cropW, focusX * src.width - cropW / 2)));
  return `[0:v]crop=${cropW}:${src.height}:${x}:0,scale=${W}:${H},setsar=1${subs}[v]`;
}

async function probe(file: string): Promise<{ width: number; height: number }> {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]);
  const [width, height] = out.trim().split("x").map(Number);
  if (!width || !height) throw new Error("Could not read the downloaded video's size.");
  return { width, height };
}

async function downloadSection(order: ClipWorkOrder, start: number, end: number, out: string, cookiesFile?: string) {
  const from = Math.max(0, start - PAD);
  const args = [
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    "-f",
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "--download-sections",
    `*${from.toFixed(2)}-${(end + PAD).toFixed(2)}`,
    // Cut at exactly `from` (re-encoding the cut points) so the section starts where the
    // trim and caption offsets below assume it does, not at an earlier keyframe.
    "--force-keyframes-at-cuts",
    "-o",
    out,
    ...(cookiesFile ? ["--cookies", cookiesFile] : []),
    order.sourceUrl,
  ];
  await run("yt-dlp", args);
  return from;
}

export async function runClipJob(cfg: ClipWorkerConfig): Promise<{ done: number; failed: number }> {
  const order = await send<ClipWorkOrder>(cfg, { event: "started" });
  const dir = cfg.workDir ?? path.join(tmpdir(), `clips-${cfg.jobId}`);
  await mkdir(dir, { recursive: true });
  let done = 0;
  let failed = 0;

  for (const moment of order.moments) {
    const raw = path.join(dir, `${moment.id}.src.mp4`);
    const ass = path.join(dir, `${moment.id}.ass`);
    const final = path.join(dir, `${moment.id}.mp4`);
    try {
      console.log(`▶ ${moment.title} (${moment.start.toFixed(1)}s-${moment.end.toFixed(1)}s)`);
      const offset = await downloadSection(order, moment.start, moment.end, raw, cfg.cookiesFile);
      const size = await probe(raw);
      const withCaptions = order.burnCaptions && moment.captions.length > 0;
      if (withCaptions) await writeFile(ass, buildAss(moment.captions, moment.start, moment.end));
      await run("ffmpeg", [
        "-y",
        "-ss",
        (moment.start - offset).toFixed(3),
        "-i",
        raw,
        "-t",
        (moment.end - moment.start).toFixed(3),
        "-filter_complex",
        reframeFilter(order.layout, size, moment.focusX, withCaptions ? ass : undefined),
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        final,
      ]);

      const upload = await send<{ url: string; method?: string; headers?: Record<string, string> }>(cfg, { event: "upload", momentId: moment.id });
      const bytes = (await stat(final)).size;
      const put = await fetch(upload.url, {
        method: upload.method ?? "PUT",
        headers: upload.headers ?? { "Content-Type": "video/mp4" },
        body: await readFile(final),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
      await send(cfg, { event: "clip-done", momentId: moment.id, bytes });
      done += 1;
      console.log(`  ✓ uploaded ${(bytes / 1e6).toFixed(1)} MB`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const hint = /sign in to confirm|not a bot|http error 403/i.test(message)
        ? " YouTube blocked the download from GitHub's servers: add a YOUTUBE_COOKIES repository secret (Netscape cookies.txt from a logged-in browser)."
        : "";
      console.error(`  ✗ ${message}`);
      await send(cfg, { event: "clip-failed", momentId: moment.id, error: `${message}${hint}`.slice(0, 2000) }).catch(() => undefined);
    } finally {
      await Promise.all([raw, ass, final].map((f) => rm(f, { force: true })));
    }
  }

  await send(cfg, { event: "finished" });
  return { done, failed };
}
