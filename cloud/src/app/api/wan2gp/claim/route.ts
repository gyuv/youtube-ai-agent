import { PipelineError } from "@/lib/errors";
import { rejectUnlessBearer } from "@/lib/runnerAuth";
import { claimNextClip } from "@/services/wan2gp";

/**
 * Polled by the Wan2GP GPU worker (cloud/colab/), authenticated with
 * `Authorization: Bearer <WAN2GP_WORKER_SECRET>`. 204 when no clip is waiting.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = rejectUnlessBearer(request, "WAN2GP_WORKER_SECRET");
  if (denied) return denied;

  try {
    const job = await claimNextClip();
    return job ? Response.json(job) : new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof PipelineError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("Wan2GP claim failed", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
