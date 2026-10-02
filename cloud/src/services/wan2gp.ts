import { createHash } from "node:crypto";
import { z } from "zod";
import { AiClipStatus, ProjectStatus, VisualSource } from "@/generated/prisma/enums";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { EDITABLE_STATUSES } from "@/lib/statuses";
import { createSignedUpload, publicObjectUrl, type SignedUpload } from "@/lib/storage";
import { refreshAssetStatus } from "./pipeline";

/**
 * AI video clips from Wan2GP (https://github.com/deepbeepmeep/Wan2GP), which needs an NVIDIA GPU
 * that Vercel and GitHub Actions don't have. A worker on a GPU machine (the Colab notebook in
 * cloud/colab/) polls this app instead of being called by it, so it needs no public URL:
 *
 *   1. The operator queues a clip for a scene (status QUEUED). The scene keeps its current visual.
 *   2. The worker claims the oldest queued scene (RUNNING) and gets a prompt plus an upload URL.
 *   3. It generates the clip, uploads it straight to storage, and reports completion.
 *   4. The clip becomes the scene's videoClipUrl; the renderer loops it to cover the narration.
 *
 * A worker that disappears (Colab sessions end) leaves its claim RUNNING; after CLAIM_TTL_MS the
 * scene is claimable again, and the stale worker's late report is ignored.
 *
 * The Pinterest worker (cloud/pinterest/) uses the same queue with aiClipEngine "PINTEREST": its job's
 * prompt is the search query, and it uploads the first video Pin it can download.
 */

export const CLAIM_TTL_MS = 45 * 60 * 1000;
const EDITABLE = [...EDITABLE_STATUSES];
const MAX_PROMPT_CHARS = 1500;

/** Wan 2.x is trained at 480p/720p; 480p keeps a free Colab T4 at a few minutes per clip. */
export function clipResolution(format: "SHORT" | "LONG_FORM"): { width: number; height: number } {
  return format === "SHORT" ? { width: 480, height: 832 } : { width: 832, height: 480 };
}

/** Engines whose clips are made by a worker that polls this app. */
export type WorkerEngine = "WAN2GP" | "PINTEREST";

/** Rows queued before aiClipEngine existed have it null and belong to Wan2GP. */
function engineOf(aiClipEngine: string | null): WorkerEngine | "MUAPI" {
  return aiClipEngine === "PINTEREST" || aiClipEngine === "MUAPI" ? aiClipEngine : "WAN2GP";
}

function engineFilter(engine: WorkerEngine) {
  return engine === "PINTEREST" ? { aiClipEngine: "PINTEREST" } : { OR: [{ aiClipEngine: null }, { aiClipEngine: "WAN2GP" }] };
}

function clipPath(projectId: string, sceneId: string, claimedAt: Date, engine: WorkerEngine = "WAN2GP"): string {
  const hash = createHash("sha256").update(`${sceneId}\u0000${claimedAt.toISOString()}`).digest("hex").slice(0, 12);
  return `projects/${projectId}/scenes/${sceneId}/${engine.toLowerCase()}-${hash}.mp4`;
}

export function clipPromptFor(scene: { visualPrompt: string | null; narrationText: string }, style?: string | null): string {
  const base = scene.visualPrompt?.trim() || scene.narrationText.trim();
  const styled = style?.trim() ? `${base}. Style: ${style.trim()}` : base;
  return `${styled}. Smooth cinematic camera motion, natural movement, high detail.`.slice(0, MAX_PROMPT_CHARS);
}

async function loadEditableScene(sceneId: string) {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, include: { project: { include: { channel: true } } } });
  if (!scene) throw new PipelineError("NOT_FOUND", `Scene ${sceneId} not found.`);
  if (!EDITABLE.includes(scene.project.status)) {
    throw new PipelineError("CONFLICT", `The project is ${scene.project.status}; scenes can't change until it leaves that state.`);
  }
  if (scene.locked) throw new PipelineError("LOCKED", `Scene ${scene.sceneIndex + 1} is locked. Unlock it to regenerate.`);
  return scene;
}

/** Ask the GPU worker for a clip. An empty prompt uses the scene's image prompt. */
export async function queueSceneClip(sceneId: string, prompt?: string) {
  const scene = await loadEditableScene(sceneId);
  const text = prompt?.trim() || clipPromptFor(scene, scene.project.channel.defaultVisualPrompt);
  return prisma.scene.update({
    where: { id: sceneId },
    data: {
      aiClipStatus: AiClipStatus.QUEUED,
      aiClipPrompt: text.slice(0, MAX_PROMPT_CHARS),
      aiClipError: null,
      aiClipUpdatedAt: new Date(),
      aiClipEngine: "WAN2GP",
      aiClipRequestId: null,
    },
  });
}

/** Withdraw a request (or clear a failure). A worker already generating it is ignored when it reports. */
export async function cancelSceneClip(sceneId: string) {
  return prisma.scene.update({
    where: { id: sceneId },
    data: { aiClipStatus: null, aiClipError: null, aiClipUpdatedAt: new Date(), aiClipRequestId: null },
  });
}

export interface ClipJob {
  sceneId: string;
  claimedAt: string;
  prompt: string;
  width: number;
  height: number;
  /** Narration length; the worker caps the clip and the renderer loops it. */
  durationSeconds: number;
  /** The scene's current still, for image-to-video models. */
  imageUrl: string | null;
  upload: SignedUpload;
}

/** Hand the oldest waiting request to a worker, or null when there is nothing to do. */
export async function claimNextClip(now = new Date(), engine: WorkerEngine = "WAN2GP"): Promise<ClipJob | null> {
  const stale = new Date(now.getTime() - CLAIM_TTL_MS);
  const where = {
    project: { status: { in: EDITABLE } },
    locked: false,
    // Each worker claims only its own engine's requests; Muapi clips are polled by the app itself.
    AND: [
      engineFilter(engine),
      { OR: [{ aiClipStatus: AiClipStatus.QUEUED }, { aiClipStatus: AiClipStatus.RUNNING, aiClipUpdatedAt: { lt: stale } }] },
    ],
  };

  // Two workers can race for the same row; the conditional update lets exactly one win.
  for (let attempt = 0; attempt < 3; attempt++) {
    const scene = await prisma.scene.findFirst({
      where,
      orderBy: { aiClipUpdatedAt: "asc" },
      include: { project: { select: { id: true, format: true } } },
    });
    if (!scene) return null;

    const { count } = await prisma.scene.updateMany({
      where: { id: scene.id, aiClipStatus: scene.aiClipStatus, aiClipUpdatedAt: scene.aiClipUpdatedAt },
      data: { aiClipStatus: AiClipStatus.RUNNING, aiClipUpdatedAt: now },
    });
    if (count === 0) continue;

    return {
      sceneId: scene.id,
      claimedAt: now.toISOString(),
      prompt: scene.aiClipPrompt?.trim() || (engine === "PINTEREST" ? scene.stockQuery?.trim() || scene.narrationText : clipPromptFor(scene)),
      ...clipResolution(scene.project.format),
      durationSeconds: scene.durationSeconds,
      imageUrl: scene.imageUrl,
      upload: await createSignedUpload(clipPath(scene.project.id, scene.id, now, engine), "video/mp4"),
    };
  }
  return null;
}

export const ClipReportSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), sceneId: z.string().min(1), claimedAt: z.iso.datetime() }),
  z.object({ ok: z.literal(false), sceneId: z.string().min(1), claimedAt: z.iso.datetime(), error: z.string().max(2000) }),
]);
export type ClipReport = z.infer<typeof ClipReportSchema>;

/** Record a worker's result. Reports for a claim that is no longer current (or another engine's) are ignored. */
export async function completeClip(report: ClipReport, engine: WorkerEngine = "WAN2GP"): Promise<{ applied: boolean }> {
  const claimedAt = new Date(report.claimedAt);
  const scene = await prisma.scene.findUnique({ where: { id: report.sceneId }, include: { project: { select: { id: true, status: true } } } });
  if (!scene) throw new PipelineError("NOT_FOUND", `Scene ${report.sceneId} not found.`);

  const current =
    engineOf(scene.aiClipEngine) === engine &&
    scene.aiClipStatus === AiClipStatus.RUNNING &&
    scene.aiClipUpdatedAt?.getTime() === claimedAt.getTime() &&
    !scene.locked &&
    EDITABLE.includes(scene.project.status as ProjectStatus);
  if (!current) return { applied: false };

  const { count } = await prisma.scene.updateMany({
    where: { id: scene.id, aiClipStatus: AiClipStatus.RUNNING, aiClipUpdatedAt: claimedAt },
    data: report.ok
      ? {
          aiClipStatus: null,
          aiClipError: null,
          aiClipUpdatedAt: new Date(),
          videoClipUrl: publicObjectUrl(clipPath(scene.project.id, scene.id, claimedAt, engine)),
          visualSource: engine === "PINTEREST" ? VisualSource.PINTEREST : VisualSource.WAN2GP,
        }
      : { aiClipStatus: AiClipStatus.FAILED, aiClipError: report.error.slice(0, 2000), aiClipUpdatedAt: new Date() },
  });
  if (count > 0 && report.ok) await refreshAssetStatus(scene.project.id);
  return { applied: count > 0 };
}
