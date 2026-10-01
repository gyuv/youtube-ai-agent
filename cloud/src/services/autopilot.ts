import type { Channel, Scene, VideoProject } from "@/generated/prisma/client";
import { ProjectStatus, VisualSource } from "@/generated/prisma/enums";
import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { dispatchCloudRender, fillSceneAssets, generateProjectScript, sceneHasAssets } from "./pipeline";
import { findVideoToAutoPublish, publishRenderedProject } from "./publish";
import { firstFreeSlot, formatSlot, isValidCron } from "./schedule";
import { proposeTopic } from "./topicPlanner";
import { checkYouTubeVisibility } from "./youtube";
import { SCHEDULE_GRACE_MS } from "./youtubeVisibility";

/**
 * The autopilot. A GitHub Actions workflow calls `autopilotTick` repeatedly; each call does at
 * most ONE unit of work (well inside a serverless time limit) and says whether more remains:
 *
 *   0. housekeeping: fail renders that stopped reporting, prune the activity log
 *   1. dispatch     an autopilot video whose assets are complete (or retry a failed render)
 *   2. fill         one missing voice/visual on an autopilot video
 *   3. script       an autopilot video that has only a topic
 *   4. verify       a published video whose slot has passed really went live (not locked private)
 *   5. plan         a new video for the earliest open slot inside a channel's lead window
 *
 * Work is taken in deadline order (earliest slot first) and finished before new work starts.
 * The autopilot only ever touches projects it created, and gives up on one after
 * MAX_AUTOPILOT_FAILURES so a broken project can't burn free quotas forever.
 */

export const MAX_AUTOPILOT_FAILURES = 3;
export const STALE_RENDER_MS = 3 * 60 * 60 * 1000;
/** After a video gives up, stop planning new ones on that channel for a while (circuit breaker). */
export const PLANNING_PAUSE_MS = 12 * 60 * 60 * 1000;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type TickAction = "published" | "dispatched" | "filled" | "scripted" | "verified" | "planned" | "error" | "idle";

export interface TickResult {
  action: TickAction;
  message: string;
  more: boolean;
  projectId?: string;
  channelId?: string;
  swept: number;
}

type AutopilotChannel = Pick<
  Channel,
  | "id"
  | "name"
  | "niche"
  | "targetAudience"
  | "language"
  | "defaultFormat"
  | "defaultPrivacy"
  | "defaultScriptPrompt"
  | "postingCron"
  | "postingTimezone"
  | "isActive"
  | "autopilotReview"
  | "autopilotLeadHours"
  | "autopilotVisualSource"
  | "topicBacklog"
>;

type WorkProject = Pick<VideoProject, "id" | "channelId" | "status" | "topic" | "title" | "autopilotFailures" | "scheduledFor"> & {
  scenes: Pick<Scene, "id" | "sceneIndex" | "locked" | "voiceAudioUrl" | "imageUrl" | "videoClipUrl" | "durationSeconds">[];
};

async function log(level: "info" | "error", action: string, message: string, ids: { channelId?: string; projectId?: string } = {}) {
  await prisma.autopilotEvent.create({ data: { level, action, message, ...ids } });
}

/** Renders that stopped reporting (runner died, workflow never started) become FAILED. */
async function sweepStaleRenders(now: Date): Promise<number> {
  const stale = await prisma.videoProject.findMany({
    where: {
      status: { in: [ProjectStatus.QUEUED_FOR_RENDER, ProjectStatus.RENDERING] },
      updatedAt: { lt: new Date(now.getTime() - STALE_RENDER_MS) },
    },
    select: { id: true, channelId: true, status: true },
  });
  let swept = 0;
  for (const project of stale) {
    const { count } = await prisma.videoProject.updateMany({
      where: { id: project.id, status: project.status },
      data: {
        status: ProjectStatus.FAILED,
        lastError:
          project.status === ProjectStatus.QUEUED_FOR_RENDER
            ? "No GitHub runner picked up this render for 3 hours. Is render-video.yml on the default branch with its secrets set?"
            : "The GitHub runner stopped reporting for 3 hours. Check the Actions log, then dispatch again.",
      },
    });
    if (count) {
      swept++;
      await log("error", "swept", `Render timed out (${project.status}) and was marked failed.`, { channelId: project.channelId, projectId: project.id });
    }
  }
  await prisma.autopilotEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - EVENT_RETENTION_MS) } } });
  return swept;
}

/** Count a failure; on the last allowed one, park the project as FAILED for an operator. */
async function recordFailure(project: WorkProject, step: string, error: unknown): Promise<string> {
  const failures = project.autopilotFailures + 1;
  const giveUp = failures >= MAX_AUTOPILOT_FAILURES;
  const message = `${step} failed: ${errorMessage(error)}`;
  await prisma.videoProject.update({
    where: { id: project.id },
    data: {
      autopilotFailures: failures,
      lastError: giveUp ? `Autopilot stopped after ${failures} failed attempts. Last error: ${message}` : message,
      ...(giveUp ? { status: ProjectStatus.FAILED } : {}),
    },
  });
  const summary = giveUp ? `${message} Autopilot gave up; it's waiting for you in the studio.` : `${message} (attempt ${failures} of ${MAX_AUTOPILOT_FAILURES})`;
  await log("error", "error", `"${project.title ?? project.topic}": ${summary}`, { channelId: project.channelId, projectId: project.id });
  return summary;
}

const label = (p: WorkProject) => `"${p.title ?? p.topic}"`;

function findWork(projects: WorkProject[], channels: Map<string, AutopilotChannel>) {
  const complete = (p: WorkProject) => p.scenes.length > 0 && p.scenes.every(sceneHasAssets);
  for (const p of projects) {
    const channel = channels.get(p.channelId)!;
    if (p.status === ProjectStatus.ASSETS_READY && !channel.autopilotReview) return { kind: "dispatch" as const, project: p, channel };
    // A failed render (not a failed script or asset step) is retried while attempts remain.
    if (p.status === ProjectStatus.FAILED && !channel.autopilotReview && complete(p)) return { kind: "dispatch" as const, project: p, channel };
  }
  for (const p of projects) {
    if (p.status !== ProjectStatus.SCRIPTED && p.status !== ProjectStatus.FAILED) continue;
    const scene = p.scenes.find((s) => !sceneHasAssets(s) && !s.locked);
    if (scene) return { kind: "fill" as const, project: p, channel: channels.get(p.channelId)!, sceneId: scene.id };
  }
  for (const p of projects) {
    if (p.status === ProjectStatus.DRAFT) return { kind: "script" as const, project: p, channel: channels.get(p.channelId)! };
  }
  return null;
}

/**
 * A scheduled autopilot video whose slot has passed but whose visibility was last read before it
 * should have gone live. YouTube only flips it public at the slot, so that is when a lock shows.
 */
async function findVideoToVerify(channelIds: string[], now: Date) {
  const liveBy = new Date(now.getTime() - SCHEDULE_GRACE_MS);
  const candidates = await prisma.videoProject.findMany({
    where: {
      autopilot: true,
      channelId: { in: channelIds },
      status: ProjectStatus.PUBLISHED,
      youtubeLocked: false,
      privacy: { not: "PRIVATE" },
      scheduledFor: { gte: new Date(now.getTime() - VERIFY_WINDOW_MS), lte: liveBy },
    },
    orderBy: { scheduledFor: "asc" },
    take: 20,
    select: { id: true, channelId: true, title: true, topic: true, scheduledFor: true, youtubeCheckedAt: true },
  });
  return candidates.find((p) => !p.youtubeCheckedAt || p.youtubeCheckedAt.getTime() < p.scheduledFor!.getTime() + SCHEDULE_GRACE_MS) ?? null;
}

/**
 * Channels whose latest autopilot video gave up recently. Planning more would only stack up
 * failures behind a systemic problem (bad API key, full quota), so wait for an operator.
 */
async function pausedChannels(channels: AutopilotChannel[], now: Date): Promise<Set<string>> {
  const recent = await prisma.videoProject.findMany({
    where: {
      autopilot: true,
      channelId: { in: channels.map((c) => c.id) },
      autopilotFailures: { gte: MAX_AUTOPILOT_FAILURES },
      updatedAt: { gte: new Date(now.getTime() - PLANNING_PAUSE_MS) },
    },
    select: { channelId: true },
  });
  return new Set(recent.map((p) => p.channelId));
}

/** Each channel's earliest open slot inside its production lead window, soonest first. */
async function findSlotsToPlan(channels: AutopilotChannel[], now: Date) {
  const scheduled = await prisma.videoProject.findMany({
    where: { channelId: { in: channels.map((c) => c.id) }, scheduledFor: { gte: now } },
    select: { channelId: true, scheduledFor: true },
  });
  const due: Array<{ channel: AutopilotChannel; slot: Date }> = [];
  for (const channel of channels) {
    if (!channel.postingCron || !isValidCron(channel.postingCron)) continue;
    const taken = scheduled.filter((p) => p.channelId === channel.id).map((p) => p.scheduledFor!);
    const slot = firstFreeSlot(channel, taken, now);
    if (slot && slot.getTime() <= now.getTime() + channel.autopilotLeadHours * 3_600_000) due.push({ channel, slot });
  }
  return due.sort((a, b) => a.slot.getTime() - b.slot.getTime());
}

async function nextTopic(channel: AutopilotChannel): Promise<{ topic: string; source: string }> {
  const backlog = (channel.topicBacklog ?? "").split("\n").map((t) => t.trim());
  const index = backlog.findIndex(Boolean);
  if (index >= 0) {
    const topic = backlog[index];
    const rest = backlog.filter((_, i) => i !== index).join("\n").trim();
    await prisma.channel.update({ where: { id: channel.id }, data: { topicBacklog: rest || null } });
    return { topic, source: "your topic backlog" };
  }
  const recent = await prisma.videoProject.findMany({
    where: { channelId: channel.id },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { topic: true, title: true },
  });
  const { topic } = await proposeTopic({
    niche: channel.niche,
    targetAudience: channel.targetAudience,
    language: channel.language,
    format: channel.defaultFormat,
    channelPrompt: channel.defaultScriptPrompt,
    recentTopics: recent.flatMap((p) => [p.title, p.topic].filter((t): t is string => Boolean(t))),
  });
  return { topic, source: "Gemini" };
}

export async function autopilotTick(now: Date = new Date()): Promise<TickResult> {
  const swept = await sweepStaleRenders(now);

  // Rendered videos waiting for YouTube go first: on auto-publish channels they shouldn't sit idle,
  // whether or not the channel also runs the autopilot.
  const toPublish = await findVideoToAutoPublish(now);
  if (toPublish) {
    const ids = { projectId: toPublish.id, channelId: toPublish.channelId };
    const name = `"${toPublish.title ?? toPublish.topic}"`;
    try {
      const { youtubeVideoId, locked } = await publishRenderedProject(toPublish.id, now);
      const message = `${name} published to YouTube (https://youtu.be/${youtubeVideoId})${locked ? ", but YouTube kept it private" : ""}.`;
      await log(locked ? "error" : "info", "published", message, ids);
      return { action: "published", message, more: true, swept, ...ids };
    } catch (error) {
      const message = `${name} could not be published: ${errorMessage(error)}`;
      await log("error", "published", message, ids);
      return { action: "error", message, more: true, swept, ...ids };
    }
  }

  const channels = await prisma.channel.findMany({ where: { autopilot: true, isActive: true } });
  if (channels.length === 0) return { action: "idle", message: "Autopilot is off on every channel.", more: false, swept };
  const byId = new Map(channels.map((c) => [c.id, c]));

  const projects = await prisma.videoProject.findMany({
    where: {
      autopilot: true,
      channelId: { in: [...byId.keys()] },
      autopilotFailures: { lt: MAX_AUTOPILOT_FAILURES },
      status: { in: [ProjectStatus.DRAFT, ProjectStatus.SCRIPTED, ProjectStatus.ASSETS_READY, ProjectStatus.FAILED] },
    },
    orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: {
      id: true,
      channelId: true,
      status: true,
      topic: true,
      title: true,
      autopilotFailures: true,
      scheduledFor: true,
      scenes: {
        orderBy: { sceneIndex: "asc" },
        select: { id: true, sceneIndex: true, locked: true, voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true },
      },
    },
  });

  const work = findWork(projects, byId);
  if (work) {
    const { project, channel } = work;
    const ids = { projectId: project.id, channelId: channel.id };
    try {
      if (work.kind === "dispatch") {
        const retry = project.status === ProjectStatus.FAILED;
        await dispatchCloudRender(project.id);
        // Each re-render of a failed video uses one attempt, so a render that always fails stops.
        if (retry) await prisma.videoProject.update({ where: { id: project.id }, data: { autopilotFailures: { increment: 1 } } });
        const message = `${label(project)} sent to the cloud renderer${retry ? ` (retry ${project.autopilotFailures + 1} of ${MAX_AUTOPILOT_FAILURES})` : ""}.`;
        await log("info", "dispatched", message, ids);
        return { action: "dispatched", message, more: true, swept, ...ids };
      }
      if (work.kind === "fill") {
        const result = await fillSceneAssets(work.sceneId, { visualSource: channel.autopilotVisualSource === VisualSource.PEXELS ? "PEXELS" : "POLLINATIONS" });
        if (result.errors.length) throw new Error(result.errors.join("; "));
        const message = `${label(project)}: scene ${result.sceneIndex + 1} got ${result.generated.join(" and ") || "nothing new"}.`;
        await log("info", "filled", message, ids);
        return { action: "filled", message, more: true, swept, ...ids };
      }
      const scripted = await generateProjectScript(project.id);
      const message = `${label({ ...project, title: scripted.title })}: script written, ${scripted.scenes.length} scenes.`;
      await log("info", "scripted", message, ids);
      return { action: "scripted", message, more: true, swept, ...ids };
    } catch (error) {
      const step = work.kind === "dispatch" ? "Render dispatch" : work.kind === "fill" ? "Asset generation" : "Script writing";
      const message = await recordFailure(project, step, error);
      // Other projects may still progress; failure caps keep this from looping forever.
      return { action: "error", message, more: true, swept, ...ids };
    }
  }

  const toVerify = await findVideoToVerify([...byId.keys()], now);
  if (toVerify) {
    const ids = { projectId: toVerify.id, channelId: toVerify.channelId };
    const name = `"${toVerify.title ?? toVerify.topic}"`;
    try {
      const { visibility, locked } = await checkYouTubeVisibility(toVerify.id, now);
      const message = locked
        ? `${name} is still private on YouTube after its slot: YouTube locked the upload. Open it in the studio for why.`
        : visibility
          ? `${name} is ${visibility.privacyStatus} on YouTube.`
          : `${name} is no longer on YouTube.`;
      await log(locked || !visibility ? "error" : "info", "verified", message, ids);
      return { action: "verified", message, more: true, swept, ...ids };
    } catch (error) {
      // Recorded as checked so an unreachable channel isn't retried on every step.
      await prisma.videoProject.update({ where: { id: toVerify.id }, data: { youtubeCheckedAt: now } });
      const message = `Couldn't check ${name} on YouTube: ${errorMessage(error)}`;
      await log("error", "error", message, ids);
      return { action: "error", message, more: true, swept, ...ids };
    }
  }

  const paused = await pausedChannels(channels, now);
  const due = await findSlotsToPlan(channels.filter((c) => !paused.has(c.id)), now);
  if (due.length === 0) {
    const pausedNames = channels.filter((c) => paused.has(c.id)).map((c) => c.name);
    if (pausedNames.length) {
      return {
        action: "idle",
        message: `Planning paused for 12 hours on ${pausedNames.join(", ")}: the last autopilot video there needs attention in the studio.`,
        more: false,
        swept,
      };
    }
    const upcoming = channels
      .filter((c) => c.postingCron && isValidCron(c.postingCron))
      .map((c) => `${c.name}: production for the next open slot starts ${c.autopilotLeadHours}h before it`);
    return {
      action: "idle",
      message: upcoming.length ? `Nothing due yet. ${upcoming.join("; ")}.` : "Autopilot channels need a posting schedule.",
      more: false,
      swept,
    };
  }

  // Soonest slot first; a channel that can't be planned (e.g. no Gemini quota) doesn't block the rest.
  const failures: string[] = [];
  for (const { channel, slot } of due) {
    try {
      const { topic, source } = await nextTopic(channel);
      const project = await prisma.videoProject.create({
        data: {
          channelId: channel.id,
          topic,
          format: channel.defaultFormat,
          privacy: channel.defaultPrivacy,
          scheduledFor: slot,
          autopilot: true,
        },
      });
      const message = `Planned "${topic}" (from ${source}) for ${formatSlot(slot, channel.postingTimezone)} on ${channel.name}.`;
      await log("info", "planned", message, { channelId: channel.id, projectId: project.id });
      return { action: "planned", message, more: true, swept, channelId: channel.id, projectId: project.id };
    } catch (error) {
      const message = `Couldn't plan the ${formatSlot(slot, channel.postingTimezone)} slot on ${channel.name}: ${errorMessage(error)}`;
      await log("error", "error", message, { channelId: channel.id });
      failures.push(message);
    }
  }
  // Nothing could be planned; retry on the next scheduled run rather than hammering Gemini now.
  return { action: "error", message: failures.join(" | "), more: false, swept };
}

export async function recentAutopilotEvents(limit = 12) {
  return prisma.autopilotEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
