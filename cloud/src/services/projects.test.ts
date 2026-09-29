import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  videoProject: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { ChannelInputSchema } from "./channels";
import { MetadataSchema, createProject, parseTags, updateProjectMetadata } from "./projects";

const CHANNEL = {
  id: "c1",
  name: "Money Minute",
  defaultFormat: "SHORT",
  defaultPrivacy: "UNLISTED",
  postingCron: "0 18 * * *",
  postingTimezone: "UTC",
  isActive: true,
};

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
  db.videoProject.create.mockImplementation(async ({ data }) => ({ id: "p1", ...data }));
  db.videoProject.findMany.mockResolvedValue([]);
});

describe("createProject", () => {
  it("inherits the channel's format and privacy", async () => {
    db.channel.findUnique.mockResolvedValue(CHANNEL);
    const project = await createProject({ channelId: "c1", topic: "UPI and small shops" });
    expect(project).toMatchObject({ format: "SHORT", privacy: "UNLISTED", scheduledFor: null });
  });

  it("takes the next slot no other project holds", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T10:00:00Z") });
    db.channel.findUnique.mockResolvedValue(CHANNEL);
    db.videoProject.findMany.mockResolvedValue([{ scheduledFor: new Date("2026-09-29T18:00:00Z") }]);
    const project = await createProject({ channelId: "c1", topic: "UPI and small shops", schedule: "next" });
    expect(project.scheduledFor?.toISOString()).toBe("2026-09-30T18:00:00.000Z");
    vi.useRealTimers();
  });

  it("explains when the channel has no schedule, and requires a time for custom", async () => {
    db.channel.findUnique.mockResolvedValue({ ...CHANNEL, postingCron: null });
    await expect(createProject({ channelId: "c1", topic: "Topic here", schedule: "next" })).rejects.toThrow(/no posting schedule/);
    await expect(createProject({ channelId: "c1", topic: "Topic here", schedule: "custom", scheduledFor: "" })).rejects.toThrow(/Pick a date/);
  });
});

describe("metadata", () => {
  it("parses, deduplicates and budgets tags", () => {
    expect(parseTags("#money, Money , saving tips\nsaving tips, <b>")).toEqual(["money", "saving tips", "b"]);
    expect(parseTags(Array.from({ length: 60 }, (_, i) => `tag-${i}-${"x".repeat(10)}`).join(",")).join(",").length).toBeLessThanOrEqual(500);
  });

  it("enforces YouTube limits and accepts an empty schedule", () => {
    expect(MetadataSchema.safeParse({ title: "x".repeat(101), description: "", tags: "", privacy: "PUBLIC", scheduledFor: "" }).success).toBe(false);
    const ok = MetadataSchema.parse({ title: "T", description: "", tags: "a, b", privacy: "PUBLIC", scheduledFor: "" });
    expect(ok).toMatchObject({ tags: ["a", "b"], scheduledFor: null });
  });

  it("refuses edits once the video is on YouTube", async () => {
    db.videoProject.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    await expect(updateProjectMetadata("p1", { title: "T", description: "", tags: "", privacy: "PUBLIC", scheduledFor: "" })).rejects.toThrow(/YouTube Studio/);
  });
});

describe("ChannelInputSchema", () => {
  const form = {
    name: "Money Minute",
    niche: "Personal finance",
    targetAudience: "",
    language: "en-IN",
    defaultVoice: "en-IN-NeerjaNeural",
    defaultFormat: "SHORT",
    defaultPrivacy: "PRIVATE",
    defaultScriptPrompt: "",
    defaultVisualPrompt: "",
    postingCron: "0 18 * * 1,3,5",
    postingTimezone: "Asia/Kolkata",
    autoPublish: "on",
  };

  it("maps form fields: empty text to null, checkboxes to booleans", () => {
    const parsed = ChannelInputSchema.parse(form);
    expect(parsed).toMatchObject({ targetAudience: null, defaultScriptPrompt: null, autoPublish: true, isActive: false });
  });

  it("rejects unsafe voices, bad cron and unknown time zones", () => {
    const result = ChannelInputSchema.safeParse({ ...form, defaultVoice: 'x"><evil', postingCron: "daily", postingTimezone: "Mars/Base" });
    expect(result.success).toBe(false);
    const fields = result.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["defaultVoice", "postingCron", "postingTimezone"]));
  });
});
