import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real Remotion pipeline is exercised by scripts/render-smoke.ts; here we test the control flow.
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn() }));
vi.mock("@remotion/renderer", () => ({
  ensureBrowser: vi.fn(),
  getVideoMetadata: vi.fn(),
  renderMedia: vi.fn(async ({ outputLocation }: { outputLocation: string }) => writeFile(outputLocation, Buffer.alloc(2048))),
  selectComposition: vi.fn(async () => ({ durationInFrames: 300, fps: 30, width: 1080, height: 1920 })),
}));
vi.mock("./assets", () => ({ prepareRenderProps: vi.fn(async () => ({ format: "SHORT", captions: true, scenes: [] })) }));

import { readWorkerConfig, runRender } from "./runRender";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const ENV = {
  APP_URL: "https://studio.example",
  RENDER_WEBHOOK_SECRET: "s".repeat(40),
  PROJECT_ID: "cabcdefghijklmnopqrstuvw",
  GITHUB_RUN_ID: "555",
  GITHUB_RUN_ATTEMPT: "2",
};

describe("readWorkerConfig", () => {
  it("reads the Actions environment", () => {
    expect(readWorkerConfig(ENV)).toMatchObject({ projectId: ENV.PROJECT_ID, runId: "555", runAttempt: 2, browserExecutable: null });
  });

  it("refuses to send the webhook secret over plain http or to a bad project id", () => {
    expect(() => readWorkerConfig({ ...ENV, APP_URL: "http://studio.example" })).toThrow(/https/);
    expect(readWorkerConfig({ ...ENV, APP_URL: "http://127.0.0.1:3000" }).appUrl).toBe("http://127.0.0.1:3000");
    expect(() => readWorkerConfig({ ...ENV, PROJECT_ID: "x; rm -rf /" })).toThrow(/not a valid project id/);
    expect(() => readWorkerConfig({ ...ENV, RENDER_WEBHOOK_SECRET: "" })).toThrow(/RENDER_WEBHOOK_SECRET/);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("runRender", () => {
  it("publishes, then reports the visibility YouTube applied", async () => {
    const events: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn<FetchFn>(async (url, init) => {
      if (url.startsWith(ENV.APP_URL)) {
        const body = JSON.parse(String(init?.body));
        events.push(body);
        if (body.event === "started") {
          return Response.json({
            job: { projectId: ENV.PROJECT_ID, format: "SHORT", captions: true, scenes: [], maxBytes: 50e6, upload: { url: "https://storage.example/put", method: "PUT", headers: {} } },
          });
        }
        if (body.event === "rendered") {
          return Response.json({
            videoUrl: "https://cdn.example/v.mp4",
            publish: {
              accessToken: "ya29.t",
              metadata: { snippet: { title: "T", description: "", tags: [], categoryId: "22" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true } },
            },
          });
        }
        return Response.json({ ok: true });
      }
      if (url === "https://storage.example/put") return new Response(null, { status: 200 });
      if (url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload.example/session" } });
      if (url === "https://upload.example/session") return Response.json({ id: "dQw4w9WgXcQ", status: { privacyStatus: "public" } });
      // The fresh read-back wins over the upload response.
      if (url.includes("/youtube/v3/videos?part=status")) return Response.json({ items: [{ status: { privacyStatus: "private" } }] });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    const outDir = await mkdtemp(path.join(os.tmpdir(), "render-"));
    const result = await runRender({ ...readWorkerConfig(ENV), outDir, browserExecutable: "/bin/chromium" });

    expect(result).toMatchObject({ outcome: "published", youtubeVideoId: "dQw4w9WgXcQ" });
    expect(events.at(-1)).toMatchObject({ event: "published", youtubeVideoId: "dQw4w9WgXcQ", visibility: { privacyStatus: "private", publishAt: null } });
    expect(logs.mock.calls.flat().join("\n")).toMatch(/kept this video private although public was requested/);
    logs.mockRestore();
  });

  it("reports a failure to the app before exiting", async () => {
    const fetchMock = vi.fn<FetchFn>(async (_url, init) => {
      const event = JSON.parse(String(init?.body)).event;
      return event === "started"
        ? new Response(JSON.stringify({ error: "Project is PUBLISHED; this run can't render it." }), { status: 409 })
        : new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runRender(readWorkerConfig(ENV))).rejects.toThrow(/409/);
    const report = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(report).toMatchObject({ event: "failed", stage: "render", projectId: ENV.PROJECT_ID, runId: "555" });
    expect(report.error).toMatch(/Project is PUBLISHED/);
  });
});
