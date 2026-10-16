import { AiClipStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dispatchAutopilotRun } from "./renderDispatcher";

/**
 * Is a Google Flow worker actually there? It runs on someone's computer, which may be off for days,
 * so the autopilot asks before planning a clip: with no worker (or no credits left today) it skips
 * Flow entirely and the video renders on time with its still image, instead of waiting for a clip
 * nobody will make.
 *
 * The worker checks in on every poll (every 2 minutes while it has credits, every 10 once today's
 * are spent) and says how many credits it has left.
 */

export const FLOW_ENGINE = "FLOW";
/** A worker silent for longer than this is treated as gone. */
export const FLOW_ONLINE_MS = 15 * 60 * 1000;
/** Most a Flow clip may cost; also the least a worker must have left to take one. */
export const FLOW_CLIP_CAP = 15;

/** Heartbeat key of a worker: the shared one, or a channel's own worker ("FLOW:Juu-Muu"). */
export const flowHeartbeatKey = (channel?: string | null) => (channel ? `${FLOW_ENGINE}:${channel}` : FLOW_ENGINE);
/** A dedicated worker seen within this long keeps its channel away from the shared worker. */
export const DEDICATED_WORKER_MS = 7 * 24 * 60 * 60 * 1000;

export async function recordFlowHeartbeat(creditsLeft: number | null, now: Date = new Date(), channel?: string | null) {
  const engine = flowHeartbeatKey(channel);
  await prisma.workerHeartbeat.upsert({
    where: { engine },
    create: { engine, seenAt: now, creditsLeft },
    update: { seenAt: now, creditsLeft },
  });
}

/** Channels that have their own Flow worker (each with its own Google account and credits). */
export async function dedicatedFlowChannels(now: Date = new Date()): Promise<string[]> {
  const beats = await prisma.workerHeartbeat.findMany({ where: { engine: { startsWith: `${FLOW_ENGINE}:` }, seenAt: { gt: new Date(now.getTime() - DEDICATED_WORKER_MS) } } });
  return beats.map((b) => b.engine.slice(FLOW_ENGINE.length + 1));
}

export interface FlowWorkerStatus {
  online: boolean;
  /** Online with enough credits left today for one more clip. */
  ready: boolean;
  seenAt: Date | null;
  creditsLeft: number | null;
}

/** The shared worker, or with several workers, whether any of them can take a clip now. */
export async function flowWorkerStatus(now: Date = new Date()): Promise<FlowWorkerStatus> {
  const beats = await prisma.workerHeartbeat.findMany({ where: { OR: [{ engine: FLOW_ENGINE }, { engine: { startsWith: `${FLOW_ENGINE}:` } }] } });
  const live = beats.filter((b) => now.getTime() - b.seenAt.getTime() <= FLOW_ONLINE_MS);
  const main = beats.find((b) => b.engine === FLOW_ENGINE) ?? beats[0];
  const shown = live.find((b) => b.engine === FLOW_ENGINE) ?? live[0] ?? main;
  return {
    online: live.length > 0,
    ready: live.some((b) => b.creditsLeft === null || b.creditsLeft >= FLOW_CLIP_CAP),
    seenAt: shown?.seenAt ?? null,
    creditsLeft: shown?.creditsLeft ?? null,
  };
}

/** A video is about to render without its Flow clip: withdraw the request so no credits go to it later. */
export async function dropQueuedFlowClips(projectId: string, reason: string, now: Date = new Date()): Promise<number> {
  const { count } = await prisma.scene.updateMany({
    where: { projectId, aiClipEngine: FLOW_ENGINE, aiClipStatus: AiClipStatus.QUEUED },
    data: { aiClipStatus: AiClipStatus.FAILED, aiClipError: reason, aiClipUpdatedAt: now },
  });
  return count;
}

const NUDGE_ENGINE = "AUTOPILOT_NUDGE";
const OFFICER_ENGINE = "OFFICER"; // officer.ts writes it on every autopilot tick (it imports this file)
/** GitHub often runs the hourly autopilot schedule only every few hours; past this, the worker's poll starts one. */
export const AUTOPILOT_QUIET_MS = 65 * 60 * 1000;
const NUDGE_EVERY_MS = 30 * 60 * 1000;

/**
 * The Flow worker polls every few seconds from the operator's PC, so its poll doubles as a backup
 * clock: when no autopilot run has checked in (the officer's heartbeat) for over an hour, start one,
 * so renders and uploads still make their posting slots. At most one nudge per half hour.
 */
export async function nudgeAutopilotIfQuiet(now = new Date()): Promise<boolean> {
  const [officer, nudge] = await Promise.all([
    prisma.workerHeartbeat.findUnique({ where: { engine: OFFICER_ENGINE } }),
    prisma.workerHeartbeat.findUnique({ where: { engine: NUDGE_ENGINE } }),
  ]);
  if (officer && now.getTime() - officer.seenAt.getTime() < AUTOPILOT_QUIET_MS) return false;
  if (nudge && now.getTime() - nudge.seenAt.getTime() < NUDGE_EVERY_MS) return false;
  await prisma.workerHeartbeat.upsert({ where: { engine: NUDGE_ENGINE }, create: { engine: NUDGE_ENGINE, seenAt: now }, update: { seenAt: now } });
  await dispatchAutopilotRun();
  return true;
}
