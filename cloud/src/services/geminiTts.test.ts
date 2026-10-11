import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidVoice } from "@/lib/voices";
import { estimateWordTimings, pcmToWav, synthesizeGemini } from "./geminiTts";
import { synthesizeSpeech } from "./ttsGenerator";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("voices", () => {
  it("accepts only known Gemini voice names", () => {
    expect(isValidVoice("gemini:Charon")).toBe(true);
    expect(isValidVoice("gemini:Nobody")).toBe(false);
    expect(isValidVoice("gemini:../x")).toBe(false);
  });
});

describe("pcmToWav", () => {
  it("writes a valid mono 16-bit header", () => {
    const wav = pcmToWav(Buffer.alloc(48_000), 24_000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(40)).toBe(48_000);
    expect(wav.length).toBe(48_044);
  });
});

describe("estimateWordTimings", () => {
  it("covers the narration in order, longer words getting longer spans", () => {
    const t = estimateWordTimings("A remarkably long word", 2);
    expect(t.map((w) => w.word)).toEqual(["A", "remarkably", "long", "word"]);
    for (let i = 1; i < t.length; i++) expect(t[i].startMs).toBeGreaterThanOrEqual(t[i - 1].endMs - 1);
    expect(t[1].endMs - t[1].startMs).toBeGreaterThan(t[0].endMs - t[0].startMs);
    expect(t.at(-1)!.endMs).toBeLessThanOrEqual(2000);
  });
});

describe("synthesizeGemini", () => {
  it("returns WAV audio with its duration and estimated captions", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    const fetchMock = vi.fn(async () =>
      Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.alloc(72_000).toString("base64") } }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await synthesizeSpeech("Hello there friends", { voice: "gemini:Puck" });
    expect(result).toMatchObject({ contentType: "audio/wav", durationSeconds: 1.5, voice: "gemini:Puck" });
    expect(result.wordTimings).toHaveLength(3);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
  });

  it("explains a free-tier limit", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "quota" } }, { status: 429 })));
    await expect(synthesizeGemini("Hi", "Puck", "gemini:Puck")).rejects.toThrow(/free-tier limit/);
  });
});
