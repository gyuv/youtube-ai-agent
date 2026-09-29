import { beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineError } from "@/lib/errors";

const handleRenderEvent = vi.hoisted(() => vi.fn());
vi.mock("@/services/renderJob", () => ({ handleRenderEvent }));

import { POST } from "./route";

const SECRET = "x".repeat(40);
const EVENT = { event: "started", projectId: "cabcdefghijklmnopqrstuvw", runId: "123", runAttempt: 1 };

const call = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(
    new Request("http://localhost/api/render/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/render/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("RENDER_WEBHOOK_SECRET", SECRET);
    handleRenderEvent.mockReset();
  });

  it("refuses to run with a missing or weak secret", async () => {
    vi.stubEnv("RENDER_WEBHOOK_SECRET", "short");
    expect((await call(EVENT)).status).toBe(503);
    expect(handleRenderEvent).not.toHaveBeenCalled();
  });

  it("rejects missing and wrong bearer tokens", async () => {
    expect((await call(EVENT, null)).status).toBe(401);
    expect((await call(EVENT, `Bearer ${"y".repeat(40)}`)).status).toBe(401);
    expect(handleRenderEvent).not.toHaveBeenCalled();
  });

  it("validates the payload before touching the database", async () => {
    expect((await call("{not json")).status).toBe(400);
    const bad = await call({ ...EVENT, projectId: "../../etc" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/invalid project id/);
    expect(handleRenderEvent).not.toHaveBeenCalled();
  });

  it("passes valid events to the handler and returns its result", async () => {
    handleRenderEvent.mockResolvedValue({ ok: true });
    const res = await call(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handleRenderEvent).toHaveBeenCalledWith(EVENT);
  });

  it("maps pipeline errors to HTTP status codes", async () => {
    handleRenderEvent.mockRejectedValue(new PipelineError("CONFLICT", "Another run claimed this project first."));
    const res = await call(EVENT);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Another run claimed this project first.", code: "CONFLICT" });
  });
});
