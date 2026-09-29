import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Readable } from "node:stream";
import { PipelineError, errorMessage } from "@/lib/errors";

/**
 * Free neural voiceover through Microsoft Edge's Read Aloud service (the engine behind the
 * Python `edge-tts` CLI), via the pure-Node `msedge-tts` port so it runs inside a Vercel
 * function or a GitHub Actions runner with no Python and no API key.
 */

export const DEFAULT_VOICE = "en-US-AriaNeural";

/** Curated voices for the studio picker. Any valid edge-tts ShortName also works. */
export const EDGE_VOICES = [
  { id: "en-US-AriaNeural", label: "Aria (US, female)" },
  { id: "en-US-AndrewNeural", label: "Andrew (US, male)" },
  { id: "en-US-EmmaNeural", label: "Emma (US, female)" },
  { id: "en-US-BrianNeural", label: "Brian (US, male)" },
  { id: "en-US-ChristopherNeural", label: "Christopher (US, male, documentary)" },
  { id: "en-US-JennyNeural", label: "Jenny (US, female)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK, female)" },
  { id: "en-GB-RyanNeural", label: "Ryan (UK, male)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (Australia, female)" },
  { id: "en-IN-NeerjaNeural", label: "Neerja (India, female)" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat (India, male)" },
  { id: "hi-IN-SwaraNeural", label: "Swara (Hindi, female)" },
  { id: "hi-IN-MadhurNeural", label: "Madhur (Hindi, male)" },
  { id: "es-ES-ElviraNeural", label: "Elvira (Spanish, female)" },
  { id: "de-DE-ConradNeural", label: "Conrad (German, male)" },
  { id: "fr-FR-DeniseNeural", label: "Denise (French, female)" },
] as const;

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SpeechResult {
  audio: Buffer;
  contentType: "audio/mpeg";
  durationSeconds: number;
  wordTimings: WordTiming[];
  voice: string;
}

export interface SpeechOptions {
  voice?: string;
  /** Relative speaking rate, e.g. "+10%" or "-5%". */
  rate?: string;
  /** Relative pitch, e.g. "+2Hz" or "-3Hz". */
  pitch?: string;
  timeoutMs?: number;
}

export type TtsEngine = Pick<MsEdgeTTS, "setMetadata" | "toStream" | "close">;

/** One request stays well inside the service's per-message limit; scenes are far shorter. */
export const MAX_NARRATION_CHARS = 3000;
/** AUDIO_24KHZ_96KBITRATE_MONO_MP3 is constant bitrate, so byte length gives the duration. */
const MP3_BITS_PER_SECOND = 96_000;
const TICKS_PER_MS = 10_000; // edge-tts offsets are in 100-nanosecond ticks

// These values are interpolated into SSML attributes by msedge-tts, so they must be strictly shaped.
const VOICE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)+Neural$/;
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
const PITCH_PATTERN = /^[+-]\d{1,3}Hz$/;

export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function mp3DurationSeconds(byteLength: number): number {
  return Math.round(((byteLength * 8) / MP3_BITS_PER_SECOND) * 100) / 100;
}

interface EdgeMetadataEntry {
  Type?: string;
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string; BoundaryType?: string } };
}

/** Turn edge-tts audio.metadata messages into caption-ready word timings. */
export function parseWordBoundaries(chunks: Array<Buffer | string>): WordTiming[] {
  const words: WordTiming[] = [];
  for (const chunk of chunks) {
    let parsed: { Metadata?: EdgeMetadataEntry[] };
    try {
      parsed = JSON.parse(chunk.toString());
    } catch {
      continue;
    }
    for (const entry of parsed.Metadata ?? []) {
      const data = entry.Data;
      const text = data?.text?.Text?.trim();
      const boundary = data?.text?.BoundaryType ?? "WordBoundary";
      if (entry.Type !== "WordBoundary" || boundary !== "WordBoundary" || !text) continue;
      if (typeof data?.Offset !== "number" || typeof data.Duration !== "number") continue;
      const startMs = Math.round(data.Offset / TICKS_PER_MS);
      words.push({ word: text, startMs, endMs: startMs + Math.round(data.Duration / TICKS_PER_MS) });
    }
  }
  return words.sort((a, b) => a.startMs - b.startMs);
}

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let ended = false;
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.once("end", () => {
      ended = true;
      resolve(Buffer.concat(chunks));
    });
    stream.once("error", reject);
    stream.once("close", () => {
      if (!ended) reject(new Error("connection closed before synthesis finished"));
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function synthesizeSpeech(
  text: string,
  options: SpeechOptions = {},
  deps: { createEngine?: () => TtsEngine } = {},
): Promise<SpeechResult> {
  const narration = text.replace(/\s+/g, " ").trim();
  const voice = options.voice?.trim() || DEFAULT_VOICE;
  const rate = options.rate ?? "+0%";
  const pitch = options.pitch ?? "+0Hz";

  if (!narration) throw new PipelineError("CONFLICT", "Narration text is empty.");
  if (narration.length > MAX_NARRATION_CHARS) {
    throw new PipelineError(
      "CONFLICT",
      `Narration is ${narration.length} characters; split the scene (max ${MAX_NARRATION_CHARS}).`,
    );
  }
  if (!VOICE_PATTERN.test(voice)) throw new PipelineError("CONFLICT", `"${voice}" is not a valid edge-tts voice name.`);
  if (!RATE_PATTERN.test(rate)) throw new PipelineError("CONFLICT", `Rate must look like "+10%", got "${rate}".`);
  if (!PITCH_PATTERN.test(pitch)) throw new PipelineError("CONFLICT", `Pitch must look like "+2Hz", got "${pitch}".`);

  const engine = deps.createEngine?.() ?? new MsEdgeTTS();
  try {
    await engine.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
    const { audioStream, metadataStream } = engine.toStream(escapeSsml(narration), { rate, pitch });

    const metadataChunks: Buffer[] = [];
    metadataStream?.on("data", (chunk: Buffer) => metadataChunks.push(Buffer.from(chunk)));
    metadataStream?.on("error", () => {}); // destroyed alongside the audio stream; timings are best-effort

    const audio = await withTimeout(collect(audioStream), options.timeoutMs ?? 45_000, "edge-tts timed out");
    if (audio.length === 0) throw new Error("no audio returned (unknown voice or throttled)");

    const wordTimings = parseWordBoundaries(metadataChunks);
    const lastWordEnd = (wordTimings.at(-1)?.endMs ?? 0) / 1000;
    return {
      audio,
      contentType: "audio/mpeg",
      durationSeconds: Math.max(mp3DurationSeconds(audio.length), lastWordEnd),
      wordTimings,
      voice,
    };
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `edge-tts failed for voice ${voice}: ${errorMessage(error)}`, { cause: error });
  } finally {
    engine.close();
  }
}
