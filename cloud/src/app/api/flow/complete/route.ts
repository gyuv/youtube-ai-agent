import { z } from "zod";
import { PipelineError } from "@/lib/errors";
import { rejectUnlessBearer } from "@/lib/runnerAuth";
import { ClipReportSchema, completeClip } from "@/services/wan2gp";

/** The Google Flow worker reports a finished (already uploaded) clip, or why it made none (over the credit cap, out of daily credits, Flow failed). */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = rejectUnlessBearer(request, "FLOW_WORKER_SECRET");
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = ClipReportSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  try {
    return Response.json(await completeClip(parsed.data, "FLOW"));
  } catch (error) {
    if (error instanceof PipelineError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("Flow report failed", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
