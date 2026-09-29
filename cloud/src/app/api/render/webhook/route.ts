import { z } from "zod";
import { PipelineError } from "@/lib/errors";
import { rejectUnlessRunner } from "@/lib/runnerAuth";
import { RenderEventSchema } from "@/services/renderContract";
import { handleRenderEvent } from "@/services/renderJob";

/**
 * Called only by the GitHub Actions render worker, authenticated with
 * `Authorization: Bearer <RENDER_WEBHOOK_SECRET>`.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = rejectUnlessRunner(request);
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = RenderEventSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  try {
    return Response.json(await handleRenderEvent(parsed.data));
  } catch (error) {
    if (error instanceof PipelineError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("Render webhook failed", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
