"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createVideoNow } from "@/services/autopilot";
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
