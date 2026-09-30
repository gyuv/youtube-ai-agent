import { ProjectStatus } from "@/generated/prisma/enums";
import { PipelineError, errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { publishLeaseFree } from "@/lib/statuses";
import { uploadVideoToYouTube } from "@/worker/youtubeUpload";
import { buildYouTubeMetadata, getChannelAccessToken, wantedVisibility } from "./youtube";
import { fetchVideoVisibility, isLockedPrivate, type ReportedVisibility } from "./youtubeVisibility";

/**
 * Publishes a video that was rendered without auto-publish (or whose auto-publish failed): the
 * stored MP4 is uploaded to YouTube from the app, without rendering it again.
 */

const clip = (text: string, max = 2000) => (text.length > max ? `${text.slice(0, max)}…` : text);

async function downloadRender(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new PipelineError("PROVIDER", `Could not download the rendered video: ${errorMessage(error)}`, { cause: error });
  }
  if (!res.ok) throw new PipelineError("PROVIDER", `Could not download the rendered video (${res.status}). Render it again.`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function publishRenderedProject(
  projectId: string,
  now: Date = new Date(),
): Promise<{ youtubeVideoId: string; visibility: ReportedVisibility | null; locked: boolean; scheduledFor: Date | null }> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { channel: true, scenes: { select: { sceneIndex: true, durationSeconds: true } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Project ${projectId} not found.`);
  if (project.status === ProjectStatus.PUBLISHED) throw new PipelineError("CONFLICT", "This video is already on YouTube.");
  if (project.status !== ProjectStatus.RENDERED || !project.renderedVideoUrl) {
    throw new PipelineError("CONFLICT", "Render the video first, then publish it.");
  }
  if (!project.channel.oauthRefreshTokenEnc) {
    throw new PipelineError("CONFLICT", `Connect "${project.channel.name}" to YouTube first: Channels → ${project.channel.name} → Connect YouTube.`);
  }

  const claimed = await prisma.videoProject.updateMany({
    where: { id: projectId, status: ProjectStatus.RENDERED, youtubeVideoId: null, ...publishLeaseFree(now) },
    data: { publishStartedAt: now },
  });
  if (claimed.count === 0) {
    throw new PipelineError("CONFLICT", "This video is already being uploaded to YouTube. Refresh the page in a minute.");
  }

  const metadata = buildYouTubeMetadata(project, project.scenes, project.channel, now);
  let upload: Awaited<ReturnType<typeof uploadVideoToYouTube>>;
  let accessToken: string;
  try {
    accessToken = await getChannelAccessToken(project.channel);
    const file = await downloadRender(project.renderedVideoUrl);
    // Few, short retries: this runs inside a request with a time limit.
    upload = await uploadVideoToYouTube({ file, metadata, accessToken, maxAttempts: 3, retryDelayMs: 1000 });
  } catch (error) {
    const message = `Publishing to YouTube failed: ${errorMessage(error)}`;
    await prisma.videoProject
      .update({ where: { id: projectId }, data: { publishStartedAt: null, lastError: clip(message) } })
      .catch(() => {});
    throw error instanceof PipelineError ? error : new PipelineError("PROVIDER", message, { cause: error });
  }

  // The video is on YouTube now. From here on keep the lease if anything fails, so a retry can't
  // upload it a second time.
  let visibility = upload.visibility;
  try {
    visibility = (await fetchVideoVisibility(upload.videoId, accessToken)) ?? visibility;
  } catch {
    // keep what the upload response said
  }
  const finishedAt = new Date();
  const locked = visibility ? isLockedPrivate(wantedVisibility(project.privacy), visibility, finishedAt) : false;
  try {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.PUBLISHED,
        youtubeVideoId: upload.videoId,
        publishedAt: finishedAt,
        lastError: null,
        publishStartedAt: null,
        youtubeLocked: locked,
        youtubeCheckedAt: visibility ? finishedAt : null,
      },
    });
  } catch (error) {
    throw new PipelineError(
      "PROVIDER",
      `The video was uploaded (https://youtu.be/${upload.videoId}) but the studio couldn't record it: ${errorMessage(error)}. Don't publish it again.`,
      { cause: error },
    );
  }
  return { youtubeVideoId: upload.videoId, visibility, locked, scheduledFor: metadata.status.publishAt ? new Date(metadata.status.publishAt) : null };
}
