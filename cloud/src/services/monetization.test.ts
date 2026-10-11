import { describe, expect, it } from "vitest";
import { dailyPace, monetizationProgress, type StatsPoint } from "./monetization";

const NOW = new Date("2026-10-09T12:00:00Z");
const point = (daysAgo: number, subs: number | null, hours: number | null = null, shorts: number | null = null): StatsPoint => ({
  at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  subs,
  views: null,
  hours,
  shorts,
});

describe("dailyPace", () => {
  it("measures growth per day over the recent window", () => {
    expect(dailyPace([point(10, 100), point(0, 300)], "subs", NOW)).toBe(20);
  });

  it("needs two points at least a day apart", () => {
    expect(dailyPace([point(0, 300)], "subs", NOW)).toBeNull();
    expect(dailyPace([point(0.2, 280), point(0, 300)], "subs", NOW)).toBeNull();
  });

  it("ignores points older than about two weeks", () => {
    expect(dailyPace([point(40, 0), point(0, 300)], "subs", NOW)).toBeNull();
  });
});

describe("monetizationProgress", () => {
  const channel = (overrides: object = {}) => ({ subscriberCount: 250, watchHours12m: 1200, shortsViews90d: 2_400_000, statsHistory: null, ...overrides });

  it("requires subscribers plus the closer of watch hours or Shorts views", () => {
    const [fan, ads] = monetizationProgress(channel(), 5, NOW);
    expect(fan.key).toBe("fanFunding");
    // 2.4M of 3M Shorts views (80%) beats 1,200 of 3,000 hours (40%).
    expect(fan.bestPath).toBe("shorts");
    expect(fan.eligible).toBe(false);
    expect(ads.required.map((r) => r.key)).toEqual(["subs"]); // ad revenue has no upload rule
    expect(ads.progress).toBeCloseTo((0.25 + 0.3) / 2);
  });

  it("is eligible once every part is met", () => {
    const [fan] = monetizationProgress(channel({ subscriberCount: 600, shortsViews90d: 3_100_000 }), 3, NOW);
    expect(fan).toMatchObject({ eligible: true, etaDays: 0 });
  });

  it("estimates days to go from the recent pace, or null when a part isn't growing", () => {
    const history = [point(10, 150, 1000, 2_000_000), point(0, 250, 1200, 2_400_000)];
    const [fan] = monetizationProgress(channel({ statsHistory: history }), 3, NOW);
    // Subscribers: 250 to go at 10/day = 25 days; Shorts: 600k to go at 40k/day = 15 days.
    expect(fan.etaDays).toBe(25);
    const [stalled] = monetizationProgress(channel({ statsHistory: [point(10, 250), point(0, 250)] }), 3, NOW);
    expect(stalled.etaDays).toBeNull();
  });

  it("treats unknown numbers (no Analytics access) as zero progress", () => {
    const [fan] = monetizationProgress(channel({ watchHours12m: null, shortsViews90d: null }), 3, NOW);
    expect(fan.bestPath).toBeNull();
    expect(fan.eitherOf.every((r) => r.progress === 0)).toBe(true);
  });
});
