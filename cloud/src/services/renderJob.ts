import { z } from "zod";
import { ProjectStatus } from "@/generated/prisma/enums";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createSignedUpload, maxObjectBytes, publicObjectUrl } from "@/lib/storage";
import { sceneHasAssets } from "./pipeline";
import type { AckResponse, RenderEvent, RenderJob, RenderedResponse, StartedResponse } from "./renderContract";
import { buildYouTubeMetadata, getChannelAccessToken, wantedVisibility } from "./youtube";
import { isLockedPrivate } from "./youtubeVisibility";

/**
 * Server side of the render webhook. Every transition is a guarded `updateMany` so a stale or
 * duplicate event from one runner can never overwrite the state another runner owns.
 */

/** Statuses a runner may claim. Direct `workflow_dispatch` runs start from the finished states. */
const STARTABLE: ProjectStatus[] = [
  ProjectStatus.QUEUED_FOR_RENDER,
  ProjectStatus.ASSETS_READY,
  ProjectStatus.RENDERED,
  ProjectStatus.FAILED,
];

export function renderObjectPath(projectId: string, runId: string): string {
  return `projects/${projectId}/renders/run-${runId}.mp4`;
}

const WordsSchema = z.array(z.object({ word: z.string(), startMs: z.number(), endMs: z.number() }));

function clip(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function onStarted(e: Extract<RenderEvent, { event: "started" }>): Promise<StartedResponse> {
  const project = await prisma.videoProject.findUnique({
    where: { id: e.projectId },
    include: { scenes: { orderBy: { sceneIndex: "asc" } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${e.projectId} not found.`);

  const rerunOfSameJob = project.status === ProjectStatus.RENDERING && project.renderRunId === e.runId;
  if (!rerunOfSameJob && !STARTABLE.includes(project.status)) {
    throw new PipelineError("CONFLICT", `Project is ${project.status}; this run can't render it.`);
  }

  const incomplete = project.scenes.filter((s) => !sceneHasAssets(s)).map((s) => s.sceneIndex + 1);
  if (project.scenes.length === 0 || incomplete.length > 0) {
    const message = `Render refused: scenes ${incomplete.join(", ") || "(none)"} are missing audio or visuals.`;
    await prisma.videoProject.updateMany({
      where: { id: e.projectId, status: ProjectStatus.QUEUED_FOR_RENDER },
      data: { status: ProjectStatus.FAILED, lastError: message },
    });
    throw new PipelineError("CONFLICT", message);
  }

  const claimed = await prisma.videoProject.updateMany({
    where: {
      id: e.projectId,
      OR: [{ status: { in: STARTABLE } }, { status: ProjectStatus.RENDERING, renderRunId: e.runId }],
    },
    data: {
      status: ProjectStatus.RENDERING,
      renderRunId: e.runId,
      renderStartedAt: new Date(),
      renderFinishedAt: null,
      lastError: null,
    },
  });
  if (claimed.count === 0) throw new PipelineError("CONFLICT", "Another run claimed this project first.");

  const upload = await createSignedUpload(renderObjectPath(e.projectId, e.runId), "video/mp4");
  const job: RenderJob = {
    projectId: project.id,
    format: project.format,
    captions: true,
    scenes: project.scenes.map((s) => {
      const words = WordsSchema.safeParse(s.wordTimings);
      return {
        sceneIndex: s.sceneIndex,
        audioUrl: s.voiceAudioUrl!,
        imageUrl: s.imageUrl,
        videoClipUrl: s.videoClipUrl,
        durationSeconds: s.durationSeconds,
        words: words.success ? words.data : [],
      };
    }),
    upload: { url: upload.url, method: upload.method, headers: upload.headers },
    maxBytes: maxObjectBytes(),
  };
  return { job };
}

async function onRendered(e: Extract<RenderEvent, { event: "rendered" }>): Promise<RenderedResponse> {
  const project = await prisma.videoProject.findUnique({
    where: { id: e.projectId },
    include: { channel: true, scenes: { select: { sceneIndex: true, durationSeconds: true } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${e.projectId} not found.`);

  const videoUrl = publicObjectUrl(renderObjectPath(e.projectId, e.runId));
  const done = await prisma.videoProject.updateMany({
    where: { id: e.projectId, status: ProjectStatus.RENDERING, renderRunId: e.runId },
    data: { status: ProjectStatus.RENDERED, renderedVideoUrl: videoUrl, renderFinishedAt: new Date(), lastError: null },
  });
  // Idempotent for the same run: a retry after a lost response must still get publish instructions.
  const alreadyRecorded = project.status === ProjectStatus.RENDERED && project.renderRunId === e.runId;
  if (done.count === 0 && !alreadyRecorded) throw new PipelineError("CONFLICT", "This run no longer owns the project's render.");

  if (!project.channel.autoPublish || project.youtubeVideoId) return { videoUrl, publish: null };
  try {
    const accessToken = await getChannelAccessToken(project.channel);
    // The runner uploads next; hold the lease so the studio's Publish button can't upload it too.
    await prisma.videoProject.update({ where: { id: e.projectId }, data: { publishStartedAt: new Date() } });
    return { videoUrl, publish: { accessToken, metadata: buildYouTubeMetadata(project, project.scenes, project.channel) } };
  } catch (error) {
    // The render itself succeeded; keep it and explain why publishing didn't happen.
    await prisma.videoProject.update({
      where: { id: e.projectId },
      data: { lastError: clip(`Auto-publish skipped: ${errorMessage(error)}`) },
    });
    return { videoUrl, publish: null };
  }
}

async function onPublished(e: Extract<RenderEvent, { event: "published" }>): Promise<AckResponse> {
  const project = await prisma.videoProject.findUnique({
    where: { id: e.projectId },
    select: { status: true, youtubeVideoId: true, privacy: true },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${e.projectId} not found.`);

  const now = new Date();
  const done = await prisma.videoProject.updateMany({
    where: { id: e.projectId, status: ProjectStatus.RENDERED, renderRunId: e.runId },
    data: {
      status: ProjectStatus.PUBLISHED,
      youtubeVideoId: e.youtubeVideoId,
      publishedAt: now,
      lastError: null,
      publishStartedAt: null,
      // Uploads from an unaudited Google Cloud project come back private whatever was asked for.
      youtubeLocked: e.visibility ? isLockedPrivate(wantedVisibility(project.privacy), e.visibility, now) : false,
      youtubeCheckedAt: e.visibility ? now : null,
    },
  });
  if (done.count > 0) return { ok: true };
  if (project.status === ProjectStatus.PUBLISHED && project.youtubeVideoId === e.youtubeVideoId) {
    return { ok: true, ignored: true }; // duplicate delivery
  }
  throw new PipelineError("CONFLICT", "Project is not awaiting publication from this run.");
}

async function onFailed(e: Extract<RenderEvent, { event: "failed" }>): Promise<AckResponse> {
  const done =
    e.stage === "render"
      ? await prisma.videoProject.updateMany({
          // QUEUED covers runs that died before claiming (bad secret, install failure...).
          where: {
            id: e.projectId,
            OR: [{ status: ProjectStatus.QUEUED_FOR_RENDER }, { status: ProjectStatus.RENDERING, renderRunId: e.runId }],
          },
          data: { status: ProjectStatus.FAILED, lastError: clip(e.error), renderFinishedAt: new Date() },
        })
      : await prisma.videoProject.updateMany({
          // Publishing failed after a good render: keep RENDERED so the video isn't lost.
          where: { id: e.projectId, status: ProjectStatus.RENDERED, renderRunId: e.runId },
          data: { lastError: clip(`Auto-publish failed: ${e.error}`), publishStartedAt: null },
        });
  // A second report of the same failure (worker + workflow fallback) is expected and harmless.
  return done.count === 0 ? { ok: true, ignored: true } : { ok: true };
}

export async function handleRenderEvent(event: RenderEvent): Promise<StartedResponse | RenderedResponse | AckResponse> {
  switch (event.event) {
    case "started":
      return onStarted(event);
    case "rendered":
      return onRendered(event);
    case "published":
      return onPublished(event);
    case "failed":
      return onFailed(event);
  }
}
