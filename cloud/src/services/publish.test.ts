import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ videoProject: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() } }));
const yt = vi.hoisted(() => ({ getChannelAccessToken: vi.fn(), buildYouTubeMetadata: vi.fn(), wantedVisibility: vi.fn() }));
const upload = vi.hoisted(() => ({ uploadVideoToYouTube: vi.fn() }));
const vis = vi.hoisted(() => ({ fetchVideoVisibility: vi.fn(), isLockedPrivate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./youtube", () => yt);
vi.mock("@/worker/youtubeUpload", () => upload);
vi.mock("./youtubeVisibility", () => vis);

import { publishRenderedProject } from "./publish";

const PROJECT = {
  id: "p1",
  status: "RENDERED",
  renderedVideoUrl: "https://cdn/render.mp4",
  youtubeVideoId: null,
  privacy: "PUBLIC",
  channel: { id: "c1", name: "Ch", oauthRefreshTokenEnc: "enc" },
  scenes: [],
};

beforeEach(() => {
  for (const group of [db.videoProject, yt, upload, vis]) for (const fn of Object.values(group)) fn.mockReset();
  db.videoProject.findUnique.mockResolvedValue(PROJECT);
  db.videoProject.updateMany.mockResolvedValue({ count: 1 });
  yt.getChannelAccessToken.mockResolvedValue("token");
  yt.buildYouTubeMetadata.mockReturnValue({ snippet: {}, status: { privacyStatus: "public" } });
  yt.wantedVisibility.mockReturnValue("public");
  vis.fetchVideoVisibility.mockResolvedValue({ privacyStatus: "public", publishAt: null });
  vis.isLockedPrivate.mockReturnValue(false);
  upload.uploadVideoToYouTube.mockResolvedValue({ videoId: "vid12345678", visibility: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
});

describe("publishRenderedProject", () => {
  it("uploads the stored mp4 and marks the project published", async () => {
    expect(await publishRenderedProject("p1")).toEqual({ youtubeVideoId: "vid12345678", locked: false });
    expect(upload.uploadVideoToYouTube.mock.calls[0][0].bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(db.videoProject.update.mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED", youtubeVideoId: "vid12345678", lastError: null });
  });

  it("refuses videos that aren't rendered or are already on YouTube", async () => {
    db.videoProject.findUnique.mockResolvedValue({ ...PROJECT, status: "ASSETS_READY" });
    await expect(publishRenderedProject("p1")).rejects.toThrow(/Only rendered/);
    db.videoProject.findUnique.mockResolvedValue({ ...PROJECT, youtubeVideoId: "x" });
    await expect(publishRenderedProject("p1")).rejects.toThrow(/already on YouTube/);
  });

  it("won't upload twice while a publish is in progress", async () => {
    db.videoProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(publishRenderedProject("p1")).rejects.toThrow(/already being published/);
    expect(upload.uploadVideoToYouTube).not.toHaveBeenCalled();
  });

  it("keeps the video RENDERED and explains a failure", async () => {
    upload.uploadVideoToYouTube.mockRejectedValue(new Error("quotaExceeded"));
    await expect(publishRenderedProject("p1")).rejects.toThrow(/quotaExceeded/);
    expect(db.videoProject.update.mock.calls[0][0].data.lastError).toMatch(/Publishing to YouTube failed: quotaExceeded/);
  });
});
