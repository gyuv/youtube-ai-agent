"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createVideoNow, createVideosAhead } from "@/services/autopilot";
import { setFullAutomation } from "@/services/channels";
import { dispatchAutopilotRun } from "@/services/renderDispatcher";

/** Start the autopilot workflow now instead of waiting for its next scheduled run. */
export async function runAutopilotNowAction(): Promise<ActionResult<{ workflowUrl: string }>> {
  await requireOperator();
  const result = await toActionResult(() => dispatchAutopilotRun());
  revalidatePath("/");
  return result;
}

/** Plan one video right now on a channel, and start the autopilot so it gets made. */
export async function createVideoNowAction(
  channelId: string,
): Promise<ActionResult<{ projectId: string; topic: string; autopilot: boolean; runError: string | null }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const created = await createVideoNow(z.string().min(1).parse(channelId));
    let runError: string | null = null;
    if (created.autopilot) {
      // The video is saved either way; a failed dispatch is picked up by the next scheduled run.
      await dispatchAutopilotRun().catch((error) => {
        runError = errorMessage(error);
      });
    }
    return { ...created, runError };
  });
  revalidatePath("/");
  return result;
}

/** The dashboard's master automation switch for one channel. */
export async function setFullAutomationAction(channelId: string, enabled: boolean): Promise<ActionResult> {
  await requireOperator();
  const result = await toActionResult(async () => {
    await setFullAutomation(z.string().min(1).parse(channelId), z.boolean().parse(enabled));
    return null;
  });
  revalidatePath("/");
  revalidatePath("/channels");
  return result;
}

/** Make videos for the next `count` posting slots now, even if those slots are days away. */
export async function createVideosAheadAction(
  channelId: string,
  count: number,
): Promise<ActionResult<{ projectIds: string[]; topics: string[]; autopilot: boolean; runError: string | null }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const created = await createVideosAhead(z.string().min(1).parse(channelId), z.number().int().min(1).max(14).parse(count));
    const autopilot = created[0]?.autopilot ?? false;
    let runError: string | null = null;
    if (autopilot) {
      await dispatchAutopilotRun().catch((error) => {
        runError = errorMessage(error);
      });
    }
    return { projectIds: created.map((c) => c.projectId), topics: created.map((c) => c.topic), autopilot, runError };
  });
  revalidatePath("/");
  return result;
}

/** Make the video for one specific open slot on the schedule now. */
export async function makeSlotNowAction(channelId: string, atIso: string): Promise<ActionResult<{ projectId: string; topic: string; autopilot: boolean; runError: string | null }>> {
  await requireOperator();
  const result = await toActionResult(async () => {
    const at = new Date(z.iso.datetime({ offset: true }).parse(atIso));
    const created = await createVideoNow(z.string().min(1).parse(channelId), new Date(), at);
    let runError: string | null = null;
    if (created.autopilot) {
      await dispatchAutopilotRun().catch((error) => {
        runError = errorMessage(error);
      });
    }
    return { projectId: created.projectId, topic: created.topic, autopilot: created.autopilot, runError };
  });
  revalidatePath("/");
  return result;
}
