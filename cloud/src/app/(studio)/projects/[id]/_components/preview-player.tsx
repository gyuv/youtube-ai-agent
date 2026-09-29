"use client";

import { Player } from "@remotion/player";
import { Film } from "lucide-react";
import { useMemo } from "react";
import { LumenVideo } from "@video/LumenVideo";
import { FPS, dimensionsFor, totalFrames, type LumenVideoProps, type VideoFormat } from "@video/timeline";
import type { StudioScene } from "./types";

/**
 * Plays the exact composition the cloud renderer uses, straight from the stored asset URLs,
 * so operators can review the cut before spending a GitHub Actions run on it.
 */
export function PreviewPlayer({ format, scenes }: { format: VideoFormat; scenes: StudioScene[] }) {
  const inputProps = useMemo<LumenVideoProps>(
    () => ({
      format,
      captions: true,
      scenes: scenes.map((s) => ({
        audioSrc: s.voiceAudioUrl,
        imageSrc: s.imageUrl,
        videoSrc: s.videoClipUrl,
        videoDurationSeconds: null,
        durationSeconds: s.durationSeconds,
        words: s.words,
      })),
    }),
    [format, scenes],
  );
  const { width, height } = dimensionsFor(format);

  if (scenes.length === 0) {
    return (
      <div className="grid aspect-video place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
        <div className="grid justify-items-center gap-2">
          <Film className="size-5" />
          The preview appears once the script is written
        </div>
      </div>
    );
  }

  return (
    // Explicit width: auto margins inside a grid cell would otherwise shrink the player to nothing.
    <div className="w-full justify-self-center overflow-hidden rounded-xl border bg-black" style={{ maxWidth: format === "SHORT" ? "calc(62vh * 9 / 16)" : undefined }}>
      <Player
        component={LumenVideo}
        inputProps={inputProps}
        durationInFrames={totalFrames(inputProps.scenes)}
        compositionWidth={width}
        compositionHeight={height}
        fps={FPS}
        controls
        clickToPlay
        style={{ width: "100%", aspectRatio: `${width} / ${height}` }}
        acknowledgeRemotionLicense
      />
    </div>
  );
}
