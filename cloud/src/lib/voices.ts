/** edge-tts voices, safe to import from client components (no Node or network code). */

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

// Interpolated into SSML attributes by msedge-tts, so it must be strictly shaped.
const VOICE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)+Neural$/;

export function isValidVoice(voice: string): boolean {
  return VOICE_PATTERN.test(voice);
}
