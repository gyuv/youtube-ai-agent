import { describe, expect, it, vi } from "vitest";

// The real Remotion pipeline is exercised by scripts/render-smoke.ts; here we test the control flow.
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn() }));
vi.mock("@remotion/renderer", () => ({
  ensureBrowser: vi.fn(),
  getVideoMetadata: vi.fn(),
  renderMedia: vi.fn(),
  selectComposition: vi.fn(),
}));

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

describe("runRender", () => {
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
