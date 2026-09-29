import { readFile } from "node:fs/promises";
import type { YouTubeVideoMetadata } from "@/services/renderContract";
import { readVisibility, type ReportedVisibility } from "@/services/youtubeVisibility";

/**
 * YouTube Data API v3 resumable upload (videos.insert, 1600 quota units of the free 10,000/day).
 * Interrupted transfers resume from the byte YouTube confirms instead of starting over.
 */

const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export class YouTubeUploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "YouTubeUploadError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function describe(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    const reason = body.error?.errors?.[0]?.reason;
    return `${res.status}${reason ? ` ${reason}` : ""}: ${body.error?.message ?? text.slice(0, 300)}`;
  } catch {
    return `${res.status}: ${text.slice(0, 300)}`;
  }
}

/** YouTube's `Range: bytes=0-N` header means bytes 0..N are stored; resume from N+1. */
export function nextOffsetFromRange(range: string | null): number {
  const match = range?.match(/bytes=\d+-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

export async function uploadVideoToYouTube(input: {
  filePath: string;
  metadata: YouTubeVideoMetadata;
  accessToken: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<{ videoId: string; visibility: ReportedVisibility | null }> {
  const file = await readFile(input.filePath);
  const size = file.length;
  const auth = { Authorization: `Bearer ${input.accessToken}` };

  const init = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(input.metadata),
  });
  const sessionUrl = init.headers.get("location");
  if (!init.ok || !sessionUrl) {
    throw new YouTubeUploadError(`Could not start the YouTube upload (${await describe(init)})`, init.status);
  }

  const maxAttempts = input.maxAttempts ?? 6;
  let offset = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${offset}-${size - 1}/${size}`,
        },
        body: new Uint8Array(file.subarray(offset)),
      });
      if (res.status === 200 || res.status === 201) {
        const video = (await res.json()) as { id?: string };
        if (!video.id) throw new YouTubeUploadError("YouTube accepted the upload but returned no video id", res.status);
        return { videoId: video.id, visibility: readVisibility(video) };
      }
      if (res.status === 308) {
        offset = nextOffsetFromRange(res.headers.get("range"));
        continue; // partial write acknowledged; send the rest immediately
      }
      if (res.status < 500) throw new YouTubeUploadError(`YouTube rejected the upload (${await describe(res)})`, res.status);
    } catch (error) {
      if (error instanceof YouTubeUploadError) throw error;
      // Network error: fall through to status query + backoff.
    }

    if (attempt === maxAttempts) break;
    await sleep((input.retryDelayMs ?? 2000) * 2 ** (attempt - 1));
    // Ask how much YouTube has before resending.
    const probe = await fetch(sessionUrl, { method: "PUT", headers: { ...auth, "Content-Range": `bytes */${size}` } }).catch(() => null);
    if (probe?.status === 200 || probe?.status === 201) {
      const video = (await probe.json()) as { id?: string };
      if (video.id) return { videoId: video.id, visibility: readVisibility(video) };
    }
    if (probe?.status === 308) offset = nextOffsetFromRange(probe.headers.get("range"));
  }
  throw new YouTubeUploadError(`YouTube upload did not complete after ${maxAttempts} attempts`, null);
}
