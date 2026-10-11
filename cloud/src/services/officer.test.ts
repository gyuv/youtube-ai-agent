import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoProject: { findMany: vi.fn(), update: vi.fn() },
  mastermindRequest: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  workerHeartbeat: { findUnique: vi.fn(), upsert: vi.fn() },
  channel: { findMany: vi.fn() },
  scene: { count: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { FLOW_IDLE_MS, MAX_REVIVES, runOfficer } from "./officer";

const NOW = new Date("2026-10-11T20:00:00Z");
const full = { voiceAudioUrl: "a", imageUrl: "i", videoClipUrl: null, durationSeconds: 5 };
const stuck = (overrides = {}) => ({ id: "p1", channelId: "c1", title: "Crow", topic: "crow", lastError: "Voice failed", scenes: [full, full], ...overrides });

beforeEach(() => {
  Object.values(db).forEach((m) => Object.values(m).forEach((f) => f.mockReset()));
  db.videoProject.findMany.mockResolvedValue([]);
  db.channel.findMany.mockResolvedValue([]);
  db.mastermindRequest.count.mockResolvedValue(0);
});

describe("runOfficer", () => {
  it("revives a video the autopilot gave up on and logs the resolved query", async () => {
    db.videoProject.findMany.mockResolvedValueOnce([stuck()]);
    const r = await runOfficer(3, NOW);
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: expect.objectContaining({ autopilotFailures: 0, status: "ASSETS_READY" }) });
    expect(db.mastermindRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "incident", status: "done" }) });
    expect(r.resolved).toEqual(['revived "Crow"']);
  });

  it("drops the topic and frees the slot after the revivals run out", async () => {
    db.videoProject.findMany.mockResolvedValueOnce([stuck({ scenes: [] })]);
    db.mastermindRequest.count.mockResolvedValue(MAX_REVIVES);
    await runOfficer(3, NOW);
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { autopilot: false, scheduledFor: null } });
  });

  it("opens one query when a Flow-only channel waits on an absent worker, and closes it when the worker is back", async () => {
    db.channel.findMany.mockResolvedValue([{ id: "c1", name: "Kidz Ulagam" }]);
    db.scene.count.mockResolvedValue(3);
    db.workerHeartbeat.findUnique.mockResolvedValue({ seenAt: new Date(NOW.getTime() - FLOW_IDLE_MS - 1) });
    db.mastermindRequest.findFirst.mockResolvedValue(null);
    expect((await runOfficer(3, NOW)).open).toEqual(["Kidz Ulagam: Flow worker needed"]);

    db.workerHeartbeat.findUnique.mockResolvedValue({ seenAt: NOW });
    db.mastermindRequest.findFirst.mockResolvedValue({ id: "r1" });
    await runOfficer(3, NOW);
    expect(db.mastermindRequest.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "done", resolvedAt: NOW } });
  });
});

it("keeps a Flow-only video rendered from stock clips off YouTube and sends it back for Flow clips", async () => {
  const stock = { videoClipUrl: "https://pexels/clip.mp4", aiClipEngine: null, aiClipStatus: null, locked: false };
  const flow = { videoClipUrl: "https://cdn/flow.mp4", aiClipEngine: "FLOW", aiClipStatus: null, locked: false };
  db.videoProject.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
    { id: "p2", channelId: "c1", title: "Crow", topic: "crow", scenes: [flow, stock] },
    { id: "p3", channelId: "c1", title: "Song", topic: "song", scenes: [flow, flow] },
  ]);
  const r = await runOfficer(3, NOW);
  expect(db.videoProject.update).toHaveBeenCalledTimes(1);
  expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p2" }, data: { status: "ASSETS_READY", autopilotFailures: 0 } });
  expect(r.resolved).toEqual(['held back "Crow" until every scene is a Flow clip']);
});
