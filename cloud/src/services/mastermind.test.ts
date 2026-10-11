import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoProject: { update: vi.fn() },
  mastermindRequest: { findFirst: vi.fn(), create: vi.fn() },
}));
const pipeline = vi.hoisted(() => ({ generateProjectScript: vi.fn() }));
const labs = vi.hoisted(() => ({ addTopicsToBacklog: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./pipeline", () => pipeline);
vi.mock("./labsAutomation", () => labs);

import { applyPlan, buildMastermindPrompt, parsePlan, type Candidate, type MastermindPlan } from "./mastermind";

const NOW = new Date("2026-10-09T12:00:00Z");
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "p1",
  title: "Old title",
  topic: "Free AI tools",
  status: "SCRIPTED",
  format: "SHORT",
  scheduledFor: new Date("2026-10-11T13:00:00Z"),
  hook: "Here are three tools",
  lockedScenes: 0,
  ...overrides,
});
const plan = (overrides: Partial<MastermindPlan> = {}): MastermindPlan => ({
  strategy: "- Hook in the first second\n- Series: one free tool a day",
  diagnosis: "Hooks are slow.",
  decisions: [],
  backlog: [],
  requests: [],
  ...overrides,
});
const channel = { id: "c1", topicBacklog: null };

beforeEach(() => {
  for (const group of [...Object.values(db), pipeline, labs]) for (const fn of Object.values(group)) fn.mockReset();
  labs.addTopicsToBacklog.mockImplementation(async (_c, topics: string[]) => topics);
  db.mastermindRequest.findFirst.mockResolvedValue(null);
});

describe("applyPlan", () => {
  it("retitles, rescripts and replaces topics on upcoming videos", async () => {
    const result = await applyPlan(
      channel,
      plan({
        decisions: [
          { projectId: "p1", action: "retitle", reason: "curiosity", newTitle: "This Free AI Feels Illegal" },
          { projectId: "p2", action: "retopic", reason: "weak demand", newTopic: "Free AI that writes your resume" },
        ],
      }),
      [candidate(), candidate({ id: "p2" })],
      NOW,
    );
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { title: "This Free AI Feels Illegal" } });
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p2" }, data: { topic: "Free AI that writes your resume" } });
    expect(pipeline.generateProjectScript).toHaveBeenCalledWith("p2");
    expect(result.applied).toHaveLength(2);
  });

  it("ignores videos it wasn't offered, and never rebuilds locked or near-slot videos", async () => {
    const result = await applyPlan(
      channel,
      plan({
        decisions: [
          { projectId: "ghost", action: "retitle", reason: "x", newTitle: "Nope" },
          { projectId: "locked", action: "rescript", reason: "x" },
          { projectId: "soon", action: "rescript", reason: "x" },
        ],
      }),
      [candidate({ id: "locked", lockedScenes: 2 }), candidate({ id: "soon", scheduledFor: new Date("2026-10-09T14:00:00Z") })],
      NOW,
    );
    expect(db.videoProject.update).not.toHaveBeenCalled();
    expect(pipeline.generateProjectScript).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([expect.stringContaining("locked"), expect.stringContaining("too close")]);
  });

  it("caps rebuilds per run so one run can't burn the Gemini quota", async () => {
    const decisions = ["a", "b", "c"].map((id) => ({ projectId: id, action: "rescript" as const, reason: "x" }));
    const result = await applyPlan(channel, plan({ decisions }), ["a", "b", "c"].map((id) => candidate({ id })), NOW);
    expect(pipeline.generateProjectScript).toHaveBeenCalledTimes(2);
    expect(result.skipped).toEqual([expect.stringContaining("deferred")]);
  });

  it("only sets a new topic on a draft (its script is written later, with the new strategy)", async () => {
    await applyPlan(channel, plan({ decisions: [{ projectId: "p1", action: "retopic", reason: "x", newTopic: "Better topic here" }] }), [candidate({ status: "DRAFT" })], NOW);
    expect(pipeline.generateProjectScript).not.toHaveBeenCalled();
  });

  it("queues backlog topics and files requests once", async () => {
    db.mastermindRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "dup" });
    const result = await applyPlan(
      channel,
      plan({
        backlog: ["Free AI that edits video"],
        requests: [
          { kind: "avatar", title: "Set the new profile picture", body: "Upload it in YouTube Studio." },
          { kind: "community_post", title: "Post this poll", body: "Which tool next?" },
        ],
      }),
      [],
      NOW,
    );
    expect(result).toMatchObject({ backlogAdded: 1, requests: 1 });
    expect(db.mastermindRequest.create).toHaveBeenCalledTimes(1);
  });
});

describe("prompt and parsing", () => {
  it("gives the goal, the monetization gap and the policy limits", () => {
    const { system, prompt } = buildMastermindPrompt({
      channel: { name: "Yo Yo AI", niche: "AI tools", targetAudience: null, language: "en", growthGoal: "SUBSCRIBERS", mastermindNotes: null, performanceNotes: null },
      progress: "Ad revenue: Subscribers: 120 / 1000",
      ranking: [],
      candidates: [candidate()],
      uploads90d: 4,
      now: NOW,
    });
    expect(system).toContain("Grow subscribers");
    expect(system).toMatch(/never mislead/);
    expect(prompt).toContain("Subscribers: 120 / 1000");
    expect(prompt).toContain("id=p1");
  });

  it("rejects a plan that doesn't match the schema", () => {
    expect(() => parsePlan(JSON.stringify({ strategy: "short" }))).toThrow(/schema/);
  });
});
