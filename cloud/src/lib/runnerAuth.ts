import { secretsMatch } from "./crypto";

/**
 * Workers outside Vercel authenticate to the app with `Authorization: Bearer <secret>`:
 * GitHub Actions runners (render worker, autopilot) use RENDER_WEBHOOK_SECRET and the
 * Wan2GP GPU worker uses WAN2GP_WORKER_SECRET, and the Pinterest worker PINTEREST_WORKER_SECRET. Returns an error response, or null if allowed.
 */
const MIN_SECRET_LENGTH = 32;

export function rejectUnlessBearer(request: Request, secretEnv: string): Response | null {
  const secret = process.env[secretEnv]?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    console.error(`${secretEnv} is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
    return Response.json({ error: "Runner access is not configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !secretsMatch(provided, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function rejectUnlessRunner(request: Request): Response | null {
  return rejectUnlessBearer(request, "RENDER_WEBHOOK_SECRET");
}
