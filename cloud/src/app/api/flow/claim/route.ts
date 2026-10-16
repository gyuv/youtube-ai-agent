import { z } from "zod";
import { PipelineError } from "@/lib/errors";
import { rejectUnlessBearer } from "@/lib/runnerAuth";
import { FLOW_CLIP_CAP, dedicatedFlowChannels, nudgeAutopilotIfQuiet, recordFlowHeartbeat } from "@/services/flowWorker";
import { claimNextClip } from "@/services/wan2gp";

/**
 * Polled by the Google Flow worker (cloud/flow/) on the operator's computer, authenticated with
 * `Authorization: Bearer <FLOW_WORKER_SECRET>`. Every poll is also a check-in (with the credits it
 * has left today), which is how the autopilot knows whether to plan Flow clips at all. A worker
 * without enough credits for a clip checks in without claiming. 204 when there is nothing to do.
 */
export const dynamic = "force-dynamic";

// channel: a dedicated worker (its own Google account) names the one channel it serves.
const Body = z.object({ creditsLeft: z.number().int().min(0).max(10_000).optional(), channel: z.string().trim().min(1).max(100).optional() }).catch({});

export async function POST(request: Request): Promise<Response> {
  const denied = rejectUnlessBearer(request, "FLOW_WORKER_SECRET");
  if (denied) return denied;

  try {
    const { creditsLeft, channel } = Body.parse(await request.json().catch(() => ({})));
    await recordFlowHeartbeat(creditsLeft ?? null, new Date(), channel);
    // Backup clock for GitHub's unreliable schedule; a failed nudge must never block the worker.
    await nudgeAutopilotIfQuiet().catch((error) => console.warn("Autopilot nudge failed", error));
    if (creditsLeft !== undefined && creditsLeft < FLOW_CLIP_CAP) return new Response(null, { status: 204 });
    // The shared worker leaves channels with their own worker alone, so each account only spends on its channel.
    const job = await claimNextClip(new Date(), "FLOW", channel ? { only: channel } : { except: await dedicatedFlowChannels() });
    return job ? Response.json(job) : new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof PipelineError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("Flow claim failed", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
