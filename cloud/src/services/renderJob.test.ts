import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoProject: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}));
const storage = vi.hoisted(() => ({
  createSignedUpload: vi.fn(),
  maxObjectBytes: vi.fn(() => 50 * 1024 * 1024),
  publicObjectUrl: vi.fn((path: string) => `https://cdn.example/${path}`),
}));
const youtube = vi.hoisted(() => ({
  getChannelAccessToken: vi.fn(),
  buildYouTubeMetadata: vi.fn(() => ({ snippet: {}, status: {} })),
  wantedVisibility: vi.fn((privacy: string) => privacy.toLowerCase()),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/storage", () => storage);
vi.mock("./youtube", () => youtube);

import { handleRenderEvent, renderObjectPath } from "./renderJob";

const PROJECT_ID = "cabcdefghijklmnopqrstuvw";
const scene = (sceneIndex: number, overrides: object = {}) => ({
  sceneIndex,
  voiceAudioUrl: `https://cdn/voice-${sceneIndex}.mp3`,
  imageUrl: `https://cdn/img-${sceneIndex}.jpg`,
  videoClipUrl: null,
  durationSeconds: 3,
  wordTimings: [{ word: "Hi", startMs: 0, endMs: 300 }],
  ...overrides,
});
const project = (overrides: object = {}) => ({
  id: PROJECT_ID,
  status: "QUEUED_FOR_RENDER",
  format: "SHORT",
  renderRunId: null,
  youtubeVideoId: null,
  scenes: [scene(0), scene(1, { wordTimings: "garbage" })],
  channel: { id: "ch1", name: "Main", autoPublish: false, language: "en", oauthRefreshTokenEnc: "v1:x" },
  ...overrides,
});

beforeEach(() => {
  for (const fn of [...Object.values(db.videoProject), ...Object.values(youtube)]) fn.mockReset();
  storage.createSignedUpload.mockReset();
  youtube.buildYouTubeMetadata.mockReturnValue({ snippet: {}, status: {} });
  youtube.wantedVisibility.mockImplementation((privacy: string) => privacy.toLowerCase());
});

describe("started", () => {
  const started = { event: "started" as const, projectId: PROJECT_ID, runId: "77", runAttempt: 1 };

  it("claims the project and returns scenes with a signed upload target", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    storage.createSignedUpload.mockResolvedValue({ url: "https://signed", method: "PUT", headers: { a: "b" }, publicUrl: "x" });

    const { job } = (await handleRenderEvent(started)) as { job: import("./renderContract").RenderJob };

    const claim = db.videoProject.updateMany.mock.calls[0][0];
    expect(claim.data).toMatchObject({ status: "RENDERING", renderRunId: "77", lastError: null });
    expect(storage.createSignedUpload).toHaveBeenCalledWith(renderObjectPath(PROJECT_ID, "77"), "video/mp4");
    expect(job.upload).toEqual({ url: "https://signed", method: "PUT", headers: { a: "b" } });
    expect(job.maxBytes).toBe(50 * 1024 * 1024);
    expect(job.scenes[0].words).toEqual([{ word: "Hi", startMs: 0, endMs: 300 }]);
    expect(job.scenes[1].words).toEqual([]); // malformed timings don't break the render
  });

  it("fails a queued project whose scenes are incomplete", async () => {
    db.videoProject.findUnique.mockResolvedValue(project({ scenes: [scene(0), scene(1, { voiceAudioUrl: null })] }));
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    await expect(handleRenderEvent(started)).rejects.toThrow(/scenes 2 are missing/);
    expect(db.videoProject.updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: "QUEUED_FOR_RENDER" },
      data: { status: "FAILED" },
    });
  });

  it("lets a re-run of the same job continue but blocks a different run", async () => {
    db.videoProject.findUnique.mockResolvedValue(project({ status: "RENDERING", renderRunId: "77" }));
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    storage.createSignedUpload.mockResolvedValue({ url: "u", method: "PUT", headers: {}, publicUrl: "p" });
    await expect(handleRenderEvent(started)).resolves.toHaveProperty("job");

    db.videoProject.findUnique.mockResolvedValue(project({ status: "RENDERING", renderRunId: "99" }));
    await expect(handleRenderEvent(started)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses published projects", async () => {
    db.videoProject.findUnique.mockResolvedValue(project({ status: "PUBLISHED" }));
    await expect(handleRenderEvent(started)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("rendered", () => {
  const rendered = { event: "rendered" as const, projectId: PROJECT_ID, runId: "77", sizeBytes: 1000, durationSeconds: 30 };
  const url = `https://cdn.example/${renderObjectPath(PROJECT_ID, "77")}`;

  it("records the render and returns no publish step when auto-publish is off", async () => {
    db.videoProject.findUnique.mockResolvedValue(project({ status: "RENDERING", renderRunId: "77" }));
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    await expect(handleRenderEvent(rendered)).resolves.toEqual({ videoUrl: url, publish: null });
    expect(db.videoProject.updateMany.mock.calls[0][0].data).toMatchObject({ status: "RENDERED", renderedVideoUrl: url });
  });

  it("hands the runner a fresh access token and metadata when auto-publish is on", async () => {
    db.videoProject.findUnique.mockResolvedValue(
      project({ status: "RENDERING", renderRunId: "77", channel: { ...project().channel, autoPublish: true } }),
    );
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    youtube.getChannelAccessToken.mockResolvedValue("ya29.fresh");
    const result = await handleRenderEvent(rendered);
    expect(result).toEqual({ videoUrl: url, publish: { accessToken: "ya29.fresh", metadata: { snippet: {}, status: {} } } });
    // The runner's upload holds the lease so the studio's Publish button can't upload it as well.
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: PROJECT_ID }, data: { publishStartedAt: expect.any(Date) } });
  });

  it("keeps the render but explains when publishing can't start", async () => {
    db.videoProject.findUnique.mockResolvedValue(
      project({ status: "RENDERING", renderRunId: "77", channel: { ...project().channel, autoPublish: true } }),
    );
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    youtube.getChannelAccessToken.mockRejectedValue(new Error("Channel is not connected"));
    await expect(handleRenderEvent(rendered)).resolves.toEqual({ videoUrl: url, publish: null });
    expect(db.videoProject.update.mock.calls[0][0].data.lastError).toMatch(/Auto-publish skipped: Channel is not connected/);
  });

  it("is idempotent for the same run and rejects other runs", async () => {
    db.videoProject.findUnique.mockResolvedValue(project({ status: "RENDERED", renderRunId: "77" }));
    db.videoProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(handleRenderEvent(rendered)).resolves.toEqual({ videoUrl: url, publish: null });

    db.videoProject.findUnique.mockResolvedValue(project({ status: "RENDERING", renderRunId: "99" }));
    await expect(handleRenderEvent(rendered)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("published and failed", () => {
  const ids = { projectId: PROJECT_ID, runId: "77" };

  it("marks the project published, and treats a duplicate delivery as a no-op", async () => {
    db.videoProject.findUnique.mockResolvedValue({ status: "RENDERED", youtubeVideoId: null, privacy: "PUBLIC" });
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    await expect(handleRenderEvent({ event: "published", ...ids, youtubeVideoId: "dQw4w9WgXcQ" })).resolves.toEqual({ ok: true });
    expect(db.videoProject.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "PUBLISHED",
      youtubeVideoId: "dQw4w9WgXcQ",
      youtubeLocked: false,
      youtubeCheckedAt: null, // the runner couldn't read the visibility back
      publishStartedAt: null,
    });

    db.videoProject.updateMany.mockResolvedValue({ count: 0 });
    db.videoProject.findUnique.mockResolvedValue({ status: "PUBLISHED", youtubeVideoId: "dQw4w9WgXcQ", privacy: "PUBLIC" });
    await expect(handleRenderEvent({ event: "published", ...ids, youtubeVideoId: "dQw4w9WgXcQ" })).resolves.toEqual({ ok: true, ignored: true });
  });

  it("flags a video YouTube kept private although it should be visible", async () => {
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    const publish = (privacy: string, visibility: { privacyStatus: "private" | "unlisted" | "public"; publishAt: string | null }) => {
      db.videoProject.findUnique.mockResolvedValue({ status: "RENDERED", youtubeVideoId: null, privacy });
      return handleRenderEvent({ event: "published", ...ids, youtubeVideoId: "dQw4w9WgXcQ", visibility });
    };
    const data = () => db.videoProject.updateMany.mock.calls.at(-1)![0].data;

    await publish("UNLISTED", { privacyStatus: "private", publishAt: null });
    expect(data()).toMatchObject({ status: "PUBLISHED", youtubeLocked: true, youtubeCheckedAt: expect.any(Date) });

    await publish("PUBLIC", { privacyStatus: "private", publishAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(data().youtubeLocked).toBe(false); // scheduled: private until its slot

    await publish("PRIVATE", { privacyStatus: "private", publishAt: null });
    expect(data().youtubeLocked).toBe(false); // private was asked for
  });

  it("fails a render but only annotates a publish failure", async () => {
    db.videoProject.updateMany.mockResolvedValue({ count: 1 });
    await handleRenderEvent({ event: "failed", ...ids, stage: "render", error: "Chrome crashed" });
    expect(db.videoProject.updateMany.mock.calls[0][0].data).toMatchObject({ status: "FAILED", lastError: "Chrome crashed" });

    await handleRenderEvent({ event: "failed", ...ids, stage: "publish", error: "quotaExceeded" });
    const publishFailure = db.videoProject.updateMany.mock.calls[1][0];
    expect(publishFailure.where).toMatchObject({ status: "RENDERED" });
    expect(publishFailure.data).toEqual({ lastError: "Auto-publish failed: quotaExceeded", publishStartedAt: null });
  });

  it("ignores a second failure report for the same run", async () => {
    db.videoProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(handleRenderEvent({ event: "failed", ...ids, stage: "render", error: "x" })).resolves.toEqual({ ok: true, ignored: true });
  });
});
