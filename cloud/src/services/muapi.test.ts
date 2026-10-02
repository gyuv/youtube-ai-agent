import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ scene: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/storage", () => ({ uploadObject: vi.fn(async (path: string) => `https://cdn/${path}`) }));
vi.mock("./pipeline", () => ({ refreshAssetStatus: vi.fn() }));

import { MUAPI_TIMEOUT_MS, pollMuapiClips, queueMuapiClip } from "./muapi";

const NOW = new Date("2026-10-02T10:00:00Z");
const SCENE = {
  id: "s1",
  projectId: "p1",
  sceneIndex: 0,
  locked: false,
  imageUrl: "https://cdn/i.jpg",
  visualPrompt: "A cat and a puppy",
  narrationText: "Hello",
  project: { status: "ASSETS_READY", format: "SHORT", channel: { defaultVisualPrompt: null } },
};

beforeEach(() => {
  vi.stubEnv("MUAPI_API_KEY", "key");
  for (const fn of Object.values(db.scene)) fn.mockReset();
  db.scene.update.mockImplementation(async ({ data }) => ({ ...SCENE, ...data }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("queueMuapiClip", () => {
  it("submits the scene image to the chosen image-to-video model in the project's aspect ratio", async () => {
    db.scene.findUnique.mockResolvedValue(SCENE);
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ request_id: "req-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const scene = await queueMuapiClip("s1", "", "kling-v2.1-standard-i2v");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.muapi.ai/api/v1/kling-v2.1-standard-i2v");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ image_url: "https://cdn/i.jpg", aspect_ratio: "9:16", duration: 5 });
    expect(scene).toMatchObject({ aiClipEngine: "MUAPI", aiClipRequestId: "req-1", aiClipStatus: "RUNNING" });
  });

  it("needs an image to animate, and a key", async () => {
    db.scene.findUnique.mockResolvedValue({ ...SCENE, imageUrl: null });
    await expect(queueMuapiClip("s1")).rejects.toThrow(/Give the scene an image/);
    vi.stubEnv("MUAPI_API_KEY", "");
    await expect(queueMuapiClip("s1")).rejects.toThrow(/MUAPI_API_KEY/);
  });
});

describe("pollMuapiClips", () => {
  const running = { id: "s1", projectId: "p1", aiClipRequestId: "req-1", aiClipUpdatedAt: NOW, project: { status: "ASSETS_READY" } };

  it("copies a finished clip into storage and makes it the scene's video", async () => {
    db.scene.findMany.mockResolvedValue([running]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/predictions/") ? Response.json({ status: "completed", outputs: ["https://muapi.cdn/clip.mp4"] }) : new Response(new Uint8Array([1, 2, 3])),
      ),
    );
    expect(await pollMuapiClips("p1", NOW)).toEqual({ finished: 1, failed: 0, running: 0 });
    expect(db.scene.update.mock.calls[0][0].data).toMatchObject({ visualSource: "MUAPI", aiClipStatus: null });
    expect(db.scene.update.mock.calls[0][0].data.videoClipUrl).toMatch(/^https:\/\/cdn\/projects\/p1\/scenes\/s1\/muapi-\d+\.mp4$/);
  });

  it("reports Muapi failures and gives up after the timeout", async () => {
    db.scene.findMany.mockResolvedValue([
      { ...running, aiClipRequestId: "req-bad" },
      { ...running, id: "s2", aiClipRequestId: "req-1", aiClipUpdatedAt: new Date(NOW.getTime() - MUAPI_TIMEOUT_MS - 1) },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => Response.json(url.includes("req-bad") ? { status: "failed", error: "NSFW filter" } : { status: "processing" })),
    );
    expect(await pollMuapiClips(undefined, NOW)).toEqual({ finished: 0, failed: 2, running: 0 });
    expect(db.scene.update.mock.calls[0][0].data.aiClipError).toBe("Muapi: NSFW filter");
  });

  it("does nothing without a key", async () => {
    vi.stubEnv("MUAPI_API_KEY", "");
    expect(await pollMuapiClips()).toEqual({ finished: 0, failed: 0, running: 0 });
    expect(db.scene.findMany).not.toHaveBeenCalled();
  });
});
