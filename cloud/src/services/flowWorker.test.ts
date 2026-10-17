import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ workerHeartbeat: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() }, scene: { updateMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { FLOW_ONLINE_MS, dedicatedFlowChannels, dropQueuedFlowClips, flowWorkerStatus } from "./flowWorker";

const NOW = new Date("2026-10-11T08:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
});

it("is ready only when it checked in recently with credits for a clip", async () => {
  db.workerHeartbeat.findMany.mockResolvedValue([]);
  expect(await flowWorkerStatus(NOW)).toMatchObject({ online: false, ready: false });

  db.workerHeartbeat.findMany.mockResolvedValue([{ engine: "FLOW", seenAt: ago(60_000), creditsLeft: 25 }]);
  expect(await flowWorkerStatus(NOW)).toMatchObject({ online: true, ready: true });

  db.workerHeartbeat.findMany.mockResolvedValue([{ engine: "FLOW", seenAt: ago(60_000), creditsLeft: 13 }]);
  expect(await flowWorkerStatus(NOW)).toMatchObject({ online: true, ready: false });

  db.workerHeartbeat.findMany.mockResolvedValue([{ engine: "FLOW", seenAt: ago(FLOW_ONLINE_MS + 1000), creditsLeft: 25 }]);
  expect(await flowWorkerStatus(NOW)).toMatchObject({ online: false, ready: false });
});

it("counts a channel's own worker, and lists the channels that have one", async () => {
  db.workerHeartbeat.findMany.mockResolvedValue([
    { engine: "FLOW", seenAt: ago(FLOW_ONLINE_MS + 1000), creditsLeft: 25 },
    { engine: "FLOW:Juu-Muu", seenAt: ago(60_000), creditsLeft: 300 },
  ]);
  expect(await flowWorkerStatus(NOW)).toMatchObject({ online: true, ready: true, creditsLeft: 300 });
  db.workerHeartbeat.findMany.mockResolvedValue([{ engine: "FLOW:Juu-Muu", seenAt: ago(60_000), creditsLeft: 300 }]);
  expect(await dedicatedFlowChannels()).toEqual(["Juu-Muu"]);
});

it("withdraws only queued Flow clips of the video being rendered", async () => {
  db.scene.updateMany.mockResolvedValue({ count: 1 });
  await expect(dropQueuedFlowClips("p1", "rendered", NOW)).resolves.toBe(1);
  expect(db.scene.updateMany.mock.calls[0][0].where).toEqual({ projectId: "p1", aiClipEngine: "FLOW", aiClipStatus: "QUEUED" });
});
