import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("./youtube", () => ({ getChannelAccessToken: vi.fn() }));

import { buildLearningPrompt, fetchVideoStats, rankPerformance } from "./analytics";

const NOW = new Date("2026-10-10T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const video = (title: string, days: number, views: number | null) => ({
  title,
  topic: title,
  format: "SHORT",
  publishedAt: daysAgo(days),
  viewCount: views,
  likeCount: 1,
  commentCount: 0,
});

afterEach(() => vi.unstubAllGlobals());

describe("rankPerformance", () => {
  it("ranks by views per day and skips videos too new or without stats", () => {
    const ranked = rankPerformance(
      [video("Old hit", 10, 1000), video("Fresh hit", 4, 800), video("Brand new", 1, 5000), video("No stats", 5, null)],
      NOW,
    );
    expect(ranked.map((r) => r.title)).toEqual(["Fresh hit", "Old hit"]);
    expect(ranked[0].viewsPerDay).toBe(200);
  });
});

describe("buildLearningPrompt", () => {
  it("contrasts best and weakest videos without listing one twice", () => {
    const ranked = rankPerformance([video("A", 3, 900), video("B", 3, 300), video("C", 3, 30)], NOW);
    const { prompt } = buildLearningPrompt({ niche: "Personal finance", targetAudience: "Young Indians" }, ranked);
    expect(prompt).toContain("Best performers");
    expect(prompt).toContain('"A"');
    expect(prompt.match(/"C"/g)).toHaveLength(1);
  });
});

describe("fetchVideoStats", () => {
  it("reads statistics in batches of 50", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const ids = new URL(url).searchParams.get("id")!.split(",");
      return Response.json({ items: ids.map((id) => ({ id, statistics: { viewCount: "12", likeCount: "3", commentCount: "1" } })) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 60 }, (_, i) => `vid${i}`);
    const stats = await fetchVideoStats(ids, "token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stats.get("vid59")).toEqual({ viewCount: 12, likeCount: 3, commentCount: 1 });
  });
});
