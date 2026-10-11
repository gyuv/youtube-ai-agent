/**
 * Narration voices, safe to import from client components (no Node or network code).
 * Plain names are free edge-tts voices; "elevenlabs:<voiceId>" uses ElevenLabs (needs ELEVENLABS_API_KEY);
 * "gemini:<Name>" uses Gemini text-to-speech (the same voices Google Flow uses; needs GEMINI_API_KEY).
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
  { id: "ta-IN-PallaviNeural", label: "Pallavi (Tamil, female)" },
  { id: "ta-IN-ValluvarNeural", label: "Valluvar (Tamil, male)" },
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

export const GEMINI_PREFIX = "gemini:";

/** Gemini's prebuilt TTS voices (the set Google Flow narrates with), with Google's own one-word character. */
const GEMINI_VOICE_NAMES = [
  ["Puck", "upbeat"], ["Zephyr", "bright"], ["Charon", "informative"], ["Kore", "firm"], ["Fenrir", "excitable"],
  ["Leda", "youthful"], ["Orus", "firm"], ["Aoede", "breezy"], ["Callirrhoe", "easy-going"], ["Autonoe", "bright"],
  ["Enceladus", "breathy"], ["Iapetus", "clear"], ["Umbriel", "easy-going"], ["Algieba", "smooth"], ["Despina", "smooth"],
  ["Erinome", "clear"], ["Algenib", "gravelly"], ["Rasalgethi", "informative"], ["Laomedeia", "upbeat"], ["Achernar", "soft"],
  ["Alnilam", "firm"], ["Schedar", "even"], ["Gacrux", "mature"], ["Pulcherrima", "forward"], ["Achird", "friendly"],
  ["Zubenelgenubi", "casual"], ["Vindemiatrix", "gentle"], ["Sadachbia", "lively"], ["Sadaltager", "knowledgeable"], ["Sulafat", "warm"],
] as const;
const GEMINI_NAMES = new Set<string>(GEMINI_VOICE_NAMES.map(([name]) => name));

export const GEMINI_VOICES = GEMINI_VOICE_NAMES.map(([name, character]) => ({ id: `${GEMINI_PREFIX}${name}`, label: `${name} (Gemini, ${character})` }));

/** The Gemini voice name for a "gemini:<Name>" voice, or null. */
export function geminiVoiceName(voice: string): string | null {
  if (!voice.startsWith(GEMINI_PREFIX)) return null;
  const name = voice.slice(GEMINI_PREFIX.length);
  return GEMINI_NAMES.has(name) ? name : null;
}

/** Everything the studio's voice pickers suggest. */
export const VOICE_OPTIONS = [...EDGE_VOICES, ...GEMINI_VOICES, ...ELEVENLABS_VOICES];

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
  return VOICE_PATTERN.test(voice) || elevenLabsVoiceId(voice) !== null || geminiVoiceName(voice) !== null;
}

/** A free edge-tts voice per narration language, for when the chosen voice speaks another one. */
const EDGE_VOICE_FOR_LANGUAGE: Record<string, string> = {
  en: DEFAULT_VOICE,
  ta: "ta-IN-PallaviNeural",
  hi: "hi-IN-SwaraNeural",
  te: "te-IN-ShrutiNeural",
  ml: "ml-IN-SobhanaNeural",
  kn: "kn-IN-SapnaNeural",
  bn: "bn-IN-TanishaaNeural",
  mr: "mr-IN-AarohiNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
};

/**
 * An edge-tts voice only speaks its own language: an English voice returns no audio for Tamil
 * text. Gemini and ElevenLabs voices are multilingual and kept; an edge-tts voice for another
 * language is swapped for one that speaks the narration's language (Gemini if none is known).
 */
export function voiceForLanguage(voice: string, language: string | null | undefined): string {
  const lang = (language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (!lang || voice.startsWith(GEMINI_PREFIX) || voice.startsWith(ELEVENLABS_PREFIX)) return voice;
  if (voice.toLowerCase().split("-")[0] === lang) return voice;
  return EDGE_VOICE_FOR_LANGUAGE[lang] ?? `${GEMINI_PREFIX}Kore`;
}
