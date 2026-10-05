import { z } from "zod";
import { ClipJobStatus, ProjectStatus, VideoFormat } from "@/generated/prisma/enums";
import { ensureClipSchema } from "@/lib/ensureSchema";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createSignedUpload, publicObjectUrl, type SignedUpload } from "@/lib/storage";
import {
  CLIP_EVENT_TYPE,
  CLIP_WORKFLOW_FILE,
  ClipLayoutSchema,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  MomentsSchema,
  type ClipEvent,
  type ClipWorkOrder,
  type Moment,
} from "./clipContract";
import { findMoments } from "./clipFinder";
import { dispatchRepositoryEvent } from "./renderDispatcher";
import { getResearchVideo } from "./videoResearch";

export const NewClipJobSchema = z.object({
  channelId: z.string().min(1, "Pick a channel"),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Invalid video"),
  count: z.coerce.number().int().min(1).max(15).default(5),
  maxSeconds: z.coerce.number().int().min(20).max(MAX_CLIP_SECONDS).default(60),
  layout: ClipLayoutSchema.default("crop"),
  burnCaptions: z.boolean().default(true),
  confirmRights: z.literal(true, { error: "Confirm you own this video or have the rights to clip it." }),
});

/** Look up the video, have Gemini pick its best moments, and store them for review. */
export async function createClipJob(raw: z.input<typeof NewClipJobSchema>) {
  const input = NewClipJobSchema.parse(raw);
  await ensureClipSchema();
  const channel = await prisma.channel.findUnique({ where: { id: input.channelId }, select: { id: true } });
  if (!channel) throw new PipelineError("NOT_FOUND", "Channel not found.");
  const video = await getResearchVideo(input.videoId);
  if (video.durationSeconds !== null && video.durationSeconds < 60) {
    throw new PipelineError("CONFLICT", "This video is already short; clipping works on videos longer than a minute.");
  }
  const found = await findMoments({
    videoId: video.id,
    title: video.title,
    durationSeconds: video.durationSeconds,
    count: input.count,
    maxSeconds: input.maxSeconds,
  });
  return prisma.clipJob.create({
    data: {
      channelId: channel.id,
      videoId: video.id,
      sourceTitle: video.title,
      durationSeconds: video.durationSeconds,
      moments: found.moments,
      momentSource: found.source,
      layout: input.layout,
      burnCaptions: input.burnCaptions,
    },
  });
}

export async function listClipJobs() {
  await ensureClipSchema();
  return prisma.clipJob.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { channel: { select: { name: true } } } });
}

export async function getClipJob(id: string) {
  await ensureClipSchema();
  const job = await prisma.clipJob.findUnique({ where: { id }, include: { channel: { select: { id: true, name: true } } } });
  if (!job) throw new PipelineError("NOT_FOUND", "Clip job not found.");
  return { ...job, moments: MomentsSchema.parse(job.moments) };
}

export const MomentEditSchema = z.array(
  z.object({ id: z.string(), start: z.number().min(0), end: z.number().positive(), title: z.string().trim().min(1).max(100), selected: z.boolean() }),
);

/** Save the operator's trims, titles and picks. Only while the job is in review. */
export async function updateMoments(jobId: string, raw: z.input<typeof MomentEditSchema>) {
  const edits = MomentEditSchema.parse(raw);
  const job = await getClipJob(jobId);
  if (job.status === ClipJobStatus.RENDERING) throw new PipelineError("CONFLICT", "Clips are rendering; wait for them to finish.");
  const byId = new Map(edits.map((e) => [e.id, e]));
  const moments = job.moments.map((m) => {
    const e = byId.get(m.id);
    if (!e) return m;
    const start = Math.min(e.start, e.end);
    const end = Math.max(e.start, e.end);
    if (end - start < MIN_CLIP_SECONDS || end - start > MAX_CLIP_SECONDS) {
      throw new PipelineError("CONFLICT", `"${e.title}" must be ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} seconds long.`);
    }
    if (job.durationSeconds && end > job.durationSeconds + 1) throw new PipelineError("CONFLICT", `"${e.title}" ends after the video does.`);
    // Captions follow the source video's clock, so a trim just filters them.
    const captions = m.captions.filter((c) => c.end > start && c.start < end);
    return { ...m, start, end, title: e.title, selected: e.selected, captions };
  });
  await prisma.clipJob.update({ where: { id: jobId }, data: { moments } });
}

/** Start the GitHub Actions clip worker for the selected moments that aren't done yet. */
export async function renderClipJob(jobId: string) {
  const job = await getClipJob(jobId);
  if (job.status === ClipJobStatus.RENDERING) throw new PipelineError("CONFLICT", "These clips are already rendering.");
  const todo = job.moments.filter((m) => m.selected && m.status !== "done");
  if (!todo.length) throw new PipelineError("CONFLICT", "Select at least one moment that hasn't been rendered yet.");
  const moments = job.moments.map((m) => (todo.includes(m) ? { ...m, status: "pending" as const, error: null } : m));
  await prisma.clipJob.update({ where: { id: jobId }, data: { status: ClipJobStatus.RENDERING, moments, lastError: null, renderRunId: null } });
  try {
    await dispatchRepositoryEvent(CLIP_EVENT_TYPE, { job_id: jobId });
  } catch (error) {
    await prisma.clipJob.update({ where: { id: jobId }, data: { status: ClipJobStatus.REVIEW, lastError: (error as Error).message } });
    throw error;
  }
  return { workflowFile: CLIP_WORKFLOW_FILE, count: todo.length };
}

export async function deleteClipJob(jobId: string) {
  await prisma.clipJob.delete({ where: { id: jobId } });
}

// ── Worker webhook ─────────────────────────────────────────────

const clipPath = (jobId: string, momentId: string) => `clips/${jobId}/${momentId}.mp4`;

async function setMoment(jobId: string, momentId: string, patch: Partial<Moment>) {
  // Read-modify-write inside a transaction so two clip events can't overwrite each other.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ClipJob" WHERE "id" = ${jobId} FOR UPDATE`; // serialise concurrent events
    const row = await tx.clipJob.findUnique({ where: { id: jobId } });
    if (!row) throw new PipelineError("NOT_FOUND", "Clip job not found.");
    const moments = MomentsSchema.parse(row.moments);
    const moment = moments.find((m) => m.id === momentId);
    if (!moment) throw new PipelineError("NOT_FOUND", "Moment not found.");
    Object.assign(moment, patch);
    await tx.clipJob.update({ where: { id: jobId }, data: { moments } });
    return { job: row, moment };
  });
}

type ClipEventResponse = { ok: true } | ClipWorkOrder | SignedUpload;

export async function handleClipEvent(event: ClipEvent): Promise<ClipEventResponse> {
  switch (event.event) {
    case "started": {
      const job = await getClipJob(event.jobId);
      if (job.status !== ClipJobStatus.RENDERING) throw new PipelineError("CONFLICT", `Clip job is ${job.status}, not RENDERING.`);
      const moments = job.moments.map((m) => (m.selected && m.status !== "done" ? { ...m, status: "rendering" as const } : m));
      await prisma.clipJob.update({ where: { id: job.id }, data: { renderRunId: event.runId, moments } });
      return {
        jobId: job.id,
        sourceUrl: `https://www.youtube.com/watch?v=${job.videoId}`,
        layout: ClipLayoutSchema.catch("crop").parse(job.layout),
        burnCaptions: job.burnCaptions,
        moments: moments
          .filter((m) => m.status === "rendering")
          .map(({ id, start, end, title, focusX, captions }) => ({ id, start, end, title, focusX, captions })),
      };
    }
    case "upload":
      await getClipJob(event.jobId);
      return createSignedUpload(clipPath(event.jobId, event.momentId), "video/mp4");
    case "clip-done": {
      const job = await getClipJob(event.jobId);
      const moment = job.moments.find((m) => m.id === event.momentId);
      if (!moment) throw new PipelineError("NOT_FOUND", "Moment not found.");
      if (moment.status === "done" && moment.projectId) return { ok: true }; // duplicate report
      const publicUrl = publicObjectUrl(clipPath(event.jobId, event.momentId));
      const channel = await prisma.channel.findUniqueOrThrow({ where: { id: job.channelId } });
      const source = `https://youtu.be/${job.videoId}?t=${Math.floor(moment.start)}`;
      // A rendered project per clip, so the studio's normal publish flow (and autopilot) applies.
      const project = await prisma.videoProject.create({
        data: {
          channelId: job.channelId,
          topic: `Clip from "${job.sourceTitle}"`,
          status: ProjectStatus.RENDERED,
          format: VideoFormat.SHORT,
          title: moment.title,
          description: `${moment.hook}\n\nFrom the full video: ${source}`,
          tags: [],
          privacy: channel.defaultPrivacy,
          renderedVideoUrl: publicUrl,
          renderRunId: event.runId,
          renderFinishedAt: new Date(),
        },
      });
      await setMoment(event.jobId, event.momentId, { status: "done", videoUrl: publicUrl, projectId: project.id, error: null });
      return { ok: true };
    }
    case "clip-failed":
      await setMoment(event.jobId, event.momentId, { status: "failed", error: event.error });
      return { ok: true };
    case "finished":
    case "failed": {
      const job = await getClipJob(event.jobId);
      if (job.status !== ClipJobStatus.RENDERING) return { ok: true }; // duplicate report
      const failedRun = event.event === "failed";
      const moments = job.moments.map((m) =>
        m.status === "rendering" || (failedRun && m.status === "pending" && m.selected)
          ? { ...m, status: "failed" as const, error: failedRun ? event.error : "The worker finished without this clip." }
          : m,
      );
      const anyDone = moments.some((m) => m.status === "done");
      await prisma.clipJob.update({
        where: { id: job.id },
        data: {
          moments,
          status: failedRun && !anyDone ? ClipJobStatus.FAILED : ClipJobStatus.DONE,
          lastError: failedRun ? event.error : null,
        },
      });
      return { ok: true };
    }
  }
}
