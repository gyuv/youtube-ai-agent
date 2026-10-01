import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  videoProject: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
const gemini = vi.hoisted(() => ({ generateGeminiJson: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./youtube", () => ({ getChannelAccessToken: vi.fn() }));
vi.mock("./gemini", async (orig) => ({ ...(await orig<typeof import("./gemini")>()), generateGeminiJson: gemini.generateGeminiJson }));

import { applyToProject, buildToolPrompt, runCreatorTool, voiceProfile } from "./creatorStudio";
import { findTool } from "@/creator/catalog";

const CHANNEL = {
  id: "c1",
  name: "Money Minute",
  niche: "Personal finance for young Indians",
  targetAudience: "Salaried 22-30 year olds",
  language: "en",
  defaultFormat: "SHORT",
  defaultVoice: "en-IN-NeerjaNeural",
  defaultScriptPrompt: "Plain words, one idea per Short.",
  performanceNotes: "- Rupee amounts in titles win",
};
const VIDEOS = [{ id: "p1", title: "Save ₹10,000 in 30 days", topic: "saving", format: "SHORT", status: "PUBLISHED", publishedAt: new Date(), viewCount: 1200, likeCount: 40, commentCount: 3 }];

beforeEach(() => {
  for (const group of [db.channel, db.videoProject, gemini]) for (const fn of Object.values(group)) fn.mockReset();
  db.channel.findUnique.mockResolvedValue(CHANNEL);
  db.videoProject.findMany.mockResolvedValue(VIDEOS);
});

describe("voiceProfile", () => {
  it("adapts to the channel: niche, style guide, learned lessons and real stats", () => {
    const profile = voiceProfile({ channel: CHANNEL, videos: VIDEOS } as never);
    expect(profile).toContain("Personal finance for young Indians");
    expect(profile).toContain("Plain words, one idea per Short.");
    expect(profile).toContain("Rupee amounts in titles win");
    expect(profile).toContain('"Save ₹10,000 in 30 days" (Short): 1200 / 40 / 3');
  });
});

describe("buildToolPrompt", () => {
  it("carries the original skill text, the computed tool output and the apply instruction", () => {
    const { system, prompt } = buildToolPrompt(findTool("yt-package")!, { idea: "x" }, "PROFILE", { titleLint: { score: 70 } });
    expect(system).toContain("# yt-package");
    expect(system).toContain("apply.title");
    expect(prompt).toContain("PROFILE");
    expect(prompt).toContain('"score":70');
  });
});

describe("runCreatorTool", () => {
  it("scores the script's hooks with the real heuristics", async () => {
    gemini.generateGeminiJson.mockResolvedValue({ model: "m", value: { markdown: "## Script\nHello there friends", hooks: ["Hey guys welcome back", "Why your SIP fails before month 6?"] } });
    const run = await runCreatorTool("yt-script", "c1", { idea: "SIP mistakes" });
    const scores = run.data.hookScores as Array<{ hook: string; verdict: number }>;
    expect(scores[0].hook).toBe("Why your SIP fails before month 6?");
    expect(scores[0].verdict).toBeGreaterThan(scores[1].verdict);
  });

  it("computes the edit list before writing", async () => {
    gemini.generateGeminiJson.mockResolvedValue({ model: "m", value: { markdown: "## Cuts\nMake these three cuts." } });
    const srt = "1\n00:00:00,000 --> 00:00:02,000\nhello there\n\n2\n00:00:04,000 --> 00:00:05,000\num\n";
    const run = await runCreatorTool("yt-edit", "c1", { transcript: srt });
    expect((run.data.edl as { cuts: unknown[] }).cuts.length).toBe(2);
  });

  it("requires the tool's required fields", async () => {
    await expect(runCreatorTool("yt-comment", "c1", {})).rejects.toThrow(/Comments is required/);
  });
});

describe("applyToProject", () => {
  it("replaces an earlier chapter block in the description instead of stacking them", async () => {
    db.videoProject.findUnique.mockResolvedValue({ status: "RENDERED", description: "About this.\n\nChapters\n0:00 Old" });
    db.videoProject.update.mockImplementation(async ({ data }) => data);
    const data = await applyToProject("p1", { chapters: "0:00 Intro\n0:30 Tips\n1:10 Recap" });
    expect(data.description).toBe("About this.\n\nChapters\n0:00 Intro\n0:30 Tips\n1:10 Recap");
  });

  it("refuses videos already on YouTube", async () => {
    db.videoProject.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    await expect(applyToProject("p1", { title: "x" })).rejects.toThrow(/already on YouTube/);
  });
});
