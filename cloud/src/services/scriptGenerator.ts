import { z } from "zod";
import type { VideoFormat } from "@/generated/prisma/enums";
import { PipelineError } from "@/lib/errors";
import { generateGeminiJson, parseJsonText, sanitizeSchema, type GeminiClient } from "./gemini";

export type { GeminiClient } from "./gemini";

// ─────────────────────────────────────────────────────────────
// Output contract
// ─────────────────────────────────────────────────────────────

const beatShape = {
  narration: z
    .string()
    .min(1)
    .describe("Exact words the narrator speaks over this shot. Plain spoken text: no stage directions, markdown or emojis."),
  imagePrompt: z
    .string()
    .min(1)
    .describe(
      "Text-to-image prompt for one cinematic frame: subject, setting, composition, lighting, mood. Never request text, captions, logos or a real person's likeness.",
    ),
  stockQuery: z.string().min(1).describe("2-4 plain English words that would find matching stock B-roll footage."),
};

export const ScriptSchema = z.object({
  title: z.string().min(1).describe("Curiosity-driven YouTube title, under 70 characters."),
  description: z.string().min(1).describe("YouTube description: 2-3 short paragraphs, then 3-5 relevant hashtags."),
  // No maxItems: extra tags are trimmed to YouTube's 500-character budget instead of failing the script.
  tags: z.array(z.string().min(1)).describe("10-20 SEO tags, most specific first."),
  hook: z.object(beatShape).describe("Opening beat that earns the viewer's attention within 3 seconds."),
  sections: z
    .array(z.object({ heading: z.string().min(1).describe("Short chapter title for this beat."), ...beatShape }))
    .min(1)
    .max(40),
  cta: z.object(beatShape).describe("Closing beat with a natural call to action (subscribe, comment, watch next)."),
});

export type VideoScript = z.infer<typeof ScriptSchema>;

export type SceneKind = "hook" | "section" | "cta";

/** One narrated beat, flattened in play order: hook, sections..., cta. */
export interface PlannedScene {
  sceneIndex: number;
  kind: SceneKind;
  heading: string | null;
  narration: string;
  imagePrompt: string;
  stockQuery: string;
  estimatedSeconds: number;
  startSeconds: number;
  endSeconds: number;
}

/** Stored in VideoProject.script. */
export interface StoredScript extends VideoScript {
  version: 1;
  model: string;
  generatedAt: string;
  timestamps: Array<Pick<PlannedScene, "sceneIndex" | "kind" | "heading" | "startSeconds" | "endSeconds">>;
}

export interface ScriptRequest {
  topic: string;
  niche: string;
  format: VideoFormat;
  language?: string;
  targetAudience?: string | null;
  /** Channel.defaultScriptPrompt: house style, persona, recurring segments... */
  channelPrompt?: string | null;
  /** Gemini's lessons from the channel's YouTube stats (see analytics.ts). */
  performanceNotes?: string | null;
}

export interface GeneratedScript {
  model: string;
  script: VideoScript;
  scenes: PlannedScene[];
  stored: StoredScript;
}

// ─────────────────────────────────────────────────────────────
// Timing helpers
// ─────────────────────────────────────────────────────────────

/** Typical neural-voice pace (~150 wpm). Real durations are measured after TTS. */
const WORDS_PER_SECOND = 2.5;

export function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, Math.round((words / WORDS_PER_SECOND) * 10) / 10);
}

export function planScenes(script: VideoScript): PlannedScene[] {
  const beats: Array<{ kind: SceneKind; heading: string | null } & z.infer<z.ZodObject<typeof beatShape>>> = [
    { kind: "hook", heading: null, ...script.hook },
    ...script.sections.map((s) => ({ kind: "section" as const, ...s })),
    { kind: "cta", heading: null, ...script.cta },
  ];

  let cursor = 0;
  return beats.map((beat, sceneIndex) => {
    const estimatedSeconds = estimateSpeechSeconds(beat.narration);
    const startSeconds = Math.round(cursor * 10) / 10;
    cursor += estimatedSeconds;
    return {
      sceneIndex,
      kind: beat.kind,
      heading: beat.heading,
      narration: beat.narration.trim(),
      imagePrompt: beat.imagePrompt.trim(),
      stockQuery: beat.stockQuery.trim(),
      estimatedSeconds,
      startSeconds,
      endSeconds: Math.round(cursor * 10) / 10,
    };
  });
}

function formatTimestamp(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * YouTube chapter lines ("0:00 Intro") from the script headings and the real scene durations.
 * YouTube only shows chapters when there are at least 3, the first is 0:00, and each lasts 10s+;
 * shorter chapters are merged into the previous one. Returns [] when those rules can't be met.
 */
export function buildChapters(script: VideoScript, sceneDurations: number[]): string[] {
  const chapters: Array<{ title: string; start: number }> = [];
  let cursor = 0;
  const titles = ["Intro", ...script.sections.map((s) => s.heading)];
  titles.forEach((title, i) => {
    const last = chapters.at(-1);
    // Beats sharing a heading form one chapter; a chapter under 10s absorbs the next beat.
    if (!last || (title !== last.title && cursor - last.start >= 10)) {
      chapters.push({ title, start: cursor });
    }
    cursor += sceneDurations[i] ?? 0;
  });
  cursor += sceneDurations[titles.length] ?? 0; // CTA belongs to the final chapter
  const last = chapters.at(-1);
  if (last && chapters.length > 1 && cursor - last.start < 10) chapters.pop();
  return chapters.length >= 3 ? chapters.map((c) => `${formatTimestamp(c.start)} ${c.title}`) : [];
}

// ─────────────────────────────────────────────────────────────
// Prompting
// ─────────────────────────────────────────────────────────────

const FORMAT_BRIEF: Record<VideoFormat, string> = {
  SHORT:
    "Format: YouTube Short (vertical 9:16). Total narration 45-55 seconds (about 120-140 words). " +
    "Use 4-6 sections of one or two punchy sentences each. The hook must work with the sound off as a visual too.",
  LONG_FORM:
    "Format: long-form YouTube video (16:9). Total narration 6-8 minutes (about 900-1200 words). " +
    "Use 12-24 sections of 2-4 sentences each, grouped into a clear narrative arc with open loops that pay off later.",
};

export function buildSystemInstruction(req: ScriptRequest): string {
  return [
    `You are an expert scriptwriter for a faceless YouTube channel in the "${req.niche}" niche.`,
    "Write for a neural text-to-speech voiceover: short, conversational sentences; no stage directions, speaker labels, markdown, emojis or URLs.",
    "Each beat is one continuous shot: its narration is spoken over a single visual.",
    "Only state facts you are confident are accurate. Avoid precise statistics, dates or quotes unless they are well established.",
    "stockQuery is always in English, even when the narration is not.",
    req.channelPrompt?.trim() ? `Channel style guide from the operator:\n${req.channelPrompt.trim()}` : "",
    req.performanceNotes?.trim() ? `Lessons from this channel's YouTube performance (apply them):\n${req.performanceNotes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildUserPrompt(req: ScriptRequest): string {
  return [
    `Topic: ${req.topic.trim()}`,
    FORMAT_BRIEF[req.format],
    `Narration language: ${req.language ?? "en"}.`,
    req.targetAudience?.trim() ? `Target audience: ${req.targetAudience.trim()}.` : "",
    "Return only the JSON object described by the response schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const GEMINI_RESPONSE_SCHEMA = sanitizeSchema(z.toJSONSchema(ScriptSchema));

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

export function parseScriptResponse(text: string | undefined): VideoScript {
  const parsed = ScriptSchema.safeParse(parseJsonText(text));
  if (!parsed.success) {
    throw new Error(`Gemini JSON did not match the script schema: ${z.prettifyError(parsed.error)}`);
  }
  return normalizeMetadata(parsed.data);
}

/** Enforce YouTube limits: title <= 100 chars, description <= 5000, tags <= 500 chars total. */
function normalizeMetadata(script: VideoScript): VideoScript {
  const tags: string[] = [];
  let tagChars = 0;
  for (const raw of script.tags) {
    const tag = raw.replace(/^#/, "").replace(/[<>]/g, "").trim();
    if (!tag || tags.includes(tag)) continue;
    // YouTube counts quotes around multi-word tags plus a comma separator.
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (tagChars + cost > 500) break;
    tags.push(tag);
    tagChars += cost;
  }
  return {
    ...script,
    title: script.title.replace(/[<>]/g, "").trim().slice(0, 100),
    description: script.description.replace(/[<>]/g, "").trim().slice(0, 5000),
    tags,
  };
}

// ─────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────

/** Generate a structured script with Gemini on the free tier (see gemini.ts for retries/fallback). */
export async function generateScript(
  req: ScriptRequest,
  options: { client?: GeminiClient; models?: string[]; retryDelayMs?: number } = {},
): Promise<GeneratedScript> {
  if (!req.topic.trim()) throw new PipelineError("CONFLICT", "The project has no topic to write about.");

  const { model, value: script } = await generateGeminiJson({
    task: "Script generation",
    systemInstruction: buildSystemInstruction(req),
    prompt: buildUserPrompt(req),
    responseJsonSchema: GEMINI_RESPONSE_SCHEMA,
    parse: parseScriptResponse,
    ...options,
  });
  const scenes = planScenes(script);
  return {
    model,
    script,
    scenes,
    stored: {
      version: 1,
      model,
      generatedAt: new Date().toISOString(),
      ...script,
      timestamps: scenes.map(({ sceneIndex, kind, heading, startSeconds, endSeconds }) => ({
        sceneIndex,
        kind,
        heading,
        startSeconds,
        endSeconds,
      })),
    },
  };
}
