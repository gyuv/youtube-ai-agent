import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("./youtube", () => ({ getChannelAccessToken: vi.fn() }));
const research = vi.hoisted(() => ({ getTimedTranscript: vi.fn() }));
vi.mock("./videoResearch", async (orig) => ({ ...(await orig<typeof import("./videoResearch")>()), getTimedTranscript: research.getTimedTranscript }));

const { captionsBetween, findMoments, normalizeMoments, transcriptForPrompt } = await import("./clipFinder");
const { TranscriptError, timedTextToSegments } = await import("./videoResearch");

const segs = Array.from({ length: 60 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `line ${i} has some words here` }));
const raw = (start: number, end: number, score: number) => ({ start, end, title: `T${start}`, hook: "h", reason: "r", score });
const opts = { segments: segs, duration: 300, count: 5, minSeconds: 15, maxSeconds: 60 };

describe("normalizeMoments", () => {
  it("snaps to caption boundaries and attaches the captions", () => {
    const [m] = normalizeMoments([raw(12, 41, 90)], opts);
    expect([m.start, m.end]).toEqual([10, 45]);
    expect(m.captions[0].start).toBe(10);
    expect(m.captions.at(-1)!.end).toBeCloseTo(45);
  });

  it("drops overlaps in favour of the higher score and keeps the count", () => {
    const out = normalizeMoments([raw(10, 40, 50), raw(20, 50, 90), raw(100, 130, 70), raw(200, 230, 60)], { ...opts, count: 2 });
    expect(out.map((m) => m.title)).toEqual(["T20", "T100"]);
  });

  it("stretches short picks and trims long ones to the limits", () => {
    const [short] = normalizeMoments([raw(100, 103, 80)], opts);
    expect(short.end - short.start).toBeGreaterThanOrEqual(15);
    const [long] = normalizeMoments([raw(0, 200, 80)], opts);
    expect(long.end - long.start).toBeLessThanOrEqual(60);
  });

  it("keeps clips inside the video", () => {
    const [m] = normalizeMoments([raw(290, 400, 80)], { ...opts, segments: [] });
    expect(m.end).toBe(300);
    expect(m.end - m.start).toBeGreaterThanOrEqual(15);
  });
});

it("captionsBetween splits lines into short timed pieces", () => {
  const c = captionsBetween([{ start: 0, end: 8, text: "one two three four five six seven eight" }], 0, 8);
  expect(c).toEqual([
    { start: 0, end: 6, text: "one two three four five six" },
    { start: 6, end: 8, text: "seven eight" },
  ]);
});

it("transcriptForPrompt merges lines into ~10 s chunks with times", () => {
  const text = transcriptForPrompt(segs.slice(0, 4));
  expect(text.split("\n")).toEqual(["[0.0] line 0 has some words here line 1 has some words here", "[10.0] line 2 has some words here line 3 has some words here"]);
});

it("timedTextToSegments reads classic and srv3 timings", () => {
  expect(timedTextToSegments('<text start="1.5" dur="2">Hi &amp;amp; bye</text><text start="3" dur="1">[Music]</text>')).toEqual([{ start: 1.5, end: 3.5, text: "Hi & bye" }]);
  expect(timedTextToSegments('<p t="1000" d="4000">a</p><p t="2000" d="1000">b</p>')).toEqual([
    { start: 1, end: 2, text: "a" },
    { start: 2, end: 3, text: "b" },
  ]);
});

describe("findMoments", () => {
  const reply = (moments: object[]) => ({ text: JSON.stringify({ moments }) });

  it("uses the transcript when captions are available", async () => {
    research.getTimedTranscript.mockResolvedValueOnce({ language: "en", segments: segs });
    const generateContent = vi.fn(async () => reply([raw(50, 80, 88)]));
    const out = await findMoments({ videoId: "dQw4w9WgXcQ", title: "Talk", durationSeconds: 300, count: 3, client: { models: { generateContent } } as never });
    expect(out.source).toBe("transcript");
    expect(out.moments[0].captions.length).toBeGreaterThan(0);
    const call = (generateContent.mock.calls[0] as unknown as [{ contents: unknown }])[0];
    expect(String(call.contents)).toContain("[50.0]");
  });

  it("falls back to Gemini watching the video when YouTube blocks the transcript", async () => {
    research.getTimedTranscript.mockRejectedValueOnce(new TranscriptError("BLOCKED", "bot"));
    const generateContent = vi.fn(async () => reply([{ ...raw(50, 80, 88), focusX: 0.3, captions: [{ start: 51, end: 53, text: "hi" }] }]));
    const out = await findMoments({ videoId: "dQw4w9WgXcQ", title: "Talk", durationSeconds: 300, count: 3, client: { models: { generateContent } } as never });
    expect(out.source).toBe("video");
    expect(out.moments[0]).toMatchObject({ focusX: 0.3, captions: [{ text: "hi" }] });
    const call = (generateContent.mock.calls[0] as unknown as [{ contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }> }])[0];
    expect(call.contents[0].parts[0].fileData?.fileUri).toContain("dQw4w9WgXcQ");
  });
});
