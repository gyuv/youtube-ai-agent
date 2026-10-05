import { randomUUID } from "node:crypto";
import { MediaResolution } from "@google/genai";
import { z } from "zod";
import { PipelineError } from "@/lib/errors";
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, type CaptionLine, type Moment } from "./clipContract";
import { generateGeminiJson, parseJsonText, type GeminiClient } from "./gemini";
import { TranscriptError, getTimedTranscript, type TimedSegment } from "./videoResearch";

/**
 * Picks the moments of a long video that work as standalone Shorts.
 *
 * Preferred path: the timed transcript goes to Gemini, which answers with start/end times that
 * are then snapped to caption boundaries (so clips never cut mid-sentence) and carry those
 * captions for burning in. When YouTube blocks caption access from the server, Gemini watches
 * the public video itself and returns times, captions and where the speaker sits in frame.
 */

export interface FindMomentsInput {
  videoId: string;
  title: string;
  durationSeconds: number | null;
  count: number; // how many clips to aim for
  minSeconds?: number;
  maxSeconds?: number;
  client?: GeminiClient;
}

export interface FoundMoments {
  moments: Moment[];
  source: "transcript" | "video";
}

const RawMomentSchema = z.object({
  start: z.number(),
  end: z.number(),
  title: z.string(),
  hook: z.string(),
  reason: z.string(),
  score: z.number(),
  focusX: z.number().optional(),
  captions: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).optional(),
});
type RawMoment = z.infer<typeof RawMomentSchema>;

const responseSchema = (withVideoFields: boolean) => ({
  type: "object",
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number", description: "Start, in seconds from the beginning of the video." },
          end: { type: "number", description: "End, in seconds from the beginning of the video." },
          title: { type: "string", description: "YouTube Shorts title, under 70 characters, no hashtags." },
          hook: { type: "string", description: "The first line a viewer hears or sees that makes them stay." },
          reason: { type: "string", description: "One sentence: why this works as a standalone short." },
          score: { type: "number", description: "Viral potential, 0-100." },
          ...(withVideoFields
            ? {
                focusX: { type: "number", description: "Horizontal position of the main speaker/subject, 0 = left edge, 1 = right edge." },
                captions: {
                  type: "array",
                  description: "What is said in the clip, as short caption lines of at most 6 words with times in seconds from the start of the video.",
                  items: { type: "object", properties: { start: { type: "number" }, end: { type: "number" }, text: { type: "string" } }, required: ["start", "end", "text"] },
                },
              }
            : {}),
        },
        required: ["start", "end", "title", "hook", "reason", "score", ...(withVideoFields ? ["focusX", "captions"] : [])],
      },
    },
  },
  required: ["moments"],
});

const SYSTEM = [
  "You are a short-form video editor who turns long videos into viral YouTube Shorts, TikToks and Reels.",
  "Pick moments that stand alone without context: a strong opening line in the first 2 seconds, one clear idea,",
  "a payoff (insight, punchline, surprising fact, emotional beat or useful tip) and a clean ending on a finished sentence.",
  "Never start mid-sentence. Prefer variety: different topics, no overlapping moments. Rank by how likely a stranger watches to the end.",
].join(" ");

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Transcript as "[seconds] text" lines, merged into ~10 s chunks to save tokens. */
export function transcriptForPrompt(segments: TimedSegment[]): string {
  const lines: string[] = [];
  let chunk: TimedSegment | null = null;
  for (const seg of segments) {
    if (chunk && seg.start - chunk.start < 10) {
      chunk.text += ` ${seg.text}`;
      chunk.end = seg.end;
    } else {
      if (chunk) lines.push(`[${chunk.start.toFixed(1)}] ${chunk.text}`);
      chunk = { ...seg };
    }
  }
  if (chunk) lines.push(`[${chunk.start.toFixed(1)}] ${chunk.text}`);
  return lines.join("\n");
}

/** Caption lines inside [start, end], split into ≤6-word pieces with time shared by word count. */
export function captionsBetween(segments: TimedSegment[], start: number, end: number): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const seg of segments) {
    if (seg.end <= start || seg.start >= end) continue;
    const words = seg.text.split(/\s+/).filter(Boolean);
    const s = Math.max(seg.start, start);
    const e = Math.min(seg.end, end);
    const per = (e - s) / Math.max(words.length, 1);
    for (let i = 0; i < words.length; i += 6) {
      const piece = words.slice(i, i + 6);
      out.push({ start: s + i * per, end: s + (i + piece.length) * per, text: piece.join(" ") });
    }
  }
  return out;
}

/**
 * Clean up the model's picks: valid ranges inside the video, snapped to caption boundaries,
 * stretched or trimmed to the allowed length, no overlaps, best first.
 */
export function normalizeMoments(
  raw: RawMoment[],
  opts: { segments?: TimedSegment[]; duration: number | null; count: number; minSeconds: number; maxSeconds: number },
): Moment[] {
  const { segments = [], duration, minSeconds, maxSeconds } = opts;
  const limit = duration ?? Number.POSITIVE_INFINITY;
  const snapStart = (t: number) => {
    let best = t;
    for (const seg of segments) if (seg.start <= t + 0.5) best = seg.start; else break;
    return segments.length ? best : t;
  };
  const snapEnd = (t: number) => {
    const seg = segments.find((x) => x.end >= t - 0.5);
    return seg ? seg.end : t;
  };

  const picked: Moment[] = [];
  const sorted = [...raw].filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end)).sort((a, b) => b.score - a.score);
  for (const m of sorted) {
    let start = Math.max(0, snapStart(Math.min(m.start, m.end)));
    let end = Math.min(limit, snapEnd(Math.max(m.start, m.end)));
    if (end - start > maxSeconds) end = start + maxSeconds;
    if (end - start < minSeconds) end = Math.min(limit, start + minSeconds);
    if (end - start < minSeconds) start = Math.max(0, end - minSeconds);
    if (end - start < MIN_CLIP_SECONDS / 2) continue;
    if (picked.some((p) => start < p.end && end > p.start)) continue; // overlaps a better moment
    const round = (n: number) => Math.round(n * 10) / 10;
    picked.push({
      id: randomUUID(),
      start: round(start),
      end: round(end),
      title: m.title.trim().slice(0, 100) || `Clip at ${fmt(start)}`,
      hook: m.hook.trim(),
      reason: m.reason.trim(),
      score: Math.max(0, Math.min(100, Math.round(m.score))),
      focusX: Math.max(0, Math.min(1, m.focusX ?? 0.5)),
      selected: true,
      status: "pending",
      captions: segments.length
        ? captionsBetween(segments, start, end)
        : (m.captions ?? []).filter((c) => c.end > start && c.start < end && c.text.trim()),
      videoUrl: null,
      projectId: null,
      error: null,
    });
    if (picked.length >= opts.count) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

const parseMoments = (text: string | undefined) => z.object({ moments: z.array(RawMomentSchema) }).parse(parseJsonText(text)).moments;

export async function findMoments(input: FindMomentsInput): Promise<FoundMoments> {
  const count = Math.max(1, Math.min(15, Math.round(input.count)));
  const minSeconds = Math.max(MIN_CLIP_SECONDS, input.minSeconds ?? 15);
  const maxSeconds = Math.min(MAX_CLIP_SECONDS, Math.max(minSeconds + 5, input.maxSeconds ?? 60));
  const length = input.durationSeconds ? ` It is ${fmt(input.durationSeconds)} long.` : "";
  const ask =
    `Find the ${count} best moments of the video "${input.title}" to post as vertical Shorts.${length} ` +
    `Each moment must be ${minSeconds}-${maxSeconds} seconds long. Return more candidates than asked if unsure; they will be ranked by score.`;

  let segments: TimedSegment[] | null = null;
  try {
    segments = (await getTimedTranscript(input.videoId)).segments;
  } catch (error) {
    // Blocked or captionless: fall back to Gemini watching the video. Anything else is final.
    if (!(error instanceof TranscriptError) || error.reason === "UNAVAILABLE") throw error;
  }

  if (segments) {
    const { value } = await generateGeminiJson({
      task: "Finding clip moments",
      systemInstruction: SYSTEM,
      prompt: `${ask}\n\nTranscript, each line starting with its time in seconds:\n${transcriptForPrompt(segments)}`,
      responseJsonSchema: responseSchema(false),
      parse: parseMoments,
      client: input.client,
    });
    const moments = normalizeMoments(value, { segments, duration: input.durationSeconds, count, minSeconds, maxSeconds });
    if (!moments.length) throw new PipelineError("PROVIDER", "Gemini found no clip-worthy moments in this video.");
    return { moments, source: "transcript" };
  }

  const { value } = await generateGeminiJson({
    task: "Finding clip moments",
    systemInstruction: SYSTEM,
    prompt: `${ask} Also give where the main subject sits horizontally, and the spoken words of each moment as caption lines.`,
    parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${input.videoId}`, mimeType: "video/*" } }],
    config: { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW },
    responseJsonSchema: responseSchema(true),
    parse: parseMoments,
    client: input.client,
  });
  const moments = normalizeMoments(value, { duration: input.durationSeconds, count, minSeconds, maxSeconds });
  if (!moments.length) throw new PipelineError("PROVIDER", "Gemini found no clip-worthy moments in this video.");
  return { moments, source: "video" };
}
