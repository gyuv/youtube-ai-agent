import { describe, expect, it } from "vitest";
import { voiceForLanguage } from "./voices";

describe("voiceForLanguage", () => {
  it("swaps an English edge-tts voice for one that speaks the channel's language", () => {
    expect(voiceForLanguage("en-US-AriaNeural", "ta")).toBe("ta-IN-PallaviNeural");
    expect(voiceForLanguage("en-US-AriaNeural", "ta-IN")).toBe("ta-IN-PallaviNeural");
    expect(voiceForLanguage("en-US-AriaNeural", "pt")).toBe("gemini:Kore");
  });
  it("keeps matching and multilingual voices", () => {
    expect(voiceForLanguage("ta-IN-ValluvarNeural", "ta")).toBe("ta-IN-ValluvarNeural");
    expect(voiceForLanguage("en-IN-NeerjaNeural", "en")).toBe("en-IN-NeerjaNeural");
    expect(voiceForLanguage("gemini:Leda", "ta")).toBe("gemini:Leda");
    expect(voiceForLanguage("elevenlabs:abc", "ta")).toBe("elevenlabs:abc");
  });
});
