import { ProjectStatus } from "@/generated/prisma/enums";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { uploadVideoToYouTube } from "@/worker/youtubeUpload";
import { buildYouTubeMetadata, getChannelAccessToken, wantedVisibility } from "./youtube";
import { fetchVideoVisibility, isLockedPrivate } from "./youtubeVisibility";

/**
 * Publish a video that is already rendered (status RENDERED, mp4 in storage) without rendering it
 * again: the studio's "Publish to YouTube" button and the autopilot's catch-up step. The render
 * worker still publishes fresh renders itself when the channel has auto-publish on.
 *
 * The mp4 is read into memory (Shorts are a few MB; storage caps files at 50 MB on Supabase) and
 * sent with the same resumable uploader the worker uses.
 */

/** A publish that started this long ago without finishing is assumed dead and may be retried. */
export const PUBLISH_LOCK_MS = 15 * 60 * 1000;
/** Autopilot retries a failed publish at most this often, so a broken channel doesn't burn quota. */
export const AUTO_PUBLISH_RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

const clip = (text: string) => text.slice(0, 2000);

async function downloadRendered(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new PipelineError("PROVIDER", `Could not download the rendered video: ${errorMessage(error)}`, { cause: error });
  }
  if (!res.ok) throw new PipelineError("PROVIDER", `Could not download the rendered video (${res.status}). Render it again.`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new PipelineError("CONFLICT", "The rendered video is too large to publish from the studio; render it again with auto-publish on.");
  return new Uint8Array(await res.arrayBuffer());
}

export async function publishRenderedProject(projectId: string, now: Date = new Date()): Promise<{ youtubeVideoId: string; locked: boolean }> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { channel: true, scenes: { select: { sceneIndex: true, durationSeconds: true } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  if (project.youtubeVideoId) throw new PipelineError("CONFLICT", "This video is already on YouTube.");
  if (project.status !== ProjectStatus.RENDERED || !project.renderedVideoUrl) {
    throw new PipelineError("CONFLICT", `Only rendered videos can be published (this one is ${project.status}).`);
  }

  // Claim the publish so a double click or a concurrent autopilot step can't upload twice.
  const { count } = await prisma.videoProject.updateMany({
    where: {
      id: projectId,
      status: ProjectStatus.RENDERED,
      youtubeVideoId: null,
      OR: [{ publishStartedAt: null }, { publishStartedAt: { lt: new Date(now.getTime() - PUBLISH_LOCK_MS) } }],
    },
    data: { publishStartedAt: now },
  });
  if (count === 0) throw new PipelineError("CONFLICT", "This video is already being published. Give it a few minutes.");

  try {
    const accessToken = await getChannelAccessToken(project.channel);
    const metadata = buildYouTubeMetadata(project, project.scenes, project.channel, now);
    const bytes = await downloadRendered(project.renderedVideoUrl);
    const upload = await uploadVideoToYouTube({ bytes, metadata, accessToken });
    // A fresh read wins over the upload response; neither is required for the publish to count.
    const visibility = (await fetchVideoVisibility(upload.videoId, accessToken).catch(() => null)) ?? upload.visibility;
    const locked = visibility ? isLockedPrivate(wantedVisibility(project.privacy), visibility, now) : false;

    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.PUBLISHED,
        youtubeVideoId: upload.videoId,
        publishedAt: new Date(),
        lastError: null,
        youtubeLocked: locked,
        youtubeCheckedAt: visibility ? new Date() : null,
      },
    });
    return { youtubeVideoId: upload.videoId, locked };
  } catch (error) {
    // Keep RENDERED (the video isn't lost) and leave publishStartedAt set, which paces autopilot retries.
    await prisma.videoProject.update({ where: { id: projectId }, data: { lastError: clip(`Publishing to YouTube failed: ${errorMessage(error)}`) } });
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `Publishing to YouTube failed: ${errorMessage(error)}`, { cause: error });
  }
}

/** The next rendered-but-unpublished video on an auto-publish channel, if any is due a try. */
export async function findVideoToAutoPublish(now: Date = new Date()) {
  return prisma.videoProject.findFirst({
    where: {
      status: ProjectStatus.RENDERED,
      youtubeVideoId: null,
      renderedVideoUrl: { not: null },
      channel: { autoPublish: true, isActive: true, oauthRefreshTokenEnc: { not: null } },
      OR: [{ publishStartedAt: null }, { publishStartedAt: { lt: new Date(now.getTime() - AUTO_PUBLISH_RETRY_MS) } }],
    },
    orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { renderFinishedAt: "asc" }],
    select: { id: true, channelId: true, title: true, topic: true },
  });
}
