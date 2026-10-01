import { optionalEnv, requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";
import type { SpeechResult, WordTiming } from "./ttsGenerator";

/**
 * ElevenLabs voiceover (paid voices, free tier ~10k characters/month). The with-timestamps
 * endpoint returns per-character timings, which we group into words for burned-in captions.
 */

export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Group character timings into caption words (split on whitespace). */
export function alignmentToWords(alignment: ElevenLabsAlignment | null | undefined): WordTiming[] {
  if (!alignment) return [];
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words: WordTiming[] = [];
  let word = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (word.trim()) words.push({ word, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
    word = "";
  };
  characters.forEach((char, i) => {
    if (/\s/.test(char)) return flush();
    if (!word) start = starts[i] ?? end;
    word += char;
    end = ends[i] ?? end;
  });
  flush();
  return words;
}

export async function synthesizeElevenLabs(text: string, voiceId: string, voice: string, timeoutMs = 60_000): Promise<SpeechResult> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
      // multilingual_v2 also reads Hindi and other languages with the same voice.
      body: JSON.stringify({ text, model_id: optionalEnv("ELEVENLABS_MODEL", "eleven_multilingual_v2") }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `ElevenLabs request failed: ${errorMessage(error)}`, { cause: error });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 401 ? " (check ELEVENLABS_API_KEY)" : res.status === 429 ? " (rate limited or out of credits)" : res.status === 404 ? " (unknown voice ID)" : "";
    throw new PipelineError("PROVIDER", `ElevenLabs returned ${res.status}${hint}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { audio_base64?: string; alignment?: ElevenLabsAlignment | null };
  const audio = Buffer.from(data.audio_base64 ?? "", "base64");
  if (audio.length === 0) throw new PipelineError("PROVIDER", "ElevenLabs returned no audio.");
  const wordTimings = alignmentToWords(data.alignment);
  const lastEnd = data.alignment?.character_end_times_seconds.at(-1) ?? 0;
  const cbrSeconds = (audio.length * 8) / 128_000; // mp3_44100_128 is constant bitrate
  return {
    audio,
    contentType: "audio/mpeg",
    durationSeconds: Math.round(Math.max(lastEnd, cbrSeconds) * 100) / 100,
    wordTimings,
    voice,
  };
}
