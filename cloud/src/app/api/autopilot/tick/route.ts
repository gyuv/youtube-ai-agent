import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { rejectUnlessRunner } from "@/lib/runnerAuth";
import { autopilotTick } from "@/services/autopilot";

/**
 * One autopilot step. Called in a loop by .github/workflows/autopilot.yml, authenticated with
 * `Authorization: Bearer <RENDER_WEBHOOK_SECRET>`. Each call stays well inside this limit.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const denied = rejectUnlessRunner(request);
  if (denied) return denied;
  try {
    return Response.json(await autopilotTick());
  } catch (error) {
    console.error("Autopilot tick failed", error);
    await prisma.autopilotEvent
      .create({ data: { level: "error", action: "error", message: `Autopilot step crashed: ${errorMessage(error)}` } })
      .catch(() => {});
    return Response.json({ action: "error", message: errorMessage(error), more: false }, { status: 500 });
  }
}
