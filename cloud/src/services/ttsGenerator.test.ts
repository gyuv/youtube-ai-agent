import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PipelineError } from "@/lib/errors";
import { escapeSsml, mp3DurationSeconds, parseWordBoundaries, synthesizeSpeech, type TtsEngine } from "./ttsGenerator";

const TICKS_PER_MS = 10_000;

function boundary(text: string, startMs: number, durationMs: number, type = "WordBoundary") {
  return {
    Type: "WordBoundary",
    Data: { Offset: startMs * TICKS_PER_MS, Duration: durationMs * TICKS_PER_MS, text: { Text: text, Length: text.length, BoundaryType: type } },
  };
}

/** A stand-in for MsEdgeTTS that replays canned audio and word-boundary metadata. */
function fakeEngine(options: { audio?: Buffer[]; metadata?: object[]; hang?: boolean } = {}) {
  const calls = { setMetadata: [] as unknown[][], toStream: [] as unknown[][], closed: 0 };
  const engine: TtsEngine = {
    setMetadata: vi.fn(async (...args: unknown[]) => {
      calls.setMetadata.push(args);
    }) as unknown as TtsEngine["setMetadata"],
    toStream: vi.fn((input: string, prosody?: unknown) => {
      calls.toStream.push([input, prosody]);
      const audioStream = new Readable({ read() {} });
      const metadataStream = new Readable({ read() {} });
      if (!options.hang) {
        setImmediate(() => {
          for (const m of options.metadata ?? []) metadataStream.push(Buffer.from(JSON.stringify({ Metadata: [m] })));
          for (const chunk of options.audio ?? []) audioStream.push(chunk);
          audioStream.push(null);
        });
      }
      return { audioStream, metadataStream };
    }) as unknown as TtsEngine["toStream"],
    close: vi.fn(() => {
      calls.closed++;
    }),
  };
  return { engine, calls };
}

describe("escapeSsml", () => {
  it("neutralises markup in narration", () => {
    expect(escapeSsml(`Tom & Jerry's "<break/>" > all`)).toBe("Tom &amp; Jerry&apos;s &quot;&lt;break/&gt;&quot; &gt; all");
  });
});

describe("parseWordBoundaries", () => {
  it("converts 100ns ticks to ms and keeps only spoken words", () => {
    const chunks = [
      JSON.stringify({ Metadata: [boundary("Hello", 100, 400), boundary(",", 500, 50, "PunctuationBoundary")] }),
      JSON.stringify({ Metadata: [boundary("world", 650, 500), { Type: "SessionEnd", Data: { Offset: 2_000_000 } }] }),
      "not json",
    ];
    expect(parseWordBoundaries(chunks)).toEqual([
      { word: "Hello", startMs: 100, endMs: 500 },
      { word: "world", startMs: 650, endMs: 1150 },
    ]);
  });
});

describe("mp3DurationSeconds", () => {
  it("derives duration from the 96 kbps constant bitrate", () => {
    expect(mp3DurationSeconds(12_000)).toBe(1);
    expect(mp3DurationSeconds(30_000)).toBe(2.5);
  });
});

describe("synthesizeSpeech", () => {
  it("sends escaped narration with the chosen voice and returns audio, duration and word timings", async () => {
    const { engine, calls } = fakeEngine({
      audio: [Buffer.alloc(12_000), Buffer.alloc(12_000)], // 2 seconds at 96 kbps
      metadata: [boundary("Cats", 50, 300), boundary("&", 400, 100), boundary("dogs", 600, 500)],
    });
    const result = await synthesizeSpeech("  Cats & dogs  ", { voice: "en-IN-NeerjaNeural", rate: "+10%" }, { createEngine: () => engine });

    expect(calls.setMetadata[0][0]).toBe("en-IN-NeerjaNeural");
    expect(calls.setMetadata[0][2]).toEqual({ wordBoundaryEnabled: true });
    expect(calls.toStream[0]).toEqual(["Cats &amp; dogs", { rate: "+10%", pitch: "+0Hz" }]);
    expect(result.audio.length).toBe(24_000);
    expect(result.durationSeconds).toBe(2);
    expect(result.wordTimings.map((w) => w.word)).toEqual(["Cats", "&", "dogs"]);
    expect(result.voice).toBe("en-IN-NeerjaNeural");
    expect(calls.closed).toBe(1);
  });

  it("uses the last word's end when it runs past the byte-length estimate", async () => {
    const { engine } = fakeEngine({ audio: [Buffer.alloc(12_000)], metadata: [boundary("long", 900, 600)] });
    const result = await synthesizeSpeech("long", {}, { createEngine: () => engine });
    expect(result.durationSeconds).toBe(1.5);
  });

  it.each([
    [{ voice: 'en-US-AriaNeural"><audio src="x' }, /not a valid edge-tts voice/],
    [{ rate: "fast" }, /Rate must look like/],
    [{ pitch: "+2st" }, /Pitch must look like/],
  ])("rejects unsafe SSML attributes %o before connecting", async (options, message) => {
    const createEngine = vi.fn();
    await expect(synthesizeSpeech("hello", options, { createEngine })).rejects.toThrow(message);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized narration", async () => {
    await expect(synthesizeSpeech("   ")).rejects.toThrow(/empty/);
    await expect(synthesizeSpeech("a".repeat(3001))).rejects.toThrow(/split the scene/);
  });

  it("wraps provider failures and always closes the socket", async () => {
    const { engine, calls } = fakeEngine({ audio: [] });
    const error = await synthesizeSpeech("hello", {}, { createEngine: () => engine }).catch((e) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error.code).toBe("PROVIDER");
    expect(error.message).toMatch(/no audio returned/);
    expect(calls.closed).toBe(1);
  });

  it("times out a stalled connection", async () => {
    const { engine, calls } = fakeEngine({ hang: true });
    await expect(synthesizeSpeech("hello", { timeoutMs: 20 }, { createEngine: () => engine })).rejects.toThrow(/timed out/);
    expect(calls.closed).toBe(1);
  });
});
