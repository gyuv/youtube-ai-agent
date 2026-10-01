import { z } from "zod";
import { PipelineError } from "@/lib/errors";
import { rejectUnlessBearer } from "@/lib/runnerAuth";
import { ClipReportSchema, completeClip } from "@/services/wan2gp";

/** The Wan2GP worker reports a finished (already uploaded) or failed clip here. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = rejectUnlessBearer(request, "WAN2GP_WORKER_SECRET");
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
    return Response.json(await completeClip(parsed.data));
  } catch (error) {
    if (error instanceof PipelineError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("Wan2GP report failed", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
