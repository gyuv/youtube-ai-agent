"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { dispatchAutopilotRun } from "@/services/renderDispatcher";

/** Start the autopilot workflow now instead of waiting for its next scheduled run. */
export async function runAutopilotNowAction(): Promise<ActionResult<{ workflowUrl: string }>> {
  await requireOperator();
  const result = await toActionResult(() => dispatchAutopilotRun());
  revalidatePath("/");
  return result;
}
