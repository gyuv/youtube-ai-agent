import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ workerHeartbeat: { findUnique: vi.fn(), upsert: vi.fn() } }));
const gh = vi.hoisted(() => ({ dispatchAutopilotRun: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./renderDispatcher", () => gh);

import { nudgeAutopilotIfQuiet } from "./flowWorker";

const NOW = new Date("2026-10-15T12:00:00Z");
const ago = (min: number) => ({ seenAt: new Date(NOW.getTime() - min * 60_000) });

beforeEach(() => vi.clearAllMocks());

it("starts an autopilot run when none has checked in for over an hour", async () => {
  db.workerHeartbeat.findUnique.mockImplementation(async ({ where }) => (where.engine === "OFFICER" ? ago(120) : null));
  expect(await nudgeAutopilotIfQuiet(NOW)).toBe(true);
  expect(gh.dispatchAutopilotRun).toHaveBeenCalledTimes(1);
});

it("leaves a recently active autopilot alone, and nudges at most every half hour", async () => {
  db.workerHeartbeat.findUnique.mockImplementation(async ({ where }) => (where.engine === "OFFICER" ? ago(20) : null));
  expect(await nudgeAutopilotIfQuiet(NOW)).toBe(false);
  db.workerHeartbeat.findUnique.mockImplementation(async ({ where }) => (where.engine === "OFFICER" ? ago(120) : ago(10)));
  expect(await nudgeAutopilotIfQuiet(NOW)).toBe(false);
  expect(gh.dispatchAutopilotRun).not.toHaveBeenCalled();
});
