import { optionalEnv, requireEnv } from "@/lib/env";
import { PipelineError, errorMessage } from "@/lib/errors";
import type { SpeechResult, WordTiming } from "./ttsGenerator";

/**
 * Gemini text-to-speech: the 30 voices Google Flow narrates with, on the free AI Studio tier, using
 * the GEMINI_API_KEY the studio already has. It runs in a Vercel function: no FFmpeg, because the
 * raw 16-bit PCM it returns only needs a WAV header.
 *
 * Gemini returns no word timings, so captions get estimated ones: the narration's length spread
 * over its words in proportion to their length. Close enough for word-by-word captions.
 */

const MODEL = () => optionalEnv("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts");

/** Wrap mono 16-bit little-endian PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Spread the duration over the words by character count, with a short lead-in and tail. */
export function estimateWordTimings(text: string, durationSeconds: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationSeconds <= 0) return [];
  const totalMs = durationSeconds * 1000;
  const lead = Math.min(150, totalMs * 0.03);
  const usable = Math.max(0, totalMs - lead * 2);
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  let cursor = lead;
  return words.map((word, i) => {
    const span = (usable * weights[i]) / sum;
    const timing = { word, startMs: Math.round(cursor), endMs: Math.round(cursor + span) };
    cursor += span;
    return timing;
  });
}

interface TtsResponse {
  error?: { message?: string };
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
}

export async function synthesizeGemini(text: string, voiceName: string, voice: string, timeoutMs = 90_000): Promise<SpeechResult> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
      method: "POST",
      // The key goes in a header, never the URL, so it can't end up in logs.
      headers: { "content-type": "application/json", "x-goog-api-key": requireEnv("GEMINI_API_KEY") },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("PROVIDER", `Gemini TTS request failed: ${errorMessage(error)}`, { cause: error });
  }
  const body = (await res.json().catch(() => ({}))) as TtsResponse;
  if (!res.ok) {
    const hint = res.status === 429 ? " (free-tier limit reached; try again later or pick an Edge voice)" : "";
    throw new PipelineError("PROVIDER", `Gemini TTS returned ${res.status}${hint}: ${body.error?.message?.slice(0, 200) ?? "no detail"}`);
  }
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new PipelineError("PROVIDER", "Gemini TTS returned no audio for this line.");

  const sampleRate = Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
  const pcm = Buffer.from(part.inlineData.data, "base64");
  const durationSeconds = Math.round((pcm.length / (sampleRate * 2)) * 100) / 100;
  return { audio: pcmToWav(pcm, sampleRate), contentType: "audio/wav", durationSeconds, wordTimings: estimateWordTimings(text, durationSeconds), voice };
}
