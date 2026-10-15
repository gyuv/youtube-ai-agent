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

export async function recordFlowHeartbeat(creditsLeft: number | null, now: Date = new Date()) {
  await prisma.workerHeartbeat.upsert({
    where: { engine: FLOW_ENGINE },
    create: { engine: FLOW_ENGINE, seenAt: now, creditsLeft },
    update: { seenAt: now, creditsLeft },
  });
}

export interface FlowWorkerStatus {
  online: boolean;
  /** Online with enough credits left today for one more clip. */
  ready: boolean;
  seenAt: Date | null;
  creditsLeft: number | null;
}

export async function flowWorkerStatus(now: Date = new Date()): Promise<FlowWorkerStatus> {
  const beat = await prisma.workerHeartbeat.findUnique({ where: { engine: FLOW_ENGINE } });
  const online = Boolean(beat && now.getTime() - beat.seenAt.getTime() <= FLOW_ONLINE_MS);
  return {
    online,
    ready: online && (beat!.creditsLeft === null || beat!.creditsLeft >= FLOW_CLIP_CAP),
    seenAt: beat?.seenAt ?? null,
    creditsLeft: beat?.creditsLeft ?? null,
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
