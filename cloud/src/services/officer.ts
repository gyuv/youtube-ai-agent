import { ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { isFlowClip } from "./flowPlan";
import { FLOW_ENGINE } from "./flowWorker";
import { MANAGE_SCOPE, getChannelAccessToken } from "./youtube";
import { sceneHasAssets } from "./pipeline";

/**
 * The mastermind's officer: every autopilot run (hourly) it looks for anything that has stopped the
 * channel and resolves it on the spot, so production and posting never wait for the operator.
 * Every issue and how it was resolved is kept as a query in the Growth Lab inbox (kind "incident",
 * already marked done), for the operator to read whenever, or never. Only what no code can fix
 * (the Flow worker's computer being off) stays open, and closes itself when it's fixed.
 */

export const OFFICER_ENGINE = "OFFICER";
/** A video the autopilot gave up on is revived this many times before its topic is dropped. */
export const MAX_REVIVES = 2;
/** A Flow-only channel waiting on clips this long with no worker gets an open query. */
export const FLOW_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_FAILURES = 3;

const tag = (projectId: string) => `[project:${projectId}]`;

async function incident(channelId: string, title: string, body: string, status: "done" | "open", now: Date) {
  await prisma.mastermindRequest.create({ data: { channelId, kind: "incident", title: title.slice(0, 120), body: body.slice(0, 4000), status, resolvedAt: status === "done" ? now : null } });
}

export interface OfficerResult {
  resolved: string[];
  open: string[];
}

export async function runOfficer(maxFailures = MAX_FAILURES, now: Date = new Date()): Promise<OfficerResult> {
  const result: OfficerResult = { resolved: [], open: [] };

  // 1. Videos the autopilot gave up on: revive them, or drop the topic so the slot is refilled.
  const stuck = await prisma.videoProject.findMany({
    where: { autopilot: true, autopilotFailures: { gte: maxFailures }, youtubeVideoId: null, status: { notIn: [ProjectStatus.PUBLISHED, ProjectStatus.RENDERING, ProjectStatus.QUEUED_FOR_RENDER] } },
    select: {
      id: true,
      channelId: true,
      title: true,
      topic: true,
      lastError: true,
      scenes: { select: { voiceAudioUrl: true, imageUrl: true, videoClipUrl: true, durationSeconds: true } },
    },
    take: 10,
  });
  for (const p of stuck) {
    const name = `"${p.title ?? p.topic}"`;
    const revives = await prisma.mastermindRequest.count({ where: { channelId: p.channelId, kind: "incident", body: { contains: tag(p.id) } } });
    const problem = (p.lastError ?? "unknown error").slice(0, 600);
    if (revives < MAX_REVIVES) {
      const status = !p.scenes.length ? ProjectStatus.DRAFT : p.scenes.every(sceneHasAssets) ? ProjectStatus.ASSETS_READY : ProjectStatus.SCRIPTED;
      await prisma.videoProject.update({ where: { id: p.id }, data: { autopilotFailures: 0, autopilotRetryAt: null, lastError: null, status } });
      await incident(p.channelId, `Revived ${name}`, `${tag(p.id)}\nThe autopilot had stopped on this video: ${problem}\n\nResolved: cleared the failure and put it back in production (${status.toLowerCase().replace("_", " ")}), attempt ${revives + 1} of ${MAX_REVIVES}.`, "done", now);
      result.resolved.push(`revived ${name}`);
    } else {
      await prisma.videoProject.update({ where: { id: p.id }, data: { autopilot: false, scheduledFor: null } });
      await incident(p.channelId, `Dropped ${name}`, `${tag(p.id)}\nThis video failed again after ${MAX_REVIVES} revivals: ${problem}\n\nResolved: took it off the schedule so autopilot fills its slot with a fresh topic. It stays in the studio if you want to look.`, "done", now);
      result.resolved.push(`dropped ${name} and freed its slot`);
    }
  }

  // 2. A Flow-only video rendered with anything but Flow clips never goes out: send it back for its clips.
  const notFlow = await prisma.videoProject.findMany({
    where: { channel: { flowOnly: true }, status: ProjectStatus.RENDERED, youtubeVideoId: null },
    select: { id: true, channelId: true, title: true, topic: true, scenes: { select: { videoClipUrl: true, aiClipEngine: true, aiClipStatus: true, locked: true } } },
  });
  for (const p of notFlow) {
    if (p.scenes.every((s) => isFlowClip(s) || s.locked)) continue;
    const name = `"${p.title ?? p.topic}"`;
    await prisma.videoProject.update({ where: { id: p.id }, data: { status: ProjectStatus.ASSETS_READY, autopilotFailures: 0 } });
    const missing = p.scenes.filter((s) => !isFlowClip(s) && !s.locked).length;
    await incident(p.channelId, `Held back ${name}`, `This channel posts Google Flow video only, but ${missing} scene${missing === 1 ? " was" : "s were"} rendered from stand-in visuals.\n\nResolved: kept it off YouTube and sent it back for Flow clips; it renders again once every scene is a Flow clip.`, "done", now);
    result.resolved.push(`held back ${name} until every scene is a Flow clip`);
  }

  // 3. A non-Flow upload already scheduled on YouTube for a Flow-only channel: take it down before it
  //    goes live and rebuild the video from Flow clips.
  const scheduled = await prisma.videoProject.findMany({
    where: { channel: { flowOnly: true }, status: ProjectStatus.PUBLISHED, youtubeVideoId: { not: null }, scheduledFor: { gt: new Date(now.getTime() + 10 * 60_000) } },
    select: {
      id: true,
      channelId: true,
      title: true,
      topic: true,
      youtubeVideoId: true,
      channel: { select: { id: true, name: true, oauthRefreshTokenEnc: true, oauthScopes: true } },
      scenes: { select: { videoClipUrl: true, aiClipEngine: true, aiClipStatus: true, locked: true } },
    },
  });
  for (const p of scheduled) {
    if (p.scenes.every((s) => isFlowClip(s) || s.locked)) continue;
    const name = `"${p.title ?? p.topic}"`;
    const link = `https://youtu.be/${p.youtubeVideoId}`;
    if (!p.channel.oauthRefreshTokenEnc || !p.channel.oauthScopes.includes(MANAGE_SCOPE)) {
      const open = await prisma.mastermindRequest.findFirst({ where: { channelId: p.channelId, kind: "delete_video", status: "open", body: { contains: link } } });
      if (!open) {
        await prisma.mastermindRequest.create({
          data: { channelId: p.channelId, kind: "delete_video", title: `Delete the scheduled ${name}`, body: `${link} is scheduled but isn't Google Flow video. Delete it in YouTube Studio before it goes live, or reconnect YouTube on the channel page so the officer can do it.` },
        });
        result.open.push(`delete ${name} on YouTube`);
      }
      continue;
    }
    try {
      const token = await getChannelAccessToken(p.channel);
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(p.youtubeVideoId!)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && res.status !== 404) throw new Error(`YouTube refused to delete ${link} (${res.status})`);
    await prisma.videoProject.update({
      where: { id: p.id },
      data: { status: ProjectStatus.ASSETS_READY, youtubeVideoId: null, publishedAt: null, renderedVideoUrl: null, publishStartedAt: null, youtubeLocked: false, youtubeCheckedAt: null, autopilotFailures: 0 },
    });
    await incident(p.channelId, `Took down ${name}`, `${link} had been scheduled with stand-in visuals, but this channel posts Google Flow video only.\n\nResolved: deleted it from YouTube before it went live and sent the video back for Flow clips; it is uploaded again once every scene is a Flow clip.`, "done", now);
    result.resolved.push(`took down the non-Flow upload of ${name} and is rebuilding it with Flow`);
    } catch (error) {
      result.open.push(`couldn't take down ${name} (${error instanceof Error ? error.message : String(error)}); retrying next hour`);
    }
  }

  // 4. Flow-only channels waiting on clips while no Flow worker is there: only a person can fix that.
  const worker = await prisma.workerHeartbeat.findUnique({ where: { engine: FLOW_ENGINE } });
  const workerIdle = !worker || now.getTime() - worker.seenAt.getTime() > FLOW_IDLE_MS;
  const flowChannels = await prisma.channel.findMany({ where: { flowOnly: true, isActive: true }, select: { id: true, name: true } });
  for (const c of flowChannels) {
    const waiting = await prisma.scene.count({ where: { aiClipEngine: FLOW_ENGINE, aiClipStatus: { in: ["QUEUED", "RUNNING"] }, project: { channelId: c.id } } });
    const open = await prisma.mastermindRequest.findFirst({ where: { channelId: c.id, kind: "flow_worker", status: "open" } });
    if (waiting && workerIdle && !open) {
      await prisma.mastermindRequest.create({
        data: {
          channelId: c.id,
          kind: "flow_worker",
          title: "Start the Google Flow worker",
          body: `${c.name} only posts Google Flow video and ${waiting} clip${waiting === 1 ? " is" : "s are"} waiting, but no Flow worker has checked in ${worker ? "for over 6 hours" : "yet"}. On your computer: start flow-mcp (npm run studio), open a Flow project, then run node flow-worker.mjs. This closes itself once the worker is back.`,
        },
      });
      result.open.push(`${c.name}: Flow worker needed`);
    } else if (open && (!workerIdle || !waiting)) {
      await prisma.mastermindRequest.update({ where: { id: open.id }, data: { status: "done", resolvedAt: now } });
      result.resolved.push(`${c.name}: Flow worker is back`);
    }
  }

  await prisma.workerHeartbeat.upsert({ where: { engine: OFFICER_ENGINE }, create: { engine: OFFICER_ENGINE, seenAt: now }, update: { seenAt: now } });
  return result;
}

export interface OfficerStatus {
  checkedAt: Date | null;
  resolved24h: number;
  needsYou: number;
}

export async function officerStatus(now: Date = new Date()): Promise<OfficerStatus> {
  const since = new Date(now.getTime() - 86_400_000);
  const [beat, resolved24h, needsYou] = await Promise.all([
    prisma.workerHeartbeat.findUnique({ where: { engine: OFFICER_ENGINE } }),
    prisma.mastermindRequest.count({ where: { kind: { in: ["incident", "flow_worker"] }, status: "done", resolvedAt: { gte: since } } }),
    prisma.mastermindRequest.count({ where: { status: "open" } }),
  ]);
  return { checkedAt: beat?.seenAt ?? null, resolved24h, needsYou };
}
