import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  scene: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  videoProject: { updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/storage", () => ({
  createSignedUpload: vi.fn(async (path: string) => ({ url: `https://upload/${path}`, method: "PUT", headers: {}, publicUrl: `https://cdn/${path}` })),
  publicObjectUrl: (path: string) => `https://cdn/${path}`,
  uploadObject: vi.fn(),
}));

import { CLAIM_TTL_MS, claimNextClip, clipPromptFor, completeClip, queueSceneClip } from "./wan2gp";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const SCENE = {
  id: "s1",
  sceneIndex: 0,
  locked: false,
  narrationText: "Markets rallied today.",
  visualPrompt: "A trading floor at dawn",
  imageUrl: "https://cdn/i.jpg",
  durationSeconds: 6.2,
  aiClipStatus: "QUEUED",
  aiClipPrompt: "Camera glides over a trading floor",
  aiClipUpdatedAt: new Date("2026-10-01T09:00:00.000Z"),
  project: { id: "p1", format: "SHORT", status: "ASSETS_READY", channel: { defaultVisualPrompt: "warm film look" } },
};

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
  db.scene.update.mockImplementation(async ({ data }) => ({ ...SCENE, ...data }));
  db.scene.findMany.mockResolvedValue([]);
  db.videoProject.updateMany.mockResolvedValue({ count: 1 });
});

describe("queueSceneClip", () => {
  it("defaults to the image prompt plus the channel style", async () => {
    db.scene.findUnique.mockResolvedValue(SCENE);
    const scene = await queueSceneClip("s1");
    expect(scene.aiClipStatus).toBe("QUEUED");
    expect(scene.aiClipPrompt).toBe(clipPromptFor(SCENE, "warm film look"));
    expect(scene.aiClipPrompt).toContain("warm film look");
  });

  it("refuses locked scenes and projects being rendered", async () => {
    db.scene.findUnique.mockResolvedValue({ ...SCENE, locked: true });
    await expect(queueSceneClip("s1")).rejects.toThrow(/locked/);
    db.scene.findUnique.mockResolvedValue({ ...SCENE, project: { ...SCENE.project, status: "RENDERING" } });
    await expect(queueSceneClip("s1")).rejects.toThrow(/RENDERING/);
  });
});

describe("claimNextClip", () => {
  it("returns null when nothing waits", async () => {
    db.scene.findFirst.mockResolvedValue(null);
    expect(await claimNextClip(NOW)).toBeNull();
  });

  it("claims the scene and hands back a portrait 480p job with an upload URL", async () => {
    db.scene.findFirst.mockResolvedValue(SCENE);
    db.scene.updateMany.mockResolvedValue({ count: 1 });
    const job = await claimNextClip(NOW);
    expect(job).toMatchObject({ sceneId: "s1", claimedAt: NOW.toISOString(), width: 480, height: 832, prompt: SCENE.aiClipPrompt });
    expect(job?.upload.url).toMatch(/^https:\/\/upload\/projects\/p1\/scenes\/s1\/wan2gp-[0-9a-f]{12}\.mp4$/);
    expect(db.scene.updateMany.mock.calls[0][0].data).toEqual({ aiClipStatus: "RUNNING", aiClipUpdatedAt: NOW });
    // Abandoned claims become claimable again after the TTL.
    const where = db.scene.findFirst.mock.calls[0][0].where;
    expect(where.AND[1].OR[1].aiClipUpdatedAt.lt.getTime()).toBe(NOW.getTime() - CLAIM_TTL_MS);
    // Muapi clips never go to the GPU worker.
    expect(where.AND[0]).toEqual({ OR: [{ aiClipEngine: null }, { aiClipEngine: { not: "MUAPI" } }] });
  });

  it("retries when another worker wins the race", async () => {
    db.scene.findFirst.mockResolvedValueOnce(SCENE).mockResolvedValueOnce(null);
    db.scene.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimNextClip(NOW)).toBeNull();
    expect(db.scene.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("completeClip", () => {
  const running = { ...SCENE, aiClipStatus: "RUNNING", aiClipUpdatedAt: NOW };

  it("sets the uploaded clip as the scene's video", async () => {
    db.scene.findUnique.mockResolvedValue(running);
    db.scene.updateMany.mockResolvedValue({ count: 1 });
    expect(await completeClip({ ok: true, sceneId: "s1", claimedAt: NOW.toISOString() })).toEqual({ applied: true });
    const { data } = db.scene.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ aiClipStatus: null, visualSource: "WAN2GP" });
    expect(data.videoClipUrl).toMatch(/^https:\/\/cdn\/projects\/p1\/scenes\/s1\/wan2gp-[0-9a-f]{12}\.mp4$/);
  });

  it("records failures", async () => {
    db.scene.findUnique.mockResolvedValue(running);
    db.scene.updateMany.mockResolvedValue({ count: 1 });
    await completeClip({ ok: false, sceneId: "s1", claimedAt: NOW.toISOString(), error: "CUDA out of memory" });
    expect(db.scene.updateMany.mock.calls[0][0].data).toMatchObject({ aiClipStatus: "FAILED", aiClipError: "CUDA out of memory" });
  });

  it("ignores a stale worker whose claim was cancelled or re-claimed", async () => {
    db.scene.findUnique.mockResolvedValue({ ...running, aiClipUpdatedAt: new Date(NOW.getTime() + 1000) });
    expect(await completeClip({ ok: true, sceneId: "s1", claimedAt: NOW.toISOString() })).toEqual({ applied: false });
    db.scene.findUnique.mockResolvedValue({ ...running, aiClipStatus: null });
    expect(await completeClip({ ok: true, sceneId: "s1", claimedAt: NOW.toISOString() })).toEqual({ applied: false });
    expect(db.scene.updateMany).not.toHaveBeenCalled();
  });
});
