import { beforeEach, describe, expect, it, vi } from "vitest";

const autopilotTick = vi.hoisted(() => vi.fn());
const eventCreate = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/services/autopilot", () => ({ autopilotTick }));
vi.mock("@/lib/prisma", () => ({ prisma: { autopilotEvent: { create: eventCreate } } }));

import { POST } from "./route";

const SECRET = "r".repeat(40);
const call = (auth: string | null = `Bearer ${SECRET}`) =>
  POST(new Request("http://localhost/api/autopilot/tick", { method: "POST", headers: auth ? { authorization: auth } : {} }));

describe("POST /api/autopilot/tick", () => {
  beforeEach(() => {
    vi.stubEnv("RENDER_WEBHOOK_SECRET", SECRET);
    autopilotTick.mockReset();
    eventCreate.mockClear();
  });

  it("only runs for the GitHub runner", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(autopilotTick).not.toHaveBeenCalled();
  });

  it("returns the step it took", async () => {
    autopilotTick.mockResolvedValue({ action: "planned", message: "Planned", more: true, swept: 0 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: "planned", more: true });
  });

  it("logs a crash to the activity feed and tells the runner to stop", async () => {
    autopilotTick.mockRejectedValue(new Error("database unreachable"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ action: "error", more: false });
    expect(eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ level: "error", message: expect.stringMatching(/database unreachable/) }) });
  });
});
