import { describe, expect, it } from "vitest";
import { buildAss, reframeFilter } from "./runClips";

describe("reframeFilter", () => {
  it("crops a 9:16 window around the subject of a landscape video", () => {
    expect(reframeFilter("crop", { width: 1920, height: 1080 }, 0.5, undefined)).toBe("[0:v]crop=606:1080:657:0,scale=1080:1920,setsar=1[v]");
    expect(reframeFilter("crop", { width: 1920, height: 1080 }, 0, undefined)).toContain("crop=606:1080:0:0");
    expect(reframeFilter("crop", { width: 1920, height: 1080 }, 1, undefined)).toContain("crop=606:1080:1314:0");
  });

  it("fits the whole frame on a blurred background", () => {
    expect(reframeFilter("fit", { width: 1920, height: 1080 }, 0.5, "/tmp/a.ass")).toMatch(/boxblur.*overlay.*ass='\/tmp\/a\.ass'\[v\]$/);
  });

  it("pads an already-vertical source instead of cropping it", () => {
    expect(reframeFilter("crop", { width: 720, height: 1280 }, 0.5, undefined)).toContain("pad=1080:1920");
  });
});

it("buildAss times captions from the clip start and strips override braces", () => {
  const ass = buildAss([{ start: 101, end: 102.5, text: "hi {there}" }, { start: 50, end: 60, text: "outside" }], 100, 110);
  expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,HI THERE");
  expect(ass).not.toContain("OUTSIDE");
});
