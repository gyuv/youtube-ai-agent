/**
 * Timeline maths shared by the Remotion composition, the render worker and (later) the
 * studio's <Player> preview. Keep this file free of React, Node and app imports.
 */

export const COMPOSITION_ID = "LumenVideo";
export const FPS = 30;
/** Breathing room after each narration line so cuts don't feel clipped. */
export const SCENE_TAIL_SECONDS = 0.25;

export type VideoFormat = "SHORT" | "LONG_FORM";

export type CaptionWord = {
  word: string;
  startMs: number;
  endMs: number;
};

export type VideoScene = {
  /** Absolute URL or a file name inside the bundle's public dir. Null only in studio previews. */
  audioSrc: string | null;
  imageSrc: string | null;
  videoSrc: string | null;
  /** Length of the B-roll clip, so short clips can loop. Unknown in previews. */
  videoDurationSeconds: number | null;
  durationSeconds: number;
  words: CaptionWord[];
};

export type LumenVideoProps = {
  format: VideoFormat;
  scenes: VideoScene[];
  captions: boolean;
};

export function dimensionsFor(format: VideoFormat): { width: number; height: number } {
  return format === "SHORT" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

export function sceneFrames(durationSeconds: number): number {
  return Math.max(1, Math.ceil((durationSeconds + SCENE_TAIL_SECONDS) * FPS));
}

/** Where each scene sits on the timeline, in frames. */
export function sceneSlots(scenes: Pick<VideoScene, "durationSeconds">[]): Array<{ from: number; durationInFrames: number }> {
  const slots: Array<{ from: number; durationInFrames: number }> = [];
  for (const scene of scenes) {
    const previous = slots.at(-1);
    slots.push({ from: previous ? previous.from + previous.durationInFrames : 0, durationInFrames: sceneFrames(scene.durationSeconds) });
  }
  return slots;
}

export function totalFrames(scenes: Pick<VideoScene, "durationSeconds">[]): number {
  return Math.max(1, scenes.reduce((sum, scene) => sum + sceneFrames(scene.durationSeconds), 0));
}

export type CaptionPage = {
  startMs: number;
  endMs: number;
  words: CaptionWord[];
};

/**
 * Group word timings into short on-screen pages: at most `maxWords` words, breaking early at
 * sentence ends and pauses. A page lingers up to 400ms after its last word (never overlapping
 * the next page), which avoids flicker between quick pages.
 */
export function paginateCaptions(words: CaptionWord[], maxWords: number): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    pages.push({ startMs: current[0].startMs, endMs: current[current.length - 1].endMs, words: current });
    current = [];
  };

  words.forEach((word, i) => {
    const previous = words[i - 1];
    if (previous && word.startMs - previous.endMs > 600) flush();
    current.push(word);
    if (current.length >= maxWords || /[.!?।]$/.test(word.word)) flush();
  });
  flush();

  return pages.map((page, i) => ({
    ...page,
    endMs: Math.max(page.endMs, Math.min(pages[i + 1]?.startMs ?? page.endMs + 400, page.endMs + 400)),
  }));
}
