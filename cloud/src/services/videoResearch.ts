import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getChannelAccessToken } from "./youtube";

// Research any public YouTube video or playlist: metadata through the YouTube Data API (using a
// connected channel's grant) and transcripts from YouTube's own caption tracks, cached in Postgres.

export type ParsedYouTubeUrl = { kind: "video"; videoId: string } | { kind: "playlist"; playlistId: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

/** Accepts watch, youtu.be, shorts, embed, live and playlist URLs, or a bare video id. */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  const raw = input.trim();
  if (VIDEO_ID.test(raw)) return { kind: "video", videoId: raw };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new PipelineError("CONFLICT", "That is not a YouTube link.");
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (VIDEO_ID.test(id)) return { kind: "video", videoId: id };
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID.test(v)) return { kind: "video", videoId: v };
    const list = url.searchParams.get("list");
    if (list && PLAYLIST_ID.test(list)) return { kind: "playlist", playlistId: list };
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return { kind: "video", videoId: m[1] };
  }
  throw new PipelineError("CONFLICT", "That is not a YouTube video or playlist link.");
}

export interface ResearchVideo {
  id: string;
  title: string;
  channel: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  tags: string[];
  description: string;
}

export interface ResearchPlaylist {
  id: string;
  title: string;
  channel: string;
  videos: ResearchVideo[];
}

/** "PT1H2M3S" → 3723. */
export function parseIsoDuration(value: string | undefined): number | null {
  const m = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86_400 + h * 3600 + min * 60 + s;
}

/** A token from any channel connected to YouTube; research only needs read access. */
async function researchToken(): Promise<string> {
  const channel = await prisma.channel.findFirst({
    where: { oauthRefreshTokenEnc: { not: null } },
    select: { id: true, name: true, oauthRefreshTokenEnc: true },
    orderBy: { createdAt: "asc" },
  });
  if (!channel) throw new PipelineError("CONFLICT", "Connect at least one channel to YouTube to look up video details.");
  return getChannelAccessToken(channel);
}

async function ytGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new PipelineError("PROVIDER", `YouTube ${path} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface ApiVideo {
  id: string;
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string; description?: string; tags?: string[]; thumbnails?: Record<string, { url?: string }> };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

const num = (v: string | undefined) => (v == null ? null : Number(v));

function toResearchVideo(v: ApiVideo): ResearchVideo {
  const t = v.snippet?.thumbnails ?? {};
  return {
    id: v.id,
    title: v.snippet?.title ?? "Untitled",
    channel: v.snippet?.channelTitle ?? "",
    publishedAt: v.snippet?.publishedAt ?? null,
    durationSeconds: parseIsoDuration(v.contentDetails?.duration),
    thumbnail: (t.maxres ?? t.high ?? t.medium ?? t.default)?.url ?? null,
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
    tags: v.snippet?.tags ?? [],
    description: v.snippet?.description ?? "",
  };
}

async function fetchVideos(ids: string[], token: string): Promise<ResearchVideo[]> {
  const out: ResearchVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const page = await ytGet<{ items?: ApiVideo[] }>(
      "videos",
      { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: "50" },
      token,
    );
    out.push(...(page.items ?? []).map(toResearchVideo));
  }
  return out;
}

export async function getResearchVideo(videoId: string): Promise<ResearchVideo> {
  const [video] = await fetchVideos([videoId], await researchToken());
  if (!video) throw new PipelineError("NOT_FOUND", "Video not found, or it is private.");
  return video;
}

/** Playlist details and up to `limit` of its videos (1 quota unit per 50 videos). */
export async function getResearchPlaylist(playlistId: string, limit = 200): Promise<ResearchPlaylist> {
  const token = await researchToken();
  const meta = await ytGet<{ items?: Array<{ snippet?: { title?: string; channelTitle?: string } }> }>(
    "playlists",
    { part: "snippet", id: playlistId },
    token,
  );
  const info = meta.items?.[0];
  if (!info) throw new PipelineError("NOT_FOUND", "Playlist not found, or it is private.");

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await ytGet<{ nextPageToken?: string; items?: Array<{ contentDetails?: { videoId?: string } }> }>(
      "playlistItems",
      { part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) },
      token,
    );
    for (const item of page.items ?? []) if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < limit);

  const videos = await fetchVideos(ids.slice(0, limit), token);
  return { id: playlistId, title: info.snippet?.title ?? "Untitled playlist", channel: info.snippet?.channelTitle ?? "", videos };
}

// ─────────────────────────────────────────────────────────────
// Transcripts
// ─────────────────────────────────────────────────────────────

export type TranscriptFailure = "DISABLED" | "NOT_FOUND" | "BLOCKED" | "UNAVAILABLE";

/** Why a transcript could not be fetched; BLOCKED is temporary and worth retrying later. */
export class TranscriptError extends PipelineError {
  readonly reason: TranscriptFailure;
  constructor(reason: TranscriptFailure, message: string) {
    super(reason === "BLOCKED" ? "PROVIDER" : "NOT_FOUND", message);
    this.reason = reason;
  }
}

export interface Transcript {
  videoId: string;
  language: string;
  translated: boolean;
  text: string;
  cached: boolean;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" for auto-generated
  isTranslatable?: boolean;
}

const INNERTUBE_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en" };

async function fetchCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  let res: Response;
  try {
    res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip" },
      body: JSON.stringify({ context: { client: INNERTUBE_CLIENT }, videoId }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new TranscriptError("BLOCKED", `Could not reach YouTube: ${errorMessage(error)}`);
  }
  if (res.status === 429 || res.status === 403) throw new TranscriptError("BLOCKED", "YouTube is temporarily refusing transcript requests from this server. Try again in a few minutes.");
  if (!res.ok) throw new TranscriptError("UNAVAILABLE", `YouTube answered ${res.status}.`);
  const body = (await res.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
  const status = body.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED" && /bot/i.test(body.playabilityStatus?.reason ?? "")) {
    throw new TranscriptError("BLOCKED", "YouTube asked this server to prove it is not a bot. Try again later.");
  }
  if (status && status !== "OK") throw new TranscriptError("UNAVAILABLE", body.playabilityStatus?.reason ?? "Video unavailable or private.");
  const tracks = body.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new TranscriptError("DISABLED", "This video has no captions.");
  return tracks;
}

const base = (code: string) => code.toLowerCase().split("-")[0];

/**
 * The track for the wanted language: an exact or same-language track (manual before automatic),
 * else any translatable track machine-translated by YouTube. With no language: English, else the first.
 */
export function pickTrack(tracks: CaptionTrack[], wanted: string): { track: CaptionTrack; translateTo: string | null } {
  const ordered = [...tracks].sort((a, b) => Number(a.kind === "asr") - Number(b.kind === "asr"));
  if (!wanted) return { track: ordered.find((t) => base(t.languageCode) === "en") ?? ordered[0], translateTo: null };
  const exact = ordered.find((t) => t.languageCode.toLowerCase() === wanted.toLowerCase()) ?? ordered.find((t) => base(t.languageCode) === base(wanted));
  if (exact) return { track: exact, translateTo: null };
  const translatable = ordered.find((t) => t.isTranslatable !== false);
  if (!translatable) throw new TranscriptError("NOT_FOUND", `No transcript in "${wanted}", and YouTube can't translate this video's captions.`);
  return { track: translatable, translateTo: wanted };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text from YouTube's timedtext XML (classic <text> or srv3 <p>), whitespace cleaned. */
export function timedTextToPlain(xml: string): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    // decode twice: captions are often double-escaped (&amp;#39;)
    const inner = decodeEntities(decodeEntities(m[2].replace(/<[^>]+>/g, "")));
    if (inner.trim()) parts.push(inner);
  }
  return parts
    .join(" ")
    .replace(/\[(?:music|applause|laughter|música|aplausos)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A transcript in the wanted language ("" = automatic), from the cache when we have one. */
export async function getTranscript(videoId: string, language = "", { refresh = false } = {}): Promise<Transcript> {
  if (!VIDEO_ID.test(videoId)) throw new PipelineError("CONFLICT", "Invalid video id.");
  if (!refresh) {
    const hit = await prisma.researchTranscript.findUnique({ where: { videoId_language: { videoId, language } } });
    if (hit) return { videoId, language: hit.actualLang, translated: hit.translated, text: hit.text, cached: true };
  }

  const { track, translateTo } = pickTrack(await fetchCaptionTracks(videoId), language);
  const url = new URL(track.baseUrl);
  url.searchParams.delete("fmt");
  if (translateTo) url.searchParams.set("tlang", translateTo);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((error: unknown) => {
    throw new TranscriptError("BLOCKED", `Could not download captions: ${errorMessage(error)}`);
  });
  if (res.status === 429) throw new TranscriptError("BLOCKED", "YouTube is rate-limiting caption downloads. Try again in a few minutes.");
  if (!res.ok) throw new TranscriptError("UNAVAILABLE", `Caption download failed (${res.status}).`);
  const text = timedTextToPlain(await res.text());
  if (!text) throw new TranscriptError("NOT_FOUND", "The captions were empty.");

  const actualLang = translateTo ?? track.languageCode;
  const translated = Boolean(translateTo);
  await prisma.researchTranscript.upsert({
    where: { videoId_language: { videoId, language } },
    create: { videoId, language, actualLang, translated, text },
    update: { actualLang, translated, text, fetchedAt: new Date() },
  });
  return { videoId, language: actualLang, translated, text, cached: false };
}
