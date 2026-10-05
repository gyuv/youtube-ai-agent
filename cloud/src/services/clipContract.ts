import { z } from "zod";

/**
 * Shapes shared by the studio, the clip webhook and the GitHub Actions clip worker.
 * Kept free of server-only imports so the client components can use the types too.
 */

export const CLIP_WEBHOOK_PATH = "/api/clips/webhook";
export const CLIP_EVENT_TYPE = "clip-video";
export const CLIP_WORKFLOW_FILE = "clip-video.yml";

export const MIN_CLIP_SECONDS = 10;
export const MAX_CLIP_SECONDS = 90;

export const CaptionLineSchema = z.object({ start: z.number(), end: z.number(), text: z.string() });
export type CaptionLine = z.infer<typeof CaptionLineSchema>;

export const MomentSchema = z.object({
  id: z.string(),
  start: z.number().min(0), // seconds in the source video
  end: z.number().positive(),
  title: z.string(),
  hook: z.string(),
  reason: z.string(),
  score: z.number().min(0).max(100),
  focusX: z.number().min(0).max(1).default(0.5), // where the subject sits horizontally, for the 9:16 crop
  selected: z.boolean().default(true),
  status: z.enum(["pending", "rendering", "done", "failed"]).default("pending"),
  captions: z.array(CaptionLineSchema).default([]), // times in the source video
  videoUrl: z.string().nullish(),
  projectId: z.string().nullish(),
  error: z.string().nullish(),
});
export type Moment = z.infer<typeof MomentSchema>;

export const MomentsSchema = z.array(MomentSchema);

export const ClipLayoutSchema = z.enum(["crop", "fit"]);
export type ClipLayout = z.infer<typeof ClipLayoutSchema>;

/** What the worker needs to cut one job. */
export interface ClipWorkOrder {
  jobId: string;
  sourceUrl: string;
  layout: ClipLayout;
  burnCaptions: boolean;
  moments: Array<Pick<Moment, "id" | "start" | "end" | "title" | "focusX" | "captions">>;
}

const ids = { jobId: z.string().regex(/^[a-z0-9]{20,40}$/), runId: z.string().min(1).max(40) };

export const ClipEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("started"), ...ids }),
  z.object({ event: z.literal("upload"), ...ids, momentId: z.string() }),
  z.object({ event: z.literal("clip-done"), ...ids, momentId: z.string(), bytes: z.number().int().positive() }),
  z.object({ event: z.literal("clip-failed"), ...ids, momentId: z.string(), error: z.string().max(2000) }),
  z.object({ event: z.literal("finished"), ...ids }),
  z.object({ event: z.literal("failed"), ...ids, error: z.string().max(4000) }),
]);
export type ClipEvent = z.infer<typeof ClipEventSchema>;
