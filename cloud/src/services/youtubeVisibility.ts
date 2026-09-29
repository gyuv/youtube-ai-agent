/**
 * Reading a video's visibility back from YouTube, and spotting uploads YouTube kept private.
 * Imported by the render worker too, so it must stay free of server-only code (Prisma, secrets).
 *
 * Google Cloud projects that haven't passed the YouTube API Services audit get every
 * videos.insert upload locked as private, whatever visibility or schedule the request asked for.
 */

export type Visibility = "private" | "unlisted" | "public";

export interface ReportedVisibility {
  privacyStatus: Visibility;
  /** Present while a private video is scheduled to go public. */
  publishAt: string | null;
}

/** YouTube flips a scheduled video public around publishAt; allow for its delay. */
export const SCHEDULE_GRACE_MS = 30 * 60_000;

export const AUDIT_FORM_URL = "https://support.google.com/youtube/contact/yt_api_form";

const VISIBILITIES: readonly string[] = ["private", "unlisted", "public"];

/** The `status` of a YouTube video resource, or null if it doesn't carry one. */
export function readVisibility(video: unknown): ReportedVisibility | null {
  const status = (video as { status?: { privacyStatus?: unknown; publishAt?: unknown } } | null)?.status;
  if (!status || typeof status.privacyStatus !== "string" || !VISIBILITIES.includes(status.privacyStatus)) return null;
  const publishAt = typeof status.publishAt === "string" ? Date.parse(status.publishAt) : NaN;
  // Normalised so the webhook's strict datetime check can never reject an otherwise good publish.
  return { privacyStatus: status.privacyStatus as Visibility, publishAt: Number.isNaN(publishAt) ? null : new Date(publishAt).toISOString() };
}

/**
 * True when a video that should be (or become) visible is private on YouTube with no pending
 * schedule. A private video with a future publishAt is still waiting for its slot.
 */
export function isLockedPrivate(wanted: Visibility, reported: ReportedVisibility, now: Date = new Date()): boolean {
  if (wanted === "private" || reported.privacyStatus !== "private") return false;
  const scheduledAt = reported.publishAt ? Date.parse(reported.publishAt) : null;
  return scheduledAt === null || scheduledAt < now.getTime() - SCHEDULE_GRACE_MS;
}

/** videos.list with part=status (1 quota unit). Null when YouTube has no such video. */
export async function fetchVideoVisibility(videoId: string, accessToken: string): Promise<ReportedVisibility | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 200);
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
    } catch {
      // not JSON
    }
    throw new Error(`YouTube returned ${res.status} for the video's status: ${detail}`);
  }
  const body = (await res.json()) as { items?: unknown[] };
  return body.items?.length ? readVisibility(body.items[0]) : null;
}
