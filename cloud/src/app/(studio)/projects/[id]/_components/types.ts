import type { CaptionWord } from "@video/timeline";

/** Plain, serialisable scene data handed from the studio page to its client components. */
export interface StudioScene {
  id: string;
  sceneIndex: number;
  kind: "Hook" | "Call to action" | null;
  heading: string | null;
  narrationText: string;
  voiceAudioUrl: string | null;
  words: CaptionWord[];
  visualPrompt: string | null;
  stockQuery: string | null;
  imageUrl: string | null;
  videoClipUrl: string | null;
  visualSource: "POLLINATIONS" | "PEXELS" | "UPLOAD";
  durationSeconds: number;
  locked: boolean;
  ready: boolean;
  updatedAt: string;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
