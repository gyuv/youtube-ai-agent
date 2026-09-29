import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RenderJob } from "@/services/renderContract";
import { prepareRenderProps } from "./assets";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TYPES: Record<string, string> = { mp3: "audio/mpeg", jpg: "image/jpeg", mp4: "video/mp4" };

function stubAssetServer(failFirst: string[] = []) {
  const failures = new Set(failFirst);
  const fetchMock = vi.fn<FetchFn>(async (url) => {
    if (failures.delete(url)) return new Response("busy", { status: 503 });
    const ext = url.split(".").pop()!;
    return new Response(`bytes of ${url}`, { headers: { "content-type": TYPES[ext] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const job: RenderJob = {
  projectId: "cabcdefghijklmnopqrstuvw",
  format: "SHORT",
  captions: true,
  maxBytes: 1,
  upload: { url: "u", method: "PUT", headers: {} },
  scenes: [
    { sceneIndex: 0, audioUrl: "https://cdn/a0.mp3", imageUrl: "https://cdn/i0.jpg", videoClipUrl: null, durationSeconds: 3, words: [] },
    { sceneIndex: 1, audioUrl: "https://cdn/a1.mp3", imageUrl: "https://cdn/poster1.jpg", videoClipUrl: "https://cdn/c1.mp4", durationSeconds: 4, words: [] },
  ],
};

describe("prepareRenderProps", () => {
  it("downloads assets locally, measures clips and skips posters for clip scenes", async () => {
    const fetchMock = stubAssetServer(["https://cdn/a1.mp3"]);
    const dir = await mkdtemp(path.join(os.tmpdir(), "assets-"));
    const measureVideo = vi.fn(async () => 1.5);

    const props = await prepareRenderProps(job, dir, { measureVideo, downloadOptions: { retryDelayMs: 0 } });

    expect(props.scenes).toEqual([
      { audioSrc: "scene-000-voice.mp3", imageSrc: "scene-000-image.jpg", videoSrc: null, videoDurationSeconds: null, durationSeconds: 3, words: [] },
      { audioSrc: "scene-001-voice.mp3", imageSrc: null, videoSrc: "scene-001-clip.mp4", videoDurationSeconds: 1.5, durationSeconds: 4, words: [] },
    ]);
    expect((await readdir(dir)).sort()).toEqual(["scene-000-image.jpg", "scene-000-voice.mp3", "scene-001-clip.mp4", "scene-001-voice.mp3"]);
    expect(await readFile(path.join(dir, "scene-001-voice.mp3"), "utf8")).toBe("bytes of https://cdn/a1.mp3"); // retried after 503
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain("https://cdn/poster1.jpg");
    expect(measureVideo).toHaveBeenCalledWith(path.join(dir, "scene-001-clip.mp4"));
  });

  it("fails clearly when an asset stays unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchFn>(async () => new Response("gone", { status: 404 })));
    const dir = await mkdtemp(path.join(os.tmpdir(), "assets-"));
    await expect(
      prepareRenderProps(job, dir, { measureVideo: async () => null, downloadOptions: { retryDelayMs: 0, attempts: 2 } }),
    ).rejects.toThrow(/Download failed for https:\/\/cdn\/a0\.mp3: Error: HTTP 404/);
  });
});
