import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("./youtube", () => ({ getChannelAccessToken: vi.fn() }));

const { parseIsoDuration, parseYouTubeUrl, pickTrack, timedTextToPlain } = await import("./videoResearch");

describe("parseYouTubeUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ?si=x", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk", "dQw4w9WgXcQ"],
  ])("reads a video id from %s", (url, id) => {
    expect(parseYouTubeUrl(url)).toEqual({ kind: "video", videoId: id });
  });

  it("reads a playlist", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/playlist?list=PL1234567890abc")).toEqual({ kind: "playlist", playlistId: "PL1234567890abc" });
  });

  it("rejects other sites", () => {
    expect(() => parseYouTubeUrl("https://vimeo.com/123")).toThrow(/YouTube/);
  });
});

describe("parseIsoDuration", () => {
  it("handles hours, minutes and seconds", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration(undefined)).toBeNull();
  });
});

describe("pickTrack", () => {
  const tracks = [
    { baseUrl: "a", languageCode: "en", kind: "asr", isTranslatable: true },
    { baseUrl: "b", languageCode: "en-GB", isTranslatable: true },
    { baseUrl: "c", languageCode: "pt-BR", isTranslatable: true },
  ];
  it("prefers manual English when automatic", () => expect(pickTrack(tracks, "").track.baseUrl).toBe("b"));
  it("matches the base language", () => expect(pickTrack(tracks, "pt")).toEqual({ track: tracks[2], translateTo: null }));
  it("translates when missing", () => expect(pickTrack(tracks, "hi")).toEqual({ track: tracks[1], translateTo: "hi" }));
  it("fails when nothing is translatable", () => {
    expect(() => pickTrack([{ baseUrl: "x", languageCode: "en", isTranslatable: false }], "hi")).toThrow(/hi/);
  });
});

describe("timedTextToPlain", () => {
  it("reads classic and srv3 captions", () => {
    expect(timedTextToPlain('<transcript><text start="0" dur="1">It&amp;#39;s  here</text><text start="1">[Music]</text><text>ok &amp; done</text></transcript>')).toBe("It's here ok & done");
    expect(timedTextToPlain('<timedtext><body><p t="0"><s>Hello</s><s> world</s></p></body></timedtext>')).toBe("Hello world");
  });
});
