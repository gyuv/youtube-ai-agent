import { z } from "zod";
import { secretsMatch } from "@/lib/crypto";
import { PipelineError } from "@/lib/errors";
import { RenderEventSchema } from "@/services/renderContract";
import { handleRenderEvent } from "@/services/renderJob";

/**
 * Called only by the GitHub Actions render worker, authenticated with
 * `Authorization: Bearer <RENDER_WEBHOOK_SECRET>`.
 */
export const dynamic = "force-dynamic";

const MIN_SECRET_LENGTH = 32;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RENDER_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    console.error(`RENDER_WEBHOOK_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
    return Response.json({ error: "Render webhook is not configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !secretsMatch(provided, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
