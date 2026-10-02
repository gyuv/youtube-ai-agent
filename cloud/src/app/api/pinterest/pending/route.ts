import { rejectUnlessBearer } from "@/lib/runnerAuth";
import { countClaimableClips } from "@/services/wan2gp";

/**
 * How many Pinterest searches are waiting, without claiming any. The scheduled GitHub Actions
 * worker (.github/workflows/pinterest-worker.yml) checks this before installing a browser.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnlessBearer(request, "PINTEREST_WORKER_SECRET");
  if (denied) return denied;

  try {
    return Response.json({ pending: await countClaimableClips("PINTEREST") });
  } catch (error) {
    console.error("Pinterest pending count failed", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
