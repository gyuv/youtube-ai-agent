import { describe, expect, it } from "vitest";
import { FPS, SCENE_TAIL_SECONDS, dimensionsFor, paginateCaptions, sceneFrames, sceneSlots, totalFrames } from "./timeline";

const w = (word: string, startMs: number, endMs: number) => ({ word, startMs, endMs });

describe("timeline", () => {
  it("adds a short tail to every scene and rounds up to whole frames", () => {
    expect(sceneFrames(2)).toBe(Math.ceil((2 + SCENE_TAIL_SECONDS) * FPS));
    expect(totalFrames([{ durationSeconds: 2 }, { durationSeconds: 1.01 }])).toBe(sceneFrames(2) + sceneFrames(1.01));
    expect(totalFrames([])).toBe(1);
  });

  it("lays scenes end to end", () => {
    const slots = sceneSlots([{ durationSeconds: 2 }, { durationSeconds: 1 }, { durationSeconds: 3 }]);
    expect(slots.map((s) => s.from)).toEqual([0, sceneFrames(2), sceneFrames(2) + sceneFrames(1)]);
    expect(slots.at(-1)!.from + slots.at(-1)!.durationInFrames).toBe(totalFrames([{ durationSeconds: 2 }, { durationSeconds: 1 }, { durationSeconds: 3 }]));
  });

  it("maps formats to 1080p canvases", () => {
    expect(dimensionsFor("SHORT")).toEqual({ width: 1080, height: 1920 });
    expect(dimensionsFor("LONG_FORM")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("paginateCaptions", () => {
  it("splits on word count, sentence ends and pauses", () => {
    const words = [
      w("One", 0, 200),
      w("two", 250, 400),
      w("three", 450, 600),
      w("four.", 650, 800), // sentence end
      w("Five", 850, 1000),
      w("six", 2000, 2200), // 1s pause before
    ];
    const pages = paginateCaptions(words, 3).map((p) => p.words.map((x) => x.word).join(" "));
    expect(pages).toEqual(["One two three", "four.", "Five", "six"]);
  });

  it("lingers briefly after a page but never overlaps the next one", () => {
    const pages = paginateCaptions([w("a", 0, 100), w("b.", 150, 300), w("c", 400, 500), w("d", 3000, 3100)], 2);
    expect(pages[0].endMs).toBe(400); // clipped at the next page's start
    expect(pages[1].endMs).toBe(900); // 400ms linger before a long pause
    expect(pages.at(-1)!.endMs).toBe(3500);
  });
});
