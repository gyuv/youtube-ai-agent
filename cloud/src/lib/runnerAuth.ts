import { secretsMatch } from "./crypto";

/**
 * GitHub Actions runners (render worker, autopilot) authenticate to the app with
 * `Authorization: Bearer <RENDER_WEBHOOK_SECRET>`. Returns an error response, or null if allowed.
 */
const MIN_SECRET_LENGTH = 32;

export function rejectUnlessRunner(request: Request): Response | null {
  const secret = process.env.RENDER_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    console.error(`RENDER_WEBHOOK_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
    return Response.json({ error: "Runner access is not configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !secretsMatch(provided, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
