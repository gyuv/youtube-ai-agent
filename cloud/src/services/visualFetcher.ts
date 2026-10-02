import type { VideoFormat } from "@/generated/prisma/enums";
import { optionalEnv, requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";

/**
 * Scene visuals from two free sources:
 *  - Pollinations.ai: keyless text-to-image (an optional free token raises rate limits)
 *  - Pexels: free stock B-roll clips and photos (free API key, 200 requests/hour)
 */

export type Orientation = "portrait" | "landscape";

export interface Canvas {
  width: number;
  height: number;
  orientation: Orientation;
}

export function canvasFor(format: VideoFormat): Canvas {
  return format === "SHORT"
    ? { width: 1080, height: 1920, orientation: "portrait" }
    : { width: 1920, height: 1080, orientation: "landscape" };
}

// ─────────────────────────────────────────────────────────────
// Pollinations.ai
// ─────────────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 900; // the prompt travels in the URL path

export interface PollinationsOptions {
  width: number;
  height: number;
  seed?: number;
  model?: string;
  timeoutMs?: number;
}

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
  seed: number;
  sourceUrl: string;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export function buildPollinationsUrl(prompt: string, options: PollinationsOptions & { seed: number }): string {
  const base = optionalEnv("POLLINATIONS_IMAGE_URL", "https://image.pollinations.ai/prompt").replace(/\/+$/, "");
  const params = new URLSearchParams({
    width: String(options.width),
    height: String(options.height),
    seed: String(options.seed),
    model: options.model ?? optionalEnv("POLLINATIONS_MODEL", "flux"),
    nologo: "true",
    safe: "true",
  });
  const cleanPrompt = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_CHARS);
  return `${base}/${encodeURIComponent(cleanPrompt)}?${params}`;
}

/** Generate an image and download it, so the render never depends on Pollinations re-serving it. */
export async function generatePollinationsImage(prompt: string, options: PollinationsOptions): Promise<GeneratedImage> {
  if (!prompt.trim()) throw new PipelineError("CONFLICT", "The scene has no visual prompt.");
  const seed = options.seed ?? randomSeed();
  const sourceUrl = buildPollinationsUrl(prompt, { ...options, seed });
  const token = optionalEnv("POLLINATIONS_TOKEN");

  let res: Response;
  try {
    res = await fetch(sourceUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    });
  } catch (error) {
    throw new PipelineError("PROVIDER", `Pollinations request failed: ${errorMessage(error)}`, { cause: error });
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.startsWith("image/")) {
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 429
        ? " (rate limited; wait a few seconds or set POLLINATIONS_TOKEN)"
        : res.status === 402
          ? " (payment required: Pollinations wants a token or credits for this request; set POLLINATIONS_TOKEN, or use Pexels visuals)"
          : "";
    throw new PipelineError("PROVIDER", `Pollinations returned ${res.status} ${contentType}${hint}: ${detail.slice(0, 200)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 2048) throw new PipelineError("PROVIDER", "Pollinations returned an unexpectedly small image.");
  return { bytes, contentType, seed, sourceUrl };
}

// ─────────────────────────────────────────────────────────────
// Pexels
// ─────────────────────────────────────────────────────────────

export interface PexelsVideoFile {
  id: number;
  quality: string | null;
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user?: { name?: string };
  video_files: PexelsVideoFile[];
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer?: string;
  src: { original: string; medium: string };
}

export interface StockVisual {
  kind: "video" | "photo";
  /** Asset to render: an mp4 for videos, a sized JPEG for photos. */
  url: string;
  /** Still frame for the studio (and the Ken Burns fallback for videos). */
  previewUrl: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  pexelsId: number;
  pageUrl: string;
  credit: string | null;
}

export interface StockSearchOptions {
  orientation: Orientation;
  /** Prefer clips at least this long so the scene doesn't need to loop. */
  minDurationSeconds?: number;
  /** Skip these asset URLs (e.g. the scene's current clip) so "regenerate" yields something new. */
  excludeUrls?: string[];
}

async function pexelsGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `https://api.pexels.com${path}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: requireEnv("PEXELS_API_KEY") },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `Pexels request failed: ${errorMessage(error)}`, { cause: error });
  }
  if (!res.ok) {
    const hint = res.status === 429 ? " (hourly quota reached)" : res.status === 401 ? " (check PEXELS_API_KEY)" : "";
    throw new PipelineError("PROVIDER", `Pexels returned ${res.status}${hint}`);
  }
  return (await res.json()) as T;
}

/**
 * Choose the mp4 rendition closest to 1080p on its short side: sharp enough for a 1080p render
 * without downloading 4K files on the runner.
 */
export function pickVideoFile(files: PexelsVideoFile[], orientation: Orientation): PexelsVideoFile | null {
  const TARGET_SHORT_SIDE = 1080;
  const candidates = files.filter((f) => {
    if (f.file_type !== "video/mp4" || !f.width || !f.height) return false;
    return orientation === "portrait" ? f.height >= f.width : f.width >= f.height;
  });
  const score = (f: PexelsVideoFile) => {
    const shortSide = Math.min(f.width!, f.height!);
    return shortSide >= TARGET_SHORT_SIDE ? shortSide - TARGET_SHORT_SIDE : (TARGET_SHORT_SIDE - shortSide) * 4;
  };
  return candidates.sort((a, b) => score(a) - score(b))[0] ?? null;
}

export async function searchPexelsVideo(query: string, options: StockSearchOptions): Promise<StockVisual | null> {
  const data = await pexelsGet<{ videos?: PexelsVideo[] }>("/videos/search", {
    query,
    orientation: options.orientation,
    size: "medium",
    per_page: "20",
  });
  const exclude = new Set(options.excludeUrls ?? []);
  const minDuration = options.minDurationSeconds ?? 0;

  const eligible = (data.videos ?? [])
    .map((video) => ({ video, file: pickVideoFile(video.video_files, options.orientation) }))
    .filter(({ file }) => file && !exclude.has(file.link));
  // Keep Pexels' relevance order, but prefer clips long enough to cover the narration.
  const choice = eligible.find(({ video }) => video.duration >= minDuration) ?? eligible[0];
  if (!choice?.file) return null;

  return {
    kind: "video",
    url: choice.file.link,
    previewUrl: choice.video.image,
    width: choice.file.width!,
    height: choice.file.height!,
    durationSeconds: choice.video.duration,
    pexelsId: choice.video.id,
    pageUrl: choice.video.url,
    credit: choice.video.user?.name ?? null,
  };
}

export async function searchPexelsPhoto(query: string, options: StockSearchOptions): Promise<StockVisual | null> {
  const data = await pexelsGet<{ photos?: PexelsPhoto[] }>("/v1/search", {
    query,
    orientation: options.orientation,
    per_page: "20",
  });
  const exclude = new Set(options.excludeUrls ?? []);
  const [w, h] = options.orientation === "portrait" ? [1080, 1920] : [1920, 1080];

  for (const photo of data.photos ?? []) {
    // Pexels' image CDN crops and compresses on the fly.
    const url = `${photo.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;
    if (exclude.has(url)) continue;
    return {
      kind: "photo",
      url,
      previewUrl: photo.src.medium,
      width: w,
      height: h,
      durationSeconds: null,
      pexelsId: photo.id,
      pageUrl: photo.url,
      credit: photo.photographer ?? null,
    };
  }
  return null;
}

/** B-roll first; fall back to a stock photo when no clip matches. */
export async function findStockVisual(query: string, options: StockSearchOptions): Promise<StockVisual | null> {
  return (await searchPexelsVideo(query, options)) ?? (await searchPexelsPhoto(query, options));
}
