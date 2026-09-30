import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ videoProject: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() } }));
const youtube = vi.hoisted(() => ({
  getChannelAccessToken: vi.fn(),
  buildYouTubeMetadata: vi.fn(),
  wantedVisibility: vi.fn((privacy: string) => privacy.toLowerCase()),
}));
const upload = vi.hoisted(() => ({ uploadVideoToYouTube: vi.fn() }));
const visibility = vi.hoisted(() => ({ fetchVideoVisibility: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./youtube", () => youtube);
vi.mock("@/worker/youtubeUpload", () => upload);
vi.mock("./youtubeVisibility", async (importActual) => ({ ...(await importActual<typeof import("./youtubeVisibility")>()), ...visibility }));

import { publishRenderedProject } from "./publisher";

const NOW = new Date("2026-09-30T08:00:00Z");
const project = (overrides: object = {}) => ({
  id: "p1",
  status: "RENDERED",
  privacy: "PUBLIC",
  renderedVideoUrl: "https://cdn.example/v.mp4",
  youtubeVideoId: null,
  scheduledFor: null,
  channel: { id: "c1", name: "Money Minute", language: "en", oauthRefreshTokenEnc: "enc" },
  scenes: [{ sceneIndex: 0, durationSeconds: 5 }],
  ...overrides,
});
const PUBLIC_NOW = { snippet: {}, status: { privacyStatus: "public" } };

beforeEach(() => {
  for (const fn of [...Object.values(db.videoProject), youtube.getChannelAccessToken, youtube.buildYouTubeMetadata, upload.uploadVideoToYouTube, visibility.fetchVideoVisibility]) fn.mockReset();
  db.videoProject.updateMany.mockResolvedValue({ count: 1 });
  youtube.getChannelAccessToken.mockResolvedValue("ya29.t");
  youtube.buildYouTubeMetadata.mockReturnValue(PUBLIC_NOW);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
});

describe("publishRenderedProject", () => {
  it("uploads the stored render and records the video", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    upload.uploadVideoToYouTube.mockResolvedValue({ videoId: "dQw4w9WgXcQ", visibility: null });
    visibility.fetchVideoVisibility.mockResolvedValue({ privacyStatus: "public", publishAt: null });

    await expect(publishRenderedProject("p1", NOW)).resolves.toEqual({
      youtubeVideoId: "dQw4w9WgXcQ",
      visibility: { privacyStatus: "public", publishAt: null },
      locked: false,
      scheduledFor: null,
    });
    const claim = db.videoProject.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "p1", status: "RENDERED", youtubeVideoId: null });
    expect(claim.data).toEqual({ publishStartedAt: NOW });
    expect(upload.uploadVideoToYouTube.mock.calls[0][0]).toMatchObject({ file: new Uint8Array([1, 2, 3]), metadata: PUBLIC_NOW, accessToken: "ya29.t" });
    expect(db.videoProject.update.mock.calls[0][0].data).toMatchObject({
      status: "PUBLISHED",
      youtubeVideoId: "dQw4w9WgXcQ",
      publishStartedAt: null,
      youtubeLocked: false,
      lastError: null,
    });
  });

  it("flags a video YouTube kept private", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    upload.uploadVideoToYouTube.mockResolvedValue({ videoId: "dQw4w9WgXcQ", visibility: null });
    visibility.fetchVideoVisibility.mockResolvedValue({ privacyStatus: "private", publishAt: null });
    await expect(publishRenderedProject("p1", NOW)).resolves.toMatchObject({ locked: true });
    expect(db.videoProject.update.mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED", youtubeLocked: true });
  });

  it("reports a scheduled upload", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    youtube.buildYouTubeMetadata.mockReturnValue({ snippet: {}, status: { privacyStatus: "private", publishAt: "2026-10-01T12:30:00.000Z" } });
    upload.uploadVideoToYouTube.mockResolvedValue({ videoId: "dQw4w9WgXcQ", visibility: { privacyStatus: "private", publishAt: "2026-10-01T12:30:00.000Z" } });
    visibility.fetchVideoVisibility.mockRejectedValue(new Error("offline")); // falls back to the upload response
    await expect(publishRenderedProject("p1", NOW)).resolves.toMatchObject({ locked: false, scheduledFor: new Date("2026-10-01T12:30:00.000Z") });
  });

  it("explains what's missing before touching YouTube", async () => {
    db.videoProject.findUnique.mockResolvedValue(project({ channel: { ...project().channel, oauthRefreshTokenEnc: null } }));
    await expect(publishRenderedProject("p1", NOW)).rejects.toThrow(/Connect "Money Minute" to YouTube first/);
    db.videoProject.findUnique.mockResolvedValue(project({ status: "SCRIPTED", renderedVideoUrl: null }));
    await expect(publishRenderedProject("p1", NOW)).rejects.toThrow(/Render the video first/);
    db.videoProject.findUnique.mockResolvedValue(project({ status: "PUBLISHED" }));
    await expect(publishRenderedProject("p1", NOW)).rejects.toThrow(/already on YouTube/);
    expect(upload.uploadVideoToYouTube).not.toHaveBeenCalled();
  });

  it("never uploads twice while another upload holds the lease", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    db.videoProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(publishRenderedProject("p1", NOW)).rejects.toThrow(/already being uploaded/);
    expect(upload.uploadVideoToYouTube).not.toHaveBeenCalled();
  });

  it("releases the lease and records why when the upload fails", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    db.videoProject.update.mockResolvedValue({});
    upload.uploadVideoToYouTube.mockRejectedValue(new Error("YouTube rejected the upload (403 quotaExceeded: quota)"));
    await expect(publishRenderedProject("p1", NOW)).rejects.toMatchObject({ code: "PROVIDER", message: expect.stringMatching(/quotaExceeded/) });
    expect(db.videoProject.update.mock.calls[0][0].data).toEqual({
      publishStartedAt: null,
      lastError: "Publishing to YouTube failed: YouTube rejected the upload (403 quotaExceeded: quota)",
    });
  });

  it("keeps the lease and names the video if it can't record a finished upload", async () => {
    db.videoProject.findUnique.mockResolvedValue(project());
    upload.uploadVideoToYouTube.mockResolvedValue({ videoId: "dQw4w9WgXcQ", visibility: null });
    visibility.fetchVideoVisibility.mockResolvedValue(null);
    db.videoProject.update.mockRejectedValue(new Error("connection reset"));
    await expect(publishRenderedProject("p1", NOW)).rejects.toThrow(/youtu\.be\/dQw4w9WgXcQ.*Don't publish it again/);
    expect(db.videoProject.update).toHaveBeenCalledTimes(1); // no second write that would free the lease
  });
});
