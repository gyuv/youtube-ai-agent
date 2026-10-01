import { afterEach, describe, expect, it, vi } from "vitest";
import { alignmentToWords } from "./elevenLabsTts";
import { synthesizeSpeech } from "./ttsGenerator";
import { elevenLabsVoiceId, isValidVoice } from "@/lib/voices";

const alignment = {
  characters: [..."Hi there"],
  character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
  character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ElevenLabs voices", () => {
  it("accepts elevenlabs:<id> next to edge-tts names", () => {
    expect(isValidVoice("elevenlabs:pMsXgKOvD5AuFtCeeBhE")).toBe(true);
    expect(elevenLabsVoiceId("elevenlabs:AZnzlk1XvdvUeBnXmlld")).toBe("AZnzlk1XvdvUeBnXmlld");
    expect(isValidVoice("elevenlabs:../../v1/user")).toBe(false);
    expect(isValidVoice("en-IN-NeerjaNeural")).toBe(true);
  });

  it("groups character timings into words", () => {
    expect(alignmentToWords(alignment)).toEqual([
      { word: "Hi", startMs: 0, endMs: 200 },
      { word: "there", startMs: 300, endMs: 800 },
    ]);
  });

  it("synthesizes through the with-timestamps endpoint", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "key");
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ audio_base64: Buffer.from("mp3").toString("base64"), alignment }));
    vi.stubGlobal("fetch", fetchMock);
    const speech = await synthesizeSpeech("Hi there", { voice: "elevenlabs:pMsXgKOvD5AuFtCeeBhE" });
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/text-to-speech/pMsXgKOvD5AuFtCeeBhE/with-timestamps");
    expect(speech).toMatchObject({ voice: "elevenlabs:pMsXgKOvD5AuFtCeeBhE", durationSeconds: 0.8 });
    expect(speech.wordTimings).toHaveLength(2);
  });

  it("explains a bad API key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "bad");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    await expect(synthesizeSpeech("Hi", { voice: "elevenlabs:pMsXgKOvD5AuFtCeeBhE" })).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });
});
