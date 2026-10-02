import { AiClipStatus, ProjectStatus, VisualSource } from "@/generated/prisma/enums";
import { optionalEnv, requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { EDITABLE_STATUSES } from "@/lib/statuses";
import { uploadObject } from "@/lib/storage";
import { refreshAssetStatus } from "./pipeline";
import { clipPromptFor } from "./wan2gp";

/**
 * Muapi.ai: the paid API behind Open-Higgsfield-AI (github.com/Autom8AI/Open-Higgsfield-AI), with
 * 200+ hosted image and video models (Flux, Kling, Seedance, Wan, Veo, Hailuo...). Pay per
 * generation; optional, enabled by MUAPI_API_KEY.
 *
 * The studio uses its image-to-video models to animate a scene's existing image: submit returns a
 * request id, the app polls it while the project page is open (and the autopilot checks too), and
 * the finished clip is copied into our own storage so renders never depend on Muapi's links.
 */

const API = "https://api.muapi.ai/api/v1";
/** Muapi jobs that haven't finished in this long are reported as failed. */
export const MUAPI_TIMEOUT_MS = 30 * 60 * 1000;

export const MUAPI_VIDEO_MODELS = [
  { endpoint: "wan2.2-image-to-video", label: "Wan 2.2 (cheapest)" },
  { endpoint: "seedance-lite-i2v", label: "Seedance Lite" },
  { endpoint: "kling-v2.1-standard-i2v", label: "Kling 2.1 Standard" },
  { endpoint: "minimax-hailuo-02-standard-i2v", label: "Hailuo 02" },
  { endpoint: "veo3-fast-image-to-video", label: "Veo 3 Fast (premium)" },
] as const;

export function muapiEnabled(): boolean {
  return Boolean(optionalEnv("MUAPI_API_KEY"));
}

async function muapiFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "x-api-key": requireEnv("MUAPI_API_KEY"), ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `Muapi request failed: ${errorMessage(error)}`, { cause: error });
  }
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? " (check MUAPI_API_KEY)" : res.status === 402 ? " (out of Muapi credits)" : "";
    throw new PipelineError("PROVIDER", `Muapi returned ${res.status}${hint}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new PipelineError("PROVIDER", `Muapi returned non-JSON: ${text.slice(0, 120)}`);
  }
}

const outputUrl = (data: Record<string, unknown>): string | null => {
  const outputs = data.outputs as unknown[] | undefined;
  const output = data.output as { url?: string } | undefined;
  const url = outputs?.[0] ?? data.url ?? output?.url;
  return typeof url === "string" ? url : null;
};

/** Start an image-to-video job; returns the prediction id (or a finished URL for sync endpoints). */
export async function submitImageToVideo(input: { model: string; imageUrl: string; prompt: string; aspectRatio: "16:9" | "9:16"; duration: number }) {
  const data = await muapiFetch(input.model, {
    method: "POST",
    body: JSON.stringify({ prompt: input.prompt, image_url: input.imageUrl, aspect_ratio: input.aspectRatio, duration: input.duration, resolution: "720p" }),
  });
  const requestId = (data.request_id ?? data.id) as string | undefined;
  return { requestId: requestId ?? null, url: requestId ? null : outputUrl(data) };
}

export async function getPrediction(requestId: string): Promise<{ status: "done" | "failed" | "running"; url: string | null; error?: string }> {
  const data = await muapiFetch(`predictions/${encodeURIComponent(requestId)}/result`, { method: "GET" });
  const status = String(data.status ?? "").toLowerCase();
  if (["completed", "succeeded", "success"].includes(status)) return { status: "done", url: outputUrl(data) };
  if (["failed", "error"].includes(status)) return { status: "failed", url: null, error: String(data.error ?? "Muapi reported a failure") };
  return { status: "running", url: null };
}

const EDITABLE = [...EDITABLE_STATUSES];

/** Animate a scene's current image with a Muapi image-to-video model. */
export async function queueMuapiClip(sceneId: string, prompt?: string, model?: string) {
  if (!muapiEnabled()) throw new PipelineError("CONFIG", "Add MUAPI_API_KEY in Vercel to use Muapi (muapi.ai → API keys).");
  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, include: { project: { include: { channel: true } } } });
  if (!scene) throw new PipelineError("NOT_FOUND", "Scene not found.");
  if (!EDITABLE.includes(scene.project.status)) throw new PipelineError("CONFLICT", `The project is ${scene.project.status}; scenes can't change now.`);
  if (scene.locked) throw new PipelineError("LOCKED", `Scene ${scene.sceneIndex + 1} is locked.`);
  if (!scene.imageUrl) throw new PipelineError("CONFLICT", "Give the scene an image first (AI image or stock); Muapi animates it.");

  const endpoint = MUAPI_VIDEO_MODELS.some((m) => m.endpoint === model) ? model! : optionalEnv("MUAPI_VIDEO_MODEL", MUAPI_VIDEO_MODELS[0].endpoint);
  const text = (prompt?.trim() || clipPromptFor(scene, scene.project.channel.defaultVisualPrompt)).slice(0, 1500);
  const job = await submitImageToVideo({
    model: endpoint,
    imageUrl: scene.imageUrl,
    prompt: text,
    aspectRatio: scene.project.format === "SHORT" ? "9:16" : "16:9",
    duration: 5,
  });
  const updated = await prisma.scene.update({
    where: { id: sceneId },
    data: {
      aiClipEngine: "MUAPI",
      aiClipRequestId: job.requestId,
      aiClipStatus: AiClipStatus.RUNNING,
      aiClipPrompt: text,
      aiClipError: null,
      aiClipUpdatedAt: new Date(),
    },
  });
  if (job.url) await finishClip(updated.id, updated.projectId, job.url);
  return updated;
}

async function finishClip(sceneId: string, projectId: string, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new PipelineError("PROVIDER", `Couldn't download the Muapi clip (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const stored = await uploadObject(`projects/${projectId}/scenes/${sceneId}/muapi-${Date.now()}.mp4`, bytes, "video/mp4");
  await prisma.scene.update({
    where: { id: sceneId },
    data: { videoClipUrl: stored, visualSource: VisualSource.MUAPI, aiClipStatus: null, aiClipRequestId: null, aiClipError: null, aiClipUpdatedAt: new Date() },
  });
  await refreshAssetStatus(projectId);
}

/**
 * Check every running Muapi clip (optionally for one project) and collect the finished ones.
 * Cheap and idempotent: called while a project page is open and by the autopilot.
 */
export async function pollMuapiClips(projectId?: string, now = new Date()): Promise<{ finished: number; failed: number; running: number }> {
  if (!muapiEnabled()) return { finished: 0, failed: 0, running: 0 };
  const scenes = await prisma.scene.findMany({
    where: { aiClipEngine: "MUAPI", aiClipStatus: AiClipStatus.RUNNING, aiClipRequestId: { not: null }, ...(projectId ? { projectId } : {}) },
    select: { id: true, projectId: true, aiClipRequestId: true, aiClipUpdatedAt: true, project: { select: { status: true } } },
    take: 20,
  });
  const tally = { finished: 0, failed: 0, running: 0 };
  for (const scene of scenes) {
    const fail = async (message: string) => {
      tally.failed++;
      await prisma.scene.update({ where: { id: scene.id }, data: { aiClipStatus: AiClipStatus.FAILED, aiClipError: message.slice(0, 2000), aiClipUpdatedAt: now } });
    };
    if (scene.project.status === ProjectStatus.PUBLISHED) continue;
    try {
      const prediction = await getPrediction(scene.aiClipRequestId!);
      if (prediction.status === "done" && prediction.url) {
        await finishClip(scene.id, scene.projectId, prediction.url);
        tally.finished++;
      } else if (prediction.status === "failed") {
        await fail(`Muapi: ${prediction.error}`);
      } else if (scene.aiClipUpdatedAt && now.getTime() - scene.aiClipUpdatedAt.getTime() > MUAPI_TIMEOUT_MS) {
        await fail("Muapi took over 30 minutes; queue it again.");
      } else {
        tally.running++;
      }
    } catch (error) {
      tally.running++; // transient (network, 5xx): try again on the next poll
      console.error("Muapi poll failed", scene.id, errorMessage(error));
    }
  }
  return tally;
}
