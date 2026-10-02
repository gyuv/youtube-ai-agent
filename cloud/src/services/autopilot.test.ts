import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  channel: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  videoProject: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  autopilotEvent: { create: vi.fn(), deleteMany: vi.fn() },
}));
const pipeline = vi.hoisted(() => ({ dispatchCloudRender: vi.fn(), fillSceneAssets: vi.fn(), generateProjectScript: vi.fn() }));
const planner = vi.hoisted(() => ({ proposeTopic: vi.fn() }));
const youtube = vi.hoisted(() => ({ checkYouTubeVisibility: vi.fn() }));
const analytics = vi.hoisted(() => ({ findChannelToAnalyze: vi.fn(), analyzeChannel: vi.fn() }));
const labs = vi.hoisted(() => ({ findChannelForGrowthReview: vi.fn(), runGrowthReview: vi.fn(), packageProject: vi.fn() }));
const publish = vi.hoisted(() => ({ findVideoToAutoPublish: vi.fn(), publishRenderedProject: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./pipeline", async (importActual) => ({ ...(await importActual<typeof import("./pipeline")>()), ...pipeline }));
vi.mock("./topicPlanner", () => planner);
vi.mock("./youtube", () => youtube);
vi.mock("./publish", () => publish);
vi.mock("./analytics", () => analytics);
vi.mock("./labsAutomation", () => labs);

import { MAX_AUTOPILOT_FAILURES, PINTEREST_WAIT_MS, autopilotTick, createVideoNow, createVideosAhead } from "./autopilot";

const NOW = new Date("2026-09-29T00:00:00Z"); // Tuesday
const CHANNEL = {
  id: "c1",
  name: "Money Minute",
  niche: "Personal finance",
  targetAudience: null,
  language: "en",
  defaultFormat: "SHORT",
  defaultPrivacy: "UNLISTED",
  defaultScriptPrompt: null,
  postingCron: "0 18 * * *", // daily 18:00 UTC
  postingTimezone: "UTC",
  isActive: true,
  autopilot: true,
  autopilotReview: false,
  autopilotLeadHours: 36,
  autopilotVisualSource: "PEXELS",
  topicBacklog: null as string | null,
};
const ready = (i: number) => ({ id: `s${i}`, sceneIndex: i, locked: false, voiceAudioUrl: "a", imageUrl: "i", videoClipUrl: null, durationSeconds: 3 });
const project = (overrides: object = {}) => ({
  id: "p1",
  channelId: "c1",
  status: "SCRIPTED",
  topic: "Salary day habits",
  title: null,
  autopilotFailures: 0,
  scheduledFor: new Date("2026-09-29T18:00:00Z"),
  scenes: [ready(0), ready(1)],
  ...overrides,
});

/** Route prisma.videoProject.findMany calls by the shape of their query. */
function projectsQuery({
  stale = [],
  work = [],
  scheduled = [],
  recent = [],
  gaveUp = [],
  verify = [],
}: { stale?: object[]; work?: object[]; scheduled?: object[]; recent?: object[]; gaveUp?: object[]; verify?: object[] }) {
  db.videoProject.findMany.mockImplementation(async (args: { where?: Record<string, unknown>; take?: number }) => {
    if (args.where?.autopilotFailures && (args.where.autopilotFailures as { gte?: number }).gte) return gaveUp;
    if (args.where?.updatedAt) return stale;
    if (args.where?.youtubeLocked === false) return verify;
    if (args.where?.autopilot) return work;
    if (args.where?.scheduledFor) return scheduled;
    if (args.take === 40) return recent;
    throw new Error(`unexpected query ${JSON.stringify(args)}`);
  });
}

beforeEach(() => {
  for (const group of [...Object.values(db), pipeline, planner, youtube, publish, analytics, labs]) for (const fn of Object.values(group)) fn.mockReset();
  db.channel.findMany.mockResolvedValue([CHANNEL]);
  db.videoProject.create.mockImplementation(async ({ data }) => ({ id: "new1", ...data }));
  projectsQuery({});
  publish.findVideoToAutoPublish.mockResolvedValue(null);
  analytics.findChannelToAnalyze.mockResolvedValue(null);
  labs.findChannelForGrowthReview.mockResolvedValue(null);
});

describe("auto-publish catch-up", () => {
  it("publishes a rendered video waiting on an auto-publish channel before anything else", async () => {
    publish.findVideoToAutoPublish.mockResolvedValue({ id: "p9", channelId: "c1", title: "Tax tips", topic: "t" });
    publish.publishRenderedProject.mockResolvedValue({ youtubeVideoId: "abc123def45", locked: false });
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "published", projectId: "p9", more: true });
    expect(pipeline.dispatchCloudRender).not.toHaveBeenCalled();
  });

  it("logs a failed publish and moves on", async () => {
    publish.findVideoToAutoPublish.mockResolvedValue({ id: "p9", channelId: "c1", title: null, topic: "Tax tips" });
    publish.publishRenderedProject.mockRejectedValue(new Error("quota exceeded"));
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "error", more: true });
    expect(result.message).toContain("quota exceeded");
  });
});

describe("autopilotTick", () => {
  it("does nothing when no channel has autopilot on", async () => {
    db.channel.findMany.mockResolvedValue([]);
    await expect(autopilotTick(NOW)).resolves.toMatchObject({ action: "idle", more: false });
  });

  it("fails renders that stopped reporting, for every project", async () => {
    projectsQuery({ stale: [{ id: "old", channelId: "c1", status: "RENDERING" }] });
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    const result = await autopilotTick(NOW);
    expect(result.swept).toBe(1);
    expect(db.videoProject.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "old", status: "RENDERING" }, data: { status: "FAILED" } });
    expect(db.autopilotEvent.deleteMany).toHaveBeenCalled(); // old activity is pruned
  });

  it("dispatches finished videos before starting anything else", async () => {
    projectsQuery({ work: [project({ id: "draft", status: "DRAFT" }), project({ status: "ASSETS_READY" })] });
    pipeline.dispatchCloudRender.mockResolvedValue({});
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "dispatched", projectId: "p1", more: true });
    expect(pipeline.generateProjectScript).not.toHaveBeenCalled();
  });

  it("waits for an operator on review channels", async () => {
    db.channel.findMany.mockResolvedValue([{ ...CHANNEL, autopilotReview: true }]);
    projectsQuery({ work: [project({ status: "ASSETS_READY" })], scheduled: [{ channelId: "c1", scheduledFor: new Date("2026-09-29T18:00:00Z") }, { channelId: "c1", scheduledFor: new Date("2026-09-30T18:00:00Z") }] });
    const result = await autopilotTick(NOW);
    expect(pipeline.dispatchCloudRender).not.toHaveBeenCalled();
    expect(result.action).toBe("idle");
  });

  it("retries a failed render and counts the attempt", async () => {
    projectsQuery({ work: [project({ status: "FAILED", autopilotFailures: 1 })] });
    pipeline.dispatchCloudRender.mockResolvedValue({});
    const result = await autopilotTick(NOW);
    expect(result.message).toMatch(/retry 2 of 3/);
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { autopilotFailures: { increment: 1 } } });
  });

  it("fills the first missing, unlocked scene with the channel's visual source", async () => {
    const scenes = [ready(0), { ...ready(1), locked: true, voiceAudioUrl: null }, { ...ready(2), imageUrl: null }];
    projectsQuery({ work: [project({ scenes })] });
    pipeline.fillSceneAssets.mockResolvedValue({ sceneIndex: 2, skipped: null, generated: ["visual"], errors: [] });
    const result = await autopilotTick(NOW);
    expect(pipeline.fillSceneAssets).toHaveBeenCalledWith("s2", { visualSource: "PEXELS" });
    expect(result).toMatchObject({ action: "filled", more: true });
  });

  it("holds a render while a recent Pinterest search is pending, then renders anyway", async () => {
    const pending = { ...ready(0), aiClipEngine: "PINTEREST", aiClipStatus: "QUEUED", aiClipUpdatedAt: new Date(NOW.getTime() - 60_000) };
    projectsQuery({ work: [project({ status: "ASSETS_READY", scenes: [pending] })] });
    await autopilotTick(NOW);
    expect(pipeline.dispatchCloudRender).not.toHaveBeenCalled();

    const old = { ...pending, aiClipUpdatedAt: new Date(NOW.getTime() - PINTEREST_WAIT_MS - 1) };
    projectsQuery({ work: [project({ status: "ASSETS_READY", scenes: [old] })] });
    pipeline.dispatchCloudRender.mockResolvedValue({});
    await autopilotTick(NOW);
    expect(pipeline.dispatchCloudRender).toHaveBeenCalled();
  });

  it("counts failures and parks the project as FAILED on the last attempt", async () => {
    projectsQuery({ work: [project({ scenes: [{ ...ready(0), voiceAudioUrl: null }], autopilotFailures: MAX_AUTOPILOT_FAILURES - 1 })] });
    pipeline.fillSceneAssets.mockResolvedValue({ sceneIndex: 0, skipped: null, generated: [], errors: ["Voice: edge-tts failed"] });
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "error", more: true });
    expect(result.message).toMatch(/Autopilot gave up/);
    expect(db.videoProject.update.mock.calls[0][0].data).toMatchObject({ autopilotFailures: 3, status: "FAILED" });
  });

  it("writes the script for a planned video", async () => {
    projectsQuery({ work: [project({ status: "DRAFT", scenes: [] })] });
    pipeline.generateProjectScript.mockResolvedValue({ title: "Why salaries vanish", scenes: [1, 2, 3, 4, 5, 6] });
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "scripted", message: expect.stringMatching(/6 scenes/) });
  });

  it("plans the next open slot from the topic backlog first", async () => {
    db.channel.findMany.mockResolvedValue([{ ...CHANNEL, topicBacklog: "\n  UPI and small shops \nGold in 2026" }]);
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "planned", more: true });
    expect(db.channel.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { topicBacklog: "Gold in 2026" } });
    expect(db.videoProject.create.mock.calls[0][0].data).toMatchObject({
      topic: "UPI and small shops",
      autopilot: true,
      scheduledFor: new Date("2026-09-29T18:00:00Z"),
      privacy: "UNLISTED",
    });
    expect(planner.proposeTopic).not.toHaveBeenCalled();
  });

  it("asks Gemini for a fresh topic, passing recent ones to avoid repeats", async () => {
    db.channel.findMany.mockResolvedValue([{ ...CHANNEL, autopilotLeadHours: 48 }]); // Wednesday's slot is 42h away
    projectsQuery({ scheduled: [{ channelId: "c1", scheduledFor: new Date("2026-09-29T18:00:00Z") }], recent: [{ topic: "Salary day", title: "Why salaries vanish" }] });
    planner.proposeTopic.mockResolvedValue({ topic: "Credit card grace periods", model: "m" });
    const result = await autopilotTick(NOW);
    expect(planner.proposeTopic.mock.calls[0][0].recentTopics).toEqual(["Why salaries vanish", "Salary day"]);
    expect(db.videoProject.create.mock.calls[0][0].data.scheduledFor).toEqual(new Date("2026-09-30T18:00:00Z"));
    expect(result.message).toMatch(/from Gemini/);
  });

  it("stops the run when planning fails, instead of hammering Gemini", async () => {
    planner.proposeTopic.mockRejectedValue(new Error("Gemini rejected the request (401)"));
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "error", more: false });
    expect(db.autopilotEvent.create.mock.calls.at(-1)![0].data).toMatchObject({ level: "error" });
  });

  it("moves on to the next channel when one can't be planned", async () => {
    const broken = { ...CHANNEL, id: "c0", name: "Broken", postingCron: "0 12 * * *" }; // earlier slot, no backlog
    db.channel.findMany.mockResolvedValue([broken, { ...CHANNEL, topicBacklog: "Gold in 2026" }]);
    planner.proposeTopic.mockRejectedValue(new Error("GEMINI_API_KEY is not set"));
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "planned", channelId: "c1", more: true });
    expect(db.autopilotEvent.create.mock.calls[0][0].data).toMatchObject({ level: "error", channelId: "c0" });
  });

  it("pauses planning on a channel whose last autopilot video gave up", async () => {
    projectsQuery({ gaveUp: [{ channelId: "c1" }] });
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "idle", more: false, message: expect.stringMatching(/Planning paused/) });
    expect(db.videoProject.create).not.toHaveBeenCalled();
    expect(planner.proposeTopic).not.toHaveBeenCalled();
  });

  it("checks a scheduled video went live once its slot has passed", async () => {
    const slot = new Date("2026-09-28T18:00:00Z");
    projectsQuery({
      verify: [
        { id: "seen", channelId: "c1", title: "Checked after its slot", topic: "t", scheduledFor: slot, youtubeCheckedAt: new Date("2026-09-28T19:00:00Z") },
        { id: "p9", channelId: "c1", title: "Gold in 2026", topic: "t", scheduledFor: slot, youtubeCheckedAt: new Date("2026-09-27T09:00:00Z") },
      ],
    });
    youtube.checkYouTubeVisibility.mockResolvedValue({ visibility: { privacyStatus: "private", publishAt: slot.toISOString() }, locked: true });
    const result = await autopilotTick(NOW);
    expect(youtube.checkYouTubeVisibility).toHaveBeenCalledWith("p9", NOW);
    expect(result).toMatchObject({ action: "verified", projectId: "p9", more: true, message: expect.stringMatching(/still private/) });
    expect(db.autopilotEvent.create.mock.calls.at(-1)![0].data).toMatchObject({ level: "error", action: "verified" });
    expect(db.videoProject.create).not.toHaveBeenCalled(); // planning waits for the next step
  });

  it("marks a video checked when YouTube can't be reached, so it isn't retried every step", async () => {
    projectsQuery({ verify: [{ id: "p9", channelId: "c1", title: null, topic: "Gold", scheduledFor: new Date("2026-09-28T18:00:00Z"), youtubeCheckedAt: null }] });
    youtube.checkYouTubeVisibility.mockRejectedValue(new Error("Google revoked or expired this channel's authorisation"));
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "error", more: true });
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p9" }, data: { youtubeCheckedAt: NOW } });
  });

  it("stays idle until a slot enters the lead window", async () => {
    db.channel.findMany.mockResolvedValue([{ ...CHANNEL, autopilotLeadHours: 6 }]); // next slot is 18h away
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "idle", more: false });
    expect(db.videoProject.create).not.toHaveBeenCalled();
  });
});

describe("createVideoNow", () => {
  it("plans a video on the next free slot without waiting for the lead window", async () => {
    db.channel.findUnique.mockResolvedValue({ ...CHANNEL, topicBacklog: "UPI tips\nGold vs FD" });
    db.videoProject.findMany.mockResolvedValue([{ scheduledFor: new Date("2026-09-29T18:00:00Z") }]);
    const created = await createVideoNow("c1", NOW);
    expect(created).toMatchObject({ topic: "UPI tips", autopilot: true });
    const { data } = db.videoProject.create.mock.calls[0][0];
    expect(data).toMatchObject({ channelId: "c1", topic: "UPI tips", autopilot: true });
    expect(data.scheduledFor.toISOString()).toBe("2026-09-30T18:00:00.000Z");
  });

  it("refuses paused channels", async () => {
    db.channel.findUnique.mockResolvedValue({ ...CHANNEL, isActive: false });
    await expect(createVideoNow("c1", NOW)).rejects.toThrow(/paused/);
  });
});

describe("daily performance analysis", () => {
  it("refreshes stats and relearns once a day, then keeps going", async () => {
    analytics.findChannelToAnalyze.mockResolvedValue({ ...CHANNEL });
    analytics.analyzeChannel.mockResolvedValue({ updated: 4, notes: "- Specific rupee amounts in titles win" });
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "analyzed", more: true, channelId: "c1" });
    expect(result.message).toContain("lessons updated");
  });
});

describe("Creator Labs automation", () => {
  it("packages a finished video (title, SEO, chapters) before dispatching it", async () => {
    db.channel.findMany.mockResolvedValue([{ ...CHANNEL, autoLabs: true }]);
    projectsQuery({ work: [project({ status: "ASSETS_READY", labsAppliedAt: null })] });
    labs.packageProject.mockResolvedValue({ applied: ["title", "SEO"], failed: [] });
    const result = await autopilotTick(NOW);
    expect(result.action).toBe("packaged");
    expect(pipeline.dispatchCloudRender).not.toHaveBeenCalled();
  });

  it("dispatches once the video is packaged", async () => {
    db.channel.findMany.mockResolvedValue([{ ...CHANNEL, autoLabs: true }]);
    projectsQuery({ work: [project({ status: "ASSETS_READY", labsAppliedAt: NOW })] });
    pipeline.dispatchCloudRender.mockResolvedValue({});
    expect((await autopilotTick(NOW)).action).toBe("dispatched");
  });

  it("runs the weekly growth review and reports new backlog topics", async () => {
    labs.findChannelForGrowthReview.mockResolvedValue({ ...CHANNEL, autoLabs: true });
    labs.runGrowthReview.mockResolvedValue({ ran: ["yt-audit", "yt-plan"], failed: [], added: ["Topic A", "Topic B"] });
    const result = await autopilotTick(NOW);
    expect(result).toMatchObject({ action: "reviewed", more: true });
    expect(result.message).toContain("2 new topics");
  });
});

describe("making future videos on request", () => {
  it("makes the video for a specific open slot, however far ahead", async () => {
    db.channel.findUnique.mockResolvedValue({ ...CHANNEL, topicBacklog: "Tax saving tips" });
    db.videoProject.findMany.mockResolvedValue([]);
    const at = new Date("2026-10-05T18:00:00Z"); // 6 days ahead, far outside the 36 h lead window
    const created = await createVideoNow("c1", NOW, at);
    expect(created.slot).toEqual(at);
    expect(db.videoProject.create.mock.calls[0][0].data).toMatchObject({ scheduledFor: at, autopilot: true });
  });

  it("refuses a slot that already has a video, or has passed", async () => {
    db.channel.findUnique.mockResolvedValue(CHANNEL);
    const at = new Date("2026-10-05T18:00:00Z");
    db.videoProject.findMany.mockResolvedValue([{ scheduledFor: at }]);
    await expect(createVideoNow("c1", NOW, at)).rejects.toThrow(/already has a video/);
    await expect(createVideoNow("c1", NOW, new Date("2026-09-28T18:00:00Z"))).rejects.toThrow(/already passed/);
  });

  it("makes one video per upcoming free slot", async () => {
    db.channel.findUnique.mockResolvedValue({ ...CHANNEL, topicBacklog: "A topic one\nA topic two\nA topic three" });
    const taken: Date[] = [];
    db.videoProject.findMany.mockImplementation(async () => taken.map((scheduledFor) => ({ scheduledFor })));
    db.videoProject.create.mockImplementation(async ({ data }) => {
      taken.push(data.scheduledFor);
      return { id: `p${taken.length}`, ...data };
    });
    db.channel.update.mockImplementation(async ({ data }) => Object.assign(CHANNEL_STATE, data));
    const CHANNEL_STATE = { topicBacklog: "A topic one\nA topic two\nA topic three" };
    db.channel.findUnique.mockImplementation(async () => ({ ...CHANNEL, ...CHANNEL_STATE }));
    const created = await createVideosAhead("c1", 3, NOW);
    expect(created.map((c) => c.slot?.toISOString())).toEqual(["2026-09-29T18:00:00.000Z", "2026-09-30T18:00:00.000Z", "2026-10-01T18:00:00.000Z"]);
    expect(created.map((c) => c.topic)).toEqual(["A topic one", "A topic two", "A topic three"]);
  });
});
