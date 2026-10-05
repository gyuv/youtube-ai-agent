import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const clipJob = { findUnique: vi.fn(), update: vi.fn() };
  return {
    clipJob,
    channel: { findUniqueOrThrow: vi.fn() },
    videoProject: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ clipJob, $queryRaw: vi.fn(async () => []) })),
  };
});
const dispatch = vi.hoisted(() => ({ dispatchRepositoryEvent: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/storage", () => ({
  createSignedUpload: vi.fn(async (path: string) => ({ url: `https://signed/${path}`, method: "PUT", headers: {}, publicUrl: `https://cdn/${path}` })),
  publicObjectUrl: (path: string) => `https://cdn/${path}`,
}));
vi.mock("./renderDispatcher", () => dispatch);
vi.mock("@/lib/ensureSchema", () => ({ ensureClipSchema: vi.fn(async () => undefined) }));
vi.mock("./youtube", () => ({ getChannelAccessToken: vi.fn() }));

const { handleClipEvent, renderClipJob } = await import("./clipJobs");

const JOB = "cabcdefghijklmnopqrstuvw";
const moment = (id: string, extra: object = {}) => ({
  id, start: 10, end: 40, title: `T ${id}`, hook: "hook", reason: "r", score: 80, focusX: 0.5, selected: true, status: "pending", captions: [], ...extra,
});
let row: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  row = { id: JOB, channelId: "ch1", videoId: "dQw4w9WgXcQ", sourceTitle: "Talk", durationSeconds: 600, status: "RENDERING", layout: "crop", burnCaptions: true, moments: [moment("a"), moment("b", { selected: false })], renderRunId: null, lastError: null, channel: { id: "ch1", name: "Main" } };
  db.clipJob.findUnique.mockImplementation(async () => structuredClone(row));
  db.clipJob.update.mockImplementation(async ({ data }: { data: object }) => Object.assign(row, data));
  db.channel.findUniqueOrThrow.mockResolvedValue({ defaultPrivacy: "PRIVATE" });
  db.videoProject.create.mockResolvedValue({ id: "proj1" });
});

const ids = { jobId: JOB, runId: "99" };

it("started hands the worker only the selected moments", async () => {
  const order = (await handleClipEvent({ event: "started", ...ids })) as { moments: Array<{ id: string }>; sourceUrl: string };
  expect(order.moments.map((m) => m.id)).toEqual(["a"]);
  expect(order.sourceUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  expect(row.renderRunId).toBe("99");
});

it("clip-done creates a rendered Short project once", async () => {
  await handleClipEvent({ event: "clip-done", ...ids, momentId: "a", bytes: 123 });
  expect(db.videoProject.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "RENDERED", format: "SHORT", title: "T a", renderedVideoUrl: `https://cdn/clips/${JOB}/a.mp4` }) }),
  );
  expect((row.moments as Array<{ id: string; status: string; projectId?: string }>)[0]).toMatchObject({ status: "done", projectId: "proj1" });
  await handleClipEvent({ event: "clip-done", ...ids, momentId: "a", bytes: 123 });
  expect(db.videoProject.create).toHaveBeenCalledTimes(1);
});

it("finished marks clips the worker never reported as failed", async () => {
  row.moments = [moment("a", { status: "rendering" }), moment("b", { status: "done", projectId: "p" })];
  await handleClipEvent({ event: "finished", ...ids });
  expect(row.status).toBe("DONE");
  expect((row.moments as Array<{ status: string }>).map((m) => m.status)).toEqual(["failed", "done"]);
});

it("a failed run with nothing done fails the job", async () => {
  await handleClipEvent({ event: "failed", ...ids, error: "runner died" });
  expect(row).toMatchObject({ status: "FAILED", lastError: "runner died" });
});

describe("renderClipJob", () => {
  beforeEach(() => {
    row.status = "REVIEW";
  });

  it("dispatches the GitHub workflow", async () => {
    await expect(renderClipJob(JOB)).resolves.toMatchObject({ count: 1 });
    expect(dispatch.dispatchRepositoryEvent).toHaveBeenCalledWith("clip-video", { job_id: JOB });
    expect(row.status).toBe("RENDERING");
  });

  it("goes back to review when the dispatch fails", async () => {
    dispatch.dispatchRepositoryEvent.mockRejectedValueOnce(new Error("GitHub dispatch failed with 401"));
    await expect(renderClipJob(JOB)).rejects.toThrow(/401/);
    expect(row).toMatchObject({ status: "REVIEW", lastError: "GitHub dispatch failed with 401" });
  });
});
