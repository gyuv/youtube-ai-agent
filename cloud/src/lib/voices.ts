/**
 * Narration voices, safe to import from client components (no Node or network code).
 * Plain names are free edge-tts voices; "elevenlabs:<voiceId>" uses ElevenLabs (needs ELEVENLABS_API_KEY).
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

export const ELEVENLABS_PREFIX = "elevenlabs:";

/** ElevenLabs premade voices. Any voice ID from your ElevenLabs voice library also works. */
export const ELEVENLABS_VOICES = [
  { id: "elevenlabs:pMsXgKOvD5AuFtCeeBhE", label: "Gigi (ElevenLabs, female)" },
  { id: "elevenlabs:AZnzlk1XvdvUeBnXmlld", label: "Domi (ElevenLabs, female)" },
] as const;

/** Everything the studio's voice pickers suggest. */
export const VOICE_OPTIONS = [...EDGE_VOICES, ...ELEVENLABS_VOICES];

// ElevenLabs voice IDs travel in the API URL path, so they must be strictly shaped too.
const ELEVENLABS_ID_PATTERN = /^[A-Za-z0-9]{10,40}$/;

/** The ElevenLabs voice ID for an "elevenlabs:<id>" voice, or null for an edge-tts voice. */
export function elevenLabsVoiceId(voice: string): string | null {
  if (!voice.startsWith(ELEVENLABS_PREFIX)) return null;
  const id = voice.slice(ELEVENLABS_PREFIX.length);
  return ELEVENLABS_ID_PATTERN.test(id) ? id : null;
}

// Interpolated into SSML attributes by msedge-tts, so it must be strictly shaped.
const VOICE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)+Neural$/;

export function isValidVoice(voice: string): boolean {
  return VOICE_PATTERN.test(voice) || elevenLabsVoiceId(voice) !== null;
}
