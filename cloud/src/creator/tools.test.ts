import { describe, expect, it } from "vitest";
import { chapters, cuesFromScenes, deadAir, lintTitle, parseRetentionCsv, parseTranscript, retention, scoreHook, swipe } from "./tools";

// Expected values were produced by the original Python tools on the same inputs.
describe("scoreHook matches hookscore.py", () => {
  it.each([
    ["97% of channels quit before video 30. Here is what you do differently.", 63, "WORKABLE", "The Statistic", [79, 46, 88, 58, 100]],
    ["Hey guys welcome back to the channel, today is amazing", 21, "WEAK", "Unclassified", [0, 26, 22, 24, 100]],
    ["Why your first 30 seconds lose half your viewers before the hook lands?", 72, "STRONG", "The Question", [56, 96, 88, 76, 100]],
  ])("%s", (hook, verdict, band, formula, props) => {
    const r = scoreHook(hook);
    expect([r.verdict, r.band, r.formula, Object.values(r.properties)]).toEqual([verdict, band, formula, props]);
  });
});

describe("lintTitle matches title.py", () => {
  it("flags mobile truncation, vague words and a thumbnail that repeats the title", () => {
    const r = lintTitle("The ULTIMATE guide to growing your channel FAST in 2026", "GROW FAST");
    expect([r.score, r.issues.map((i) => i.kind)]).toEqual([70, ["mobile", "vague", "duplicate"]]);
  });
});

const SRT = `1
00:00:00,000 --> 00:00:02,000
So today we look at hooks

2
00:00:03,500 --> 00:00:04,000
um

3
00:00:04,100 --> 00:00:06,000
So today we look at the hook

4
00:00:06,100 --> 00:00:08,000
And then retention
`;

describe("deadAir matches deadair.py", () => {
  it("finds the restart, the gap and the filler", () => {
    const r = deadAir(parseTranscript(SRT));
    expect(r.removed).toBe(3.55);
    expect(r.cuts.map((c) => [c.kind, c.start, c.end])).toEqual([["REPEAT", 0, 2], ["DEAD", 2.225, 3.275], ["FILLER", 3.5, 4]]);
  });
});

describe("chapters", () => {
  it("starts at 0:00 and keeps chapters at least 10 s apart", () => {
    const cues = Array.from({ length: 30 }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: i < 15 ? "budget saving money tips" : "investing stocks market growth" }));
    const r = chapters(cues, 5);
    expect(r.chapters[0].label).toBe("0:00");
    expect(r.chapters.every((c) => c.seconds >= 10)).toBe(true);
  });
});

describe("cuesFromScenes", () => {
  it("turns studio word timings into sentence cues on one timeline", () => {
    const cues = cuesFromScenes([
      { durationSeconds: 2, narrationText: "Hi there.", words: [{ word: "Hi", startMs: 0, endMs: 300 }, { word: "there.", startMs: 300, endMs: 800 }] },
      { durationSeconds: 3, narrationText: "Second scene", words: [] },
    ]);
    expect(cues).toEqual([{ start: 0, end: 0.8, text: "Hi there." }, { start: 2.25, end: 5.25, text: "Second scene" }]);
  });
});

describe("retention", () => {
  it("matches retention.py: hook leak, cliffs and slide", () => {
    const csv = ["0,100", "5,90", "10,80", "20,72", "30,70", "40,68", "50,60", "60,59", "70,58", "80,57"].join("\n");
    const r = retention(parseRetentionCsv(csv))!;
    // Same numbers retention.py prints for this CSV.
    expect(r.hookLeak).toBe(20);
    expect(r.verdict).toBe("healthy");
    expect(r.cliffs.map((c) => [c.from, c.lost])).toEqual([[5, 10], [0, 10], [40, 8], [10, 8], [30, 2]]);
    expect(r.slide).toBe(0.25);
  });
});

describe("swipe", () => {
  it("ranks by multiple of each channel's own median and skips thin channels", () => {
    const vids = [100, 120, 110, 900].map((views, i) => ({ channel: "A", title: `How I saved 50% in ${i} weeks`, views }));
    const r = swipe([...vids, { channel: "B", title: "x", views: 5 }], 2);
    expect(r.outliers).toHaveLength(1);
    expect(r.outliers[0].multiple).toBe(7.83);
    expect(r.thin).toEqual([["B", 1]]);
  });
});
