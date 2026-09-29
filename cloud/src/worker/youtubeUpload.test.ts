import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { YouTubeVideoMetadata } from "@/services/renderContract";
import { nextOffsetFromRange, uploadVideoToYouTube } from "./youtubeUpload";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const METADATA: YouTubeVideoMetadata = {
  snippet: { title: "T", description: "D", tags: [], categoryId: "22" },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
};
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";
const FILE = Buffer.from("0123456789");
let filePath = "";

beforeAll(async () => {
  filePath = path.join(await mkdtemp(path.join(os.tmpdir(), "yt-")), "video.mp4");
  await writeFile(filePath, FILE);
});

function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn<FetchFn>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const started = () => new Response(null, { status: 200, headers: { location: SESSION } });
const done = (id = "dQw4w9WgXcQ", status?: object) => new Response(JSON.stringify({ id, status }), { status: 200 });
const partial = (lastByte: number) => new Response(null, { status: 308, headers: { range: `bytes=0-${lastByte}` } });
const bodyText = (init?: RequestInit) => Buffer.from(init?.body as Uint8Array).toString();

describe("nextOffsetFromRange", () => {
  it("resumes after the last stored byte", () => {
    expect(nextOffsetFromRange("bytes=0-4")).toBe(5);
    expect(nextOffsetFromRange(null)).toBe(0);
  });
});

describe("uploadVideoToYouTube", () => {
  it("returns the visibility YouTube applied", async () => {
    stubFetch(started(), done("dQw4w9WgXcQ", { privacyStatus: "private", uploadStatus: "uploaded" }));
    await expect(uploadVideoToYouTube({ filePath, metadata: METADATA, accessToken: "t" })).resolves.toEqual({
      videoId: "dQw4w9WgXcQ",
      visibility: { privacyStatus: "private", publishAt: null },
    });
  });

  it("opens a resumable session with the metadata and uploads the file", async () => {
    const fetchMock = stubFetch(started(), done());
    await expect(uploadVideoToYouTube({ filePath, metadata: METADATA, accessToken: "ya29.x" })).resolves.toEqual({ videoId: "dQw4w9WgXcQ", visibility: null });

    const [initUrl, init] = fetchMock.mock.calls[0];
    expect(initUrl).toContain("uploadType=resumable&part=snippet,status");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer ya29.x", "X-Upload-Content-Length": "10" });
    expect(JSON.parse(String(init?.body))).toEqual(METADATA);

    const [putUrl, put] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(SESSION);
    expect(put?.headers).toMatchObject({ "Content-Range": "bytes 0-9/10" });
    expect(bodyText(put)).toBe("0123456789");
  });

  it("sends only the remainder after a partial write", async () => {
    const fetchMock = stubFetch(started(), partial(3), done());
    await uploadVideoToYouTube({ filePath, metadata: METADATA, accessToken: "t" });
    const resume = fetchMock.mock.calls[2][1];
    expect(resume?.headers).toMatchObject({ "Content-Range": "bytes 4-9/10" });
    expect(bodyText(resume)).toBe("456789");
  });

  it("asks YouTube how much it has after a network error, then resumes", async () => {
    const fetchMock = stubFetch(started(), new Error("socket hang up"), partial(6), done());
    await uploadVideoToYouTube({ filePath, metadata: METADATA, accessToken: "t", retryDelayMs: 0 });
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ "Content-Range": "bytes */10" });
    expect(bodyText(fetchMock.mock.calls[3][1])).toBe("789");
  });

  it("surfaces quota errors with YouTube's reason", async () => {
    const quota = new Response(JSON.stringify({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }), { status: 403 });
    stubFetch(quota);
    await expect(uploadVideoToYouTube({ filePath, metadata: METADATA, accessToken: "t" })).rejects.toThrow(/403 quotaExceeded/);
  });
});
