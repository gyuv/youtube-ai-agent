import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoProject: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  channel: { update: vi.fn(), findUnique: vi.fn() },
  labReport: { create: vi.fn(), findMany: vi.fn() },
}));
const studio = vi.hoisted(() => ({ runCreatorTool: vi.fn(), applyToProject: vi.fn(), projectInputs: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./creatorStudio", () => studio);

import { addTopicsToBacklog, packageProject, runGrowthReview } from "./labsAutomation";

const NOW = new Date("2026-10-02T10:00:00Z");

beforeEach(() => {
  for (const group of [db.videoProject, db.channel, db.labReport, studio]) for (const fn of Object.values(group)) fn.mockReset();
  db.videoProject.findMany.mockResolvedValue([{ topic: "Save money on rent", title: null }]);
});

describe("packageProject", () => {
  it("applies the new title, then writes SEO for that title, and marks the video packaged", async () => {
    db.videoProject.findUnique.mockResolvedValue({ id: "p1", channelId: "c1", format: "SHORT" });
    studio.projectInputs.mockResolvedValue({ idea: "idea", title: "Old title", transcript: "srt" });
    studio.runCreatorTool.mockImplementation(async (tool: string, _c: string, input: Record<string, string>) =>
      tool === "yt-package" ? { markdown: "## Pairing\nNew title wins", data: {}, apply: { title: "₹500 a month trick" } } : { markdown: `## SEO for ${input.title}`, data: {}, apply: { description: "d" } },
    );
    const result = await packageProject("p1", NOW);
    expect(result).toEqual({ applied: ["title", "SEO"], failed: [] });
    expect(studio.runCreatorTool.mock.calls[1][2]).toMatchObject({ title: "₹500 a month trick" });
    expect(studio.runCreatorTool).toHaveBeenCalledTimes(2); // no chapters for a Short
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { labsAppliedAt: NOW } });
  });

  it("still marks the video packaged when a step fails, so the render isn't held back", async () => {
    db.videoProject.findUnique.mockResolvedValue({ id: "p1", channelId: "c1", format: "LONG_FORM" });
    studio.projectInputs.mockResolvedValue({ idea: "idea", title: "t", transcript: "srt" });
    studio.runCreatorTool.mockRejectedValue(new Error("Gemini quota"));
    const result = await packageProject("p1", NOW);
    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect(db.videoProject.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { labsAppliedAt: NOW } });
  });
});

describe("addTopicsToBacklog", () => {
  it("appends new ideas, skipping ones already in the backlog or already made", async () => {
    const added = await addTopicsToBacklog({ id: "c1", topicBacklog: "Gold vs FD in 2026" }, ["1. Gold vs FD in 2026", "Save money on rent!", "Credit card mistakes at 25", "x"]);
    expect(added).toEqual(["Credit card mistakes at 25"]);
    expect(db.channel.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { topicBacklog: "Gold vs FD in 2026\nCredit card mistakes at 25" } });
  });
});

describe("runGrowthReview", () => {
  it("skips the YouTube search without a connection and feeds earlier findings into the plan", async () => {
    studio.runCreatorTool.mockImplementation(async (tool: string) => ({ markdown: `## ${tool} result line`, data: {}, topics: tool === "yt-plan" ? ["SIP vs lump sum for beginners"] : [] }));
    db.channel.findUnique.mockResolvedValue({ id: "c1", topicBacklog: null });
    const result = await runGrowthReview({ id: "c1", oauthRefreshTokenEnc: null } as never, NOW);
    expect(result).toEqual({ ran: ["yt-audit", "yt-plan"], failed: [], added: ["SIP vs lump sum for beginners"] });
    expect(studio.runCreatorTool.mock.calls[1][2].notes).toContain("yt-audit");
    expect(db.channel.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { growthReviewAt: NOW } });
  });
});
