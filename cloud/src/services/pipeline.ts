import { createHash } from "node:crypto";
import { Prisma, type Scene } from "@/generated/prisma/client";
import { ProjectStatus, VisualSource } from "@/generated/prisma/enums";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { EDITABLE_STATUSES, RENDERABLE_STATUSES } from "@/lib/statuses";
import { uploadObject } from "@/lib/storage";
import { dispatchRenderWorkflow } from "./renderDispatcher";
import { estimateSpeechSeconds, generateScript } from "./scriptGenerator";
import { DEFAULT_VOICE, synthesizeSpeech } from "./ttsGenerator";
import { canvasFor, findStockVisual, generatePollinationsImage } from "./visualFetcher";

/**
 * Database-aware orchestration used by the studio's API routes (and later by the runner).
 * The provider services stay pure; this module owns status transitions and storage paths.
 */

const EDITABLE = [...EDITABLE_STATUSES];
const RENDERABLE = [...RENDERABLE_STATUSES];
/** States whose status follows scene completeness after an edit. */
const ASSET_TRACKED: ProjectStatus[] = [
  ProjectStatus.SCRIPTED,
  ProjectStatus.ASSETS_READY,
  ProjectStatus.RENDERED,
  ProjectStatus.FAILED,
];

type SceneAssets = Pick<Scene, "voiceAudioUrl" | "imageUrl" | "videoClipUrl" | "durationSeconds">;

export function sceneHasAssets(scene: SceneAssets): boolean {
  return Boolean(scene.voiceAudioUrl && (scene.imageUrl || scene.videoClipUrl) && scene.durationSeconds > 0);
}

/** SCRIPTED until every scene has voice + visual, then ASSETS_READY. */
export function assetStatusFor(scenes: SceneAssets[]): ProjectStatus {
  return scenes.length > 0 && scenes.every(sceneHasAssets) ? ProjectStatus.ASSETS_READY : ProjectStatus.SCRIPTED;
}

function assertEditable(status: ProjectStatus) {
  if (!EDITABLE.includes(status)) {
    throw new PipelineError("CONFLICT", `The project is ${status}; scenes can't change until it leaves that state.`);
  }
}

function shortHash(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

async function loadScene(sceneId: string) {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { project: { include: { channel: true } } },
  });
  if (!scene) throw new PipelineError("NOT_FOUND", `Scene ${sceneId} not found.`);
  assertEditable(scene.project.status);
  if (scene.locked) throw new PipelineError("LOCKED", `Scene ${scene.sceneIndex + 1} is locked. Unlock it to regenerate.`);
  return scene;
}

export async function refreshAssetStatus(projectId: string): Promise<void> {
  const scenes = await prisma.scene.findMany({
    where: { projectId },
    select: { voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true },
  });
  await prisma.videoProject.updateMany({
    where: { id: projectId, status: { in: ASSET_TRACKED } },
    data: { status: assetStatusFor(scenes) },
  });
}

// ─────────────────────────────────────────────────────────────
// Script
// ─────────────────────────────────────────────────────────────

/** (Re)write the whole script with Gemini, replacing all scenes. Refused while any scene is locked. */
export async function generateProjectScript(projectId: string) {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { channel: true, scenes: { select: { locked: true } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  assertEditable(project.status);
  if (project.scenes.some((s) => s.locked)) {
    throw new PipelineError("LOCKED", "Unlock every scene before regenerating the whole script.");
  }

  const result = await generateScript({
    topic: project.topic,
    niche: project.channel.niche,
    format: project.format,
    language: project.channel.language,
    targetAudience: project.channel.targetAudience,
    channelPrompt: project.channel.defaultScriptPrompt,
  });

  return prisma.$transaction(async (tx) => {
    // Re-check under the transaction: a render may have been dispatched while Gemini was writing.
    const claimed = await tx.videoProject.updateMany({
      where: { id: projectId, status: { in: EDITABLE } },
      data: {
        script: asJson(result.stored),
        title: result.script.title,
        description: result.script.description,
        tags: result.script.tags,
        status: ProjectStatus.SCRIPTED,
        lastError: null,
      },
    });
    if (claimed.count === 0) throw new PipelineError("CONFLICT", "The project changed state while the script was generating.");
    await tx.scene.deleteMany({ where: { projectId } });
    await tx.scene.createMany({
      data: result.scenes.map((s) => ({
        projectId,
        sceneIndex: s.sceneIndex,
        narrationText: s.narration,
        visualPrompt: s.imagePrompt,
        stockQuery: s.stockQuery,
        visualSource: VisualSource.POLLINATIONS,
        durationSeconds: s.estimatedSeconds,
      })),
    });
    return tx.videoProject.findUniqueOrThrow({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneIndex: "asc" } } },
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Scene audio
// ─────────────────────────────────────────────────────────────

/** Save edited narration without re-voicing it; the stale audio is dropped so it can't be rendered. */
export async function updateSceneNarration(sceneId: string, narrationText: string) {
  const scene = await loadScene(sceneId);
  const text = narrationText.trim();
  if (!text) throw new PipelineError("CONFLICT", "Narration text is empty.");
  if (text === scene.narrationText) return prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  const updated = await prisma.scene.update({
    where: { id: sceneId },
    data: {
      narrationText: text,
      voiceAudioUrl: null,
      wordTimings: Prisma.DbNull,
      durationSeconds: estimateSpeechSeconds(text),
    },
  });
  await refreshAssetStatus(scene.projectId);
  return updated;
}

/** Voice one scene with edge-tts (optionally with new narration) and store the mp3. */
export async function regenerateSceneAudio(sceneId: string, options: { narrationText?: string } = {}) {
  const scene = await loadScene(sceneId);
  const { project } = scene;
  const text = options.narrationText?.trim() || scene.narrationText;
  const voice = project.voice ?? project.channel.defaultVoice ?? DEFAULT_VOICE;

  const speech = await synthesizeSpeech(text, { voice });
  const path = `projects/${project.id}/scenes/${scene.id}/voice-${shortHash(text, speech.voice)}.mp3`;
  const voiceAudioUrl = await uploadObject(path, speech.audio, speech.contentType);

  const updated = await prisma.scene.update({
    where: { id: sceneId },
    data: {
      narrationText: text,
      voiceAudioUrl,
      wordTimings: asJson(speech.wordTimings),
      durationSeconds: speech.durationSeconds,
    },
  });
  await refreshAssetStatus(project.id);
  return updated;
}

// ─────────────────────────────────────────────────────────────
// Scene visuals
// ─────────────────────────────────────────────────────────────

export interface VisualRequest {
  source?: "POLLINATIONS" | "PEXELS";
  /** New image prompt (Pollinations). Saved on the scene. */
  visualPrompt?: string;
  /** New stock search phrase (Pexels). Saved on the scene. */
  stockQuery?: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Replace one scene's visual without touching any other scene. */
export async function regenerateSceneVisual(sceneId: string, request: VisualRequest = {}) {
  const scene = await loadScene(sceneId);
  const { project } = scene;
  const canvas = canvasFor(project.format);
  const source =
    request.source ?? (scene.visualSource === VisualSource.PEXELS ? VisualSource.PEXELS : VisualSource.POLLINATIONS);

  let data: Prisma.SceneUpdateInput;
  if (source === VisualSource.PEXELS) {
    const query = request.stockQuery?.trim() || scene.stockQuery || scene.narrationText.split(/\s+/).slice(0, 4).join(" ");
    const stock = await findStockVisual(query, {
      orientation: canvas.orientation,
      minDurationSeconds: scene.durationSeconds,
      excludeUrls: [scene.videoClipUrl, scene.imageUrl].filter((u): u is string => Boolean(u)),
    });
    if (!stock) throw new PipelineError("PROVIDER", `Pexels has no ${canvas.orientation} results for "${query}".`);
    data = {
      stockQuery: query,
      visualSource: VisualSource.PEXELS,
      // Pexels assets are served from its CDN; clips are too large to copy through a serverless function.
      videoClipUrl: stock.kind === "video" ? stock.url : null,
      imageUrl: stock.kind === "video" ? stock.previewUrl : stock.url,
    };
  } else {
    const prompt = request.visualPrompt?.trim() || scene.visualPrompt?.trim();
    if (!prompt) throw new PipelineError("CONFLICT", "The scene has no visual prompt.");
    const style = project.channel.defaultVisualPrompt?.trim();
    const image = await generatePollinationsImage(style ? `${prompt}. Style: ${style}` : prompt, canvas);
    const ext = IMAGE_EXTENSIONS[image.contentType.split(";")[0]] ?? "jpg";
    const path = `projects/${project.id}/scenes/${scene.id}/visual-${shortHash(prompt, image.seed)}.${ext}`;
    data = {
      visualPrompt: prompt,
      visualSource: VisualSource.POLLINATIONS,
      imageUrl: await uploadObject(path, image.bytes, image.contentType),
      videoClipUrl: null,
    };
  }

  const updated = await prisma.scene.update({ where: { id: sceneId }, data });
  await refreshAssetStatus(project.id);
  return updated;
}

// ─────────────────────────────────────────────────────────────
// Bulk assets
// ─────────────────────────────────────────────────────────────

export interface SceneFillResult {
  sceneIndex: number;
  skipped: "locked" | null;
  generated: Array<"audio" | "visual">;
  errors: string[];
}

/**
 * Fill whatever one scene is missing (voice, then visual). The studio calls this scene by scene
 * so each request stays well inside a serverless time limit and the operator sees progress.
 */
export async function fillSceneAssets(sceneId: string, options: { visualSource?: VisualRequest["source"] } = {}): Promise<SceneFillResult> {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId } });
  if (!scene) throw new PipelineError("NOT_FOUND", `Scene ${sceneId} not found.`);
  const result: SceneFillResult = { sceneIndex: scene.sceneIndex, skipped: null, generated: [], errors: [] };
  if (scene.locked) return { ...result, skipped: "locked" };

  if (!scene.voiceAudioUrl) {
    try {
      await regenerateSceneAudio(sceneId);
      result.generated.push("audio");
    } catch (error) {
      result.errors.push(`Voice: ${errorMessage(error)}`);
    }
  }
  if (!scene.imageUrl && !scene.videoClipUrl) {
    try {
      await regenerateSceneVisual(sceneId, { source: options.visualSource });
      result.generated.push("visual");
    } catch (error) {
      result.errors.push(`Visual: ${errorMessage(error)}`);
    }
  }
  return result;
}

export interface AssetRunSummary {
  generated: number;
  skippedLocked: number[];
  failed: Array<{ sceneIndex: number; step: "audio" | "visual"; error: string }>;
  status: ProjectStatus;
}

/**
 * Fill in missing voiceovers and visuals, one scene at a time (the free providers throttle
 * parallel requests). Locked scenes are skipped. One failure doesn't stop the run.
 */
export async function generateProjectAssets(projectId: string): Promise<AssetRunSummary> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { sceneIndex: "asc" } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  assertEditable(project.status);
  if (project.scenes.length === 0) throw new PipelineError("CONFLICT", "Generate the script before its assets.");

  const summary: AssetRunSummary = { generated: 0, skippedLocked: [], failed: [], status: project.status };
  for (const scene of project.scenes) {
    if (scene.locked) {
      if (!sceneHasAssets(scene)) summary.skippedLocked.push(scene.sceneIndex);
      continue;
    }
    if (!scene.voiceAudioUrl) {
      try {
        await regenerateSceneAudio(scene.id);
        summary.generated++;
      } catch (error) {
        summary.failed.push({ sceneIndex: scene.sceneIndex, step: "audio", error: errorMessage(error) });
      }
    }
    if (!scene.imageUrl && !scene.videoClipUrl) {
      try {
        await regenerateSceneVisual(scene.id);
        summary.generated++;
      } catch (error) {
        summary.failed.push({ sceneIndex: scene.sceneIndex, step: "visual", error: errorMessage(error) });
      }
    }
  }

  // A no-op run leaves status and lastError alone, so it can't demote a RENDERED project
  // or wipe the message explaining why a render FAILED.
  if (summary.generated === 0 && summary.failed.length === 0) return summary;

  if (summary.generated > 0) await refreshAssetStatus(projectId);
  const lastError = summary.failed.length
    ? summary.failed.map((f) => `Scene ${f.sceneIndex + 1} ${f.step}: ${f.error}`).join("\n")
    : null;
  const after = await prisma.videoProject.update({ where: { id: projectId }, data: { lastError } });
  summary.status = after.status;
  return summary;
}

// ─────────────────────────────────────────────────────────────
// Cloud render
// ─────────────────────────────────────────────────────────────

/** Claim the project for rendering, then fire the GitHub Actions workflow. */
export async function dispatchCloudRender(projectId: string) {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: {
      scenes: { select: { sceneIndex: true, voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true } },
    },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  if (!RENDERABLE.includes(project.status)) {
    throw new PipelineError("CONFLICT", `A ${project.status} project can't be sent to the renderer.`);
  }
  const incomplete = project.scenes.filter((s) => !sceneHasAssets(s)).map((s) => s.sceneIndex + 1);
  if (project.scenes.length === 0 || incomplete.length > 0) {
    throw new PipelineError("CONFLICT", `Scenes ${incomplete.join(", ") || "(none)"} still need audio or a visual.`);
  }

  // Atomic claim: two clicks on "Dispatch Cloud Render" can't start two runners.
  const claimed = await prisma.videoProject.updateMany({
    where: { id: projectId, status: { in: RENDERABLE } },
    data: {
      status: ProjectStatus.QUEUED_FOR_RENDER,
      lastError: null,
      renderRunId: null,
      renderStartedAt: null,
      renderFinishedAt: null,
    },
  });
  if (claimed.count === 0) throw new PipelineError("CONFLICT", "This project is already queued for rendering.");

  try {
    return await dispatchRenderWorkflow(projectId);
  } catch (error) {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: project.status, lastError: `Render dispatch failed: ${errorMessage(error)}` },
    });
    throw error;
  }
}
