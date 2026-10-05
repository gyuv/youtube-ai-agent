import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("./youtube", () => ({ getChannelAccessToken: vi.fn() }));

const { fetchCaptionTracks, parseIsoDuration, parseYouTubeUrl, pickTrack, timedTextToPlain, transcribeWithGemini } = await import("./videoResearch");

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

describe("fetchCaptionTracks", () => {
  afterEach(() => vi.unstubAllGlobals());
  const bot = { playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" } };
  const ok = { playabilityStatus: { status: "OK" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "u", languageCode: "en" }] } } };

  it("moves on to the next player client when one is bot-checked", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(bot)).mockResolvedValueOnce(Response.json(ok));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCaptionTracks("dQw4w9WgXcQ")).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).context.client.clientName).toBe("IOS");
  });

  it("reports BLOCKED when every client is bot-checked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(bot)));
    await expect(fetchCaptionTracks("dQw4w9WgXcQ")).rejects.toMatchObject({ reason: "BLOCKED" });
  });

  it("stops at a real answer like disabled captions", async () => {
    const fetch = vi.fn(async () => Response.json({ playabilityStatus: { status: "OK" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCaptionTracks("dQw4w9WgXcQ")).rejects.toMatchObject({ reason: "DISABLED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("transcribeWithGemini", () => {
  it("sends the YouTube link to Gemini and reads the JSON transcript", async () => {
    const generateContent = vi.fn(async () => ({ text: '{"language":"hi","text":"  namaste   duniya "}' }));
    const out = await transcribeWithGemini("dQw4w9WgXcQ", "hi", { models: { generateContent } } as never);
    expect(out).toEqual({ language: "hi", text: "namaste duniya" });
    const req = (generateContent.mock.calls[0] as unknown as [{ contents: Array<{ parts: Array<{ fileData?: { fileUri: string }; text?: string }> }> }])[0];
    expect(req.contents[0].parts[0].fileData?.fileUri).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(req.contents[0].parts[1].text).toMatch(/Hindi/);
  });

  it("fails clearly when every model fails", async () => {
    const generateContent = vi.fn(async () => {
      throw new Error("video too long");
    });
    await expect(transcribeWithGemini("dQw4w9WgXcQ", "", { models: { generateContent } } as never)).rejects.toThrow(/video too long/);
  });
});
