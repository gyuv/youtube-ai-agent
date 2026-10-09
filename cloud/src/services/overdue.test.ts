import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoProject: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  autopilotEvent: { create: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { clearAutopilotEvents, moveProjectToSlot, rescheduleOverdue, rescheduleProject, resumeStatus } from "./overdue";

const NOW = new Date("2026-09-29T12:00:00Z");
const CHANNEL = { id: "c1", name: "Money Minute", postingCron: "0 18 * * *", postingTimezone: "UTC", isActive: true }; // daily 18:00 UTC
const ready = { voiceAudioUrl: "a", imageUrl: "i", videoClipUrl: null, durationSeconds: 3 };
const missing = { voiceAudioUrl: null, imageUrl: null, videoClipUrl: null, durationSeconds: 0 };
const overdue = (overrides: object = {}) => ({
  id: "p1",
  channelId: "c1",
  title: "Tax tips",
  topic: "t",
  status: "RENDERED",
  scheduledFor: new Date("2026-09-27T18:00:00Z"),
  renderedVideoUrl: "https://x/v.mp4",
  scenes: [ready],
  channel: CHANNEL,
  ...overrides,
});

/** findMany is called for the overdue list, then for the slots already taken. */
function query({ projects = [] as object[], taken = [] as object[] }) {
  db.videoProject.findMany.mockImplementation(async (args: { where: { scheduledFor: { lt?: Date } } }) => (args.where.scheduledFor.lt ? projects : taken));
}

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
  db.videoProject.update.mockResolvedValue({});
});

describe("resumeStatus", () => {
  it("keeps a healthy stage and picks the furthest stage the files support for a failed video", () => {
    expect(resumeStatus({ status: "SCRIPTED", renderedVideoUrl: null, scenes: [missing] })).toBe("SCRIPTED");
    expect(resumeStatus({ status: "FAILED", renderedVideoUrl: "u", scenes: [ready] })).toBe("RENDERED");
    expect(resumeStatus({ status: "FAILED", renderedVideoUrl: null, scenes: [ready, ready] })).toBe("ASSETS_READY");
    expect(resumeStatus({ status: "FAILED", renderedVideoUrl: null, scenes: [ready, missing] })).toBe("SCRIPTED");
    expect(resumeStatus({ status: "FAILED", renderedVideoUrl: null, scenes: [] })).toBe("DRAFT");
  });
});

describe("rescheduleOverdue", () => {
  it("moves a missed video to the next free slot and keeps its render", async () => {
    query({ projects: [overdue()] });
    await expect(rescheduleOverdue(NOW, 3)).resolves.toBe(1);
    expect(db.videoProject.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: expect.objectContaining({ scheduledFor: new Date("2026-09-29T18:00:00Z"), status: "RENDERED", publishStartedAt: null }),
    });
    expect(db.videoProject.update.mock.calls[0][0].data).not.toHaveProperty("autopilotFailures");
    expect(db.autopilotEvent.create.mock.calls[0][0].data).toMatchObject({ action: "rescheduled", projectId: "p1" });
  });

  it("only looks at autopilot videos that haven't given up", async () => {
    query({});
    await rescheduleOverdue(NOW, 3);
    expect(db.videoProject.findMany.mock.calls[0][0].where).toMatchObject({ autopilot: true, autopilotFailures: { lt: 3 }, youtubeVideoId: null });
  });

  it("gives several missed videos distinct slots, oldest first, around slots already taken", async () => {
    query({
      projects: [overdue({ id: "old" }), overdue({ id: "newer", scheduledFor: new Date("2026-09-28T18:00:00Z") })],
      taken: [{ channelId: "c1", scheduledFor: new Date("2026-09-29T18:00:00Z") }],
    });
    await rescheduleOverdue(NOW, 3);
    const slots = db.videoProject.update.mock.calls.map((c) => [c[0].where.id, c[0].data.scheduledFor.toISOString()]);
    expect(slots).toEqual([
      ["old", "2026-09-30T18:00:00.000Z"],
      ["newer", "2026-10-01T18:00:00.000Z"],
    ]);
  });

  it("does nothing when no video is overdue", async () => {
    query({});
    await expect(rescheduleOverdue(NOW, 3)).resolves.toBe(0);
    expect(db.videoProject.update).not.toHaveBeenCalled();
  });
});

describe("rescheduleProject", () => {
  it("revives a video the autopilot gave up on, with fresh attempts", async () => {
    db.videoProject.findUnique.mockResolvedValue(overdue({ status: "FAILED", renderedVideoUrl: null, youtubeVideoId: null }));
    query({});
    await rescheduleProject("p1", NOW);
    expect(db.videoProject.update.mock.calls[0][0].data).toMatchObject({ status: "ASSETS_READY", autopilotFailures: 0, lastError: null });
  });

  it("refuses a video that is already on YouTube or still rendering", async () => {
    db.videoProject.findUnique.mockResolvedValue(overdue({ youtubeVideoId: "abc" }));
    await expect(rescheduleProject("p1", NOW)).rejects.toThrow(/already on YouTube/);
    db.videoProject.findUnique.mockResolvedValue(overdue({ status: "RENDERING", youtubeVideoId: null }));
    await expect(rescheduleProject("p1", NOW)).rejects.toThrow(/rendering/);
  });
});

it("clears the whole activity log", async () => {
  db.autopilotEvent.deleteMany.mockResolvedValue({ count: 7 });
  await expect(clearAutopilotEvents()).resolves.toBe(7);
  expect(db.autopilotEvent.deleteMany).toHaveBeenCalledWith({});
});

describe("moveProjectToSlot", () => {
  const at = new Date("2026-10-01T18:00:00Z");
  beforeEach(() => {
    (db.videoProject as Record<string, ReturnType<typeof vi.fn>>).findFirst = vi.fn().mockResolvedValue(null);
  });

  it("moves an unpublished video to a free future slot", async () => {
    db.videoProject.findUnique.mockResolvedValue({ id: "p1", channelId: "c1", title: "Tax tips", topic: "t", status: "SCRIPTED", youtubeVideoId: null, channel: { postingTimezone: "UTC" } });
    await moveProjectToSlot("p1", at, NOW);
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { scheduledFor: at, publishStartedAt: null } });
  });

  it("refuses a past slot, a taken slot, and a video already on YouTube", async () => {
    await expect(moveProjectToSlot("p1", new Date("2026-09-01T00:00:00Z"), NOW)).rejects.toThrow(/passed/);
    db.videoProject.findUnique.mockResolvedValue({ id: "p1", channelId: "c1", title: null, topic: "t", status: "PUBLISHED", youtubeVideoId: "abc", channel: { postingTimezone: "UTC" } });
    await expect(moveProjectToSlot("p1", at, NOW)).rejects.toThrow(/YouTube/);
    db.videoProject.findUnique.mockResolvedValue({ id: "p1", channelId: "c1", title: null, topic: "t", status: "RENDERED", youtubeVideoId: null, channel: { postingTimezone: "UTC" } });
    (db.videoProject as unknown as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue({ id: "other" });
    await expect(moveProjectToSlot("p1", at, NOW)).rejects.toThrow(/already has a video/);
  });
});
