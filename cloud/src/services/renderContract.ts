import { z } from "zod";

/**
 * Wire contract between the Next.js app and the GitHub Actions render worker.
 * Imported by both sides, so it must stay free of server-only code (Prisma, secrets).
 *
 *   runner ── started ──▶ app   returns the RenderJob (scenes + a signed upload URL)
 *   runner ── rendered ─▶ app   mp4 uploaded; returns YouTube publish instructions if auto-publish
 *   runner ── published ▶ app   YouTube video id
 *   runner ── failed ───▶ app   any stage failed (also sent by the workflow if the job dies)
 */

export const RENDER_WEBHOOK_PATH = "/api/render/webhook";

const base = {
  projectId: z.string().regex(/^[a-z0-9]{20,40}$/, "invalid project id"),
  runId: z.string().regex(/^\d{1,20}$/, "invalid run id"),
};

export const RenderEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("started"), ...base, runAttempt: z.number().int().min(1).max(100) }),
  z.object({
    event: z.literal("rendered"),
    ...base,
    sizeBytes: z.number().int().positive(),
    durationSeconds: z.number().positive(),
  }),
  z.object({ event: z.literal("published"), ...base, youtubeVideoId: z.string().regex(/^[\w-]{6,20}$/) }),
  z.object({
    event: z.literal("failed"),
    ...base,
    stage: z.enum(["render", "publish"]),
    error: z.string().max(4000),
  }),
]);

export type RenderEvent = z.infer<typeof RenderEventSchema>;

export interface RenderJobScene {
  sceneIndex: number;
  audioUrl: string;
  imageUrl: string | null;
  videoClipUrl: string | null;
  durationSeconds: number;
  words: Array<{ word: string; startMs: number; endMs: number }>;
}

export interface RenderJob {
  projectId: string;
  format: "SHORT" | "LONG_FORM";
  captions: boolean;
  scenes: RenderJobScene[];
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
  /** Storage object limit; the worker sizes the bitrate to fit under it. */
  maxBytes: number;
}

export interface YouTubeVideoMetadata {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  status: {
    privacyStatus: "private" | "unlisted" | "public";
    publishAt?: string;
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
  };
}

export interface PublishInstructions {
  /** Short-lived OAuth access token (about 1 hour); never the refresh token. */
  accessToken: string;
  metadata: YouTubeVideoMetadata;
}

export type StartedResponse = { job: RenderJob };
export type RenderedResponse = { videoUrl: string; publish: PublishInstructions | null };
export type AckResponse = { ok: true; ignored?: boolean };
