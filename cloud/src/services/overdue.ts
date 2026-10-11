import type { Channel } from "@/generated/prisma/client";
import { ProjectStatus } from "@/generated/prisma/enums";
import { PipelineError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sceneHasAssets } from "./pipeline";
import { firstFreeSlot, formatSlot } from "./schedule";

/**
 * Overdue videos: their posting slot passed before they reached YouTube (a render that couldn't
 * start, a provider outage, a publish that failed). Their script, voice, visuals and render are
 * still good, so instead of leaving them stuck in the past they move to the channel's next free
 * slot and carry on from where they stopped. Nothing is regenerated.
 */

/** A slot this far in the past counts as missed (YouTube's own scheduling has a few minutes' slack). */
export const OVERDUE_GRACE_MS = 15 * 60 * 1000;

/** Stages a missed video can resume from. Renders in flight are left to finish first. */
export const RESCHEDULABLE_STATUSES: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.SCRIPTED,
  ProjectStatus.ASSETS_READY,
  ProjectStatus.RENDERED,
  ProjectStatus.FAILED,
];

type SlotChannel = Pick<Channel, "id" | "name" | "postingCron" | "postingTimezone" | "isActive">;

interface ResumeProject {
  status: ProjectStatus;
  renderedVideoUrl: string | null;
  scenes: { voiceAudioUrl: string | null; imageUrl: string | null; videoClipUrl: string | null; durationSeconds: number }[];
}

/** The furthest stage a project's existing files support, so a failed one resumes there. */
export function resumeStatus(project: ResumeProject): ProjectStatus {
  if (project.status !== ProjectStatus.FAILED) return project.status;
  if (project.renderedVideoUrl) return ProjectStatus.RENDERED;
  if (project.scenes.length === 0) return ProjectStatus.DRAFT;
  return project.scenes.every(sceneHasAssets) ? ProjectStatus.ASSETS_READY : ProjectStatus.SCRIPTED;
}

const overdueWhere = (now: Date) => ({
  status: { in: RESCHEDULABLE_STATUSES },
  youtubeVideoId: null,
  scheduledFor: { lt: new Date(now.getTime() - OVERDUE_GRACE_MS) },
});

/** Slots already promised on each channel from now on, so two videos never share one. */
async function takenSlots(channelIds: string[], now: Date): Promise<Map<string, Date[]>> {
  const rows = await prisma.videoProject.findMany({
    where: { channelId: { in: channelIds }, scheduledFor: { gte: now } },
    select: { channelId: true, scheduledFor: true },
  });
  const taken = new Map<string, Date[]>();
  for (const row of rows) taken.set(row.channelId, [...(taken.get(row.channelId) ?? []), row.scheduledFor!]);
  return taken;
}

async function moveToSlot(
  project: ResumeProject & { id: string; title: string | null; topic: string; scheduledFor: Date | null },
  channel: SlotChannel,
  taken: Map<string, Date[]>,
  now: Date,
  { resetFailures }: { resetFailures: boolean },
) {
  const channelTaken = taken.get(channel.id) ?? [];
  const slot = firstFreeSlot(channel, channelTaken, now);
  if (slot) taken.set(channel.id, [...channelTaken, slot]);
  const status = resumeStatus(project);
  await prisma.videoProject.update({
    where: { id: project.id },
    data: {
      scheduledFor: slot,
      status,
      publishStartedAt: null,
      autopilotRetryAt: null,
      ...(resetFailures ? { autopilotFailures: 0, lastError: null } : {}),
    },
  });
  const when = slot ? formatSlot(slot, channel.postingTimezone) : "as soon as it's ready (the channel has no posting schedule)";
  const message = `"${project.title ?? project.topic}" missed its ${project.scheduledFor ? formatSlot(project.scheduledFor, channel.postingTimezone) : ""} slot; moved to ${when}, reusing its existing files.`;
  await prisma.autopilotEvent.create({ data: { level: "info", action: "rescheduled", message, channelId: channel.id, projectId: project.id } });
  return { slot, status, message };
}

const projectSelect = {
  id: true,
  channelId: true,
  title: true,
  topic: true,
  status: true,
  scheduledFor: true,
  renderedVideoUrl: true,
  scenes: { select: { voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true } },
  channel: { select: { id: true, name: true, postingCron: true, postingTimezone: true, isActive: true } },
} as const;

/**
 * Autopilot housekeeping: move every overdue autopilot video that hasn't given up to its
 * channel's next free slot, oldest first so the longest-waiting video posts first. Videos the
 * autopilot gave up on stay put for an operator (`rescheduleProject` from the dashboard).
 */
export async function rescheduleOverdue(now: Date, maxFailures: number): Promise<number> {
  const overdue = await prisma.videoProject.findMany({
    where: { ...overdueWhere(now), autopilot: true, autopilotFailures: { lt: maxFailures }, channel: { isActive: true } },
    orderBy: { scheduledFor: "asc" },
    take: 25,
    select: projectSelect,
  });
  if (overdue.length === 0) return 0;
  const taken = await takenSlots([...new Set(overdue.map((p) => p.channelId))], now);
  for (const project of overdue) await moveToSlot(project, project.channel, taken, now, { resetFailures: false });
  return overdue.length;
}

/** "Move to next slot" from the studio: any unpublished video, failed or not, with a fresh set of attempts. */
export async function rescheduleProject(projectId: string, now: Date = new Date()) {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { ...projectSelect, youtubeVideoId: true } });
  if (!project) throw new PipelineError("NOT_FOUND", `Video ${projectId} not found.`);
  if (project.youtubeVideoId || project.status === ProjectStatus.PUBLISHED) throw new PipelineError("CONFLICT", "This video is already on YouTube.");
  if (!RESCHEDULABLE_STATUSES.includes(project.status)) throw new PipelineError("CONFLICT", "This video is rendering right now. Try again once the render finishes.");
  const taken = await takenSlots([project.channelId], now);
  // Its own future slot (if any) is being given up, so it shouldn't block the search.
  taken.set(project.channelId, (taken.get(project.channelId) ?? []).filter((t) => t.getTime() !== project.scheduledFor?.getTime()));
  return moveToSlot(project, project.channel, taken, now, { resetFailures: true });
}

/** Unpublished videos whose slot has passed, for the dashboard. */
export async function countOverdue(now: Date = new Date()): Promise<number> {
  return prisma.videoProject.count({ where: overdueWhere(now) });
}

/** "Clear" on the dashboard's activity feed. */
export async function clearAutopilotEvents(): Promise<number> {
  const { count } = await prisma.autopilotEvent.deleteMany({});
  return count;
}

/** Dragging a video onto another slot on the dashboard's week view. */
export async function moveProjectToSlot(projectId: string, at: Date, now: Date = new Date()) {
  if (at.getTime() <= now.getTime()) throw new PipelineError("CONFLICT", "That slot has already passed.");
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: { id: true, channelId: true, title: true, topic: true, status: true, youtubeVideoId: true, channel: { select: { postingTimezone: true } } },
  });
  if (!project) throw new PipelineError("NOT_FOUND", `Video ${projectId} not found.`);
  // Once uploaded, YouTube holds its own publish time; moving it here would only make the studio wrong.
  if (project.youtubeVideoId || project.status === ProjectStatus.PUBLISHED) throw new PipelineError("CONFLICT", "This video is already on YouTube; change its time in YouTube Studio.");
  const clash = await prisma.videoProject.findFirst({
    where: { channelId: project.channelId, id: { not: projectId }, scheduledFor: { gte: new Date(at.getTime() - 60_000), lte: new Date(at.getTime() + 60_000) } },
    select: { id: true },
  });
  if (clash) throw new PipelineError("CONFLICT", "That slot already has a video.");
  await prisma.videoProject.update({ where: { id: projectId }, data: { scheduledFor: at, publishStartedAt: null } });
  const message = `"${project.title ?? project.topic}" moved to ${formatSlot(at, project.channel.postingTimezone)}.`;
  await prisma.autopilotEvent.create({ data: { level: "info", action: "rescheduled", message, channelId: project.channelId, projectId } });
  return { message };
}
