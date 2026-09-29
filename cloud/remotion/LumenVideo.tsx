import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FPS, paginateCaptions, sceneSlots, type LumenVideoProps, type VideoFormat, type VideoScene } from "./timeline";

/** Font family registered by Root.tsx for renders (and by the studio for previews). */
export const CAPTION_FONT_FAMILY = "LumenCaption";

const resolveSrc = (src: string) => (/^(https?:|data:|blob:)/.test(src) ? src : staticFile(src));

const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

/** Slow push-in on stills; alternating scenes drift left/right so cuts don't feel repetitive. */
function KenBurns({ src, index }: { src: string; index: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp" });
  const scale = 1.04 + progress * 0.1;
  const drift = (index % 2 === 0 ? 1 : -1) * progress * 2.5;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={resolveSrc(src)} style={{ ...fill, transform: `scale(${scale}) translateX(${drift}%)` }} />
    </AbsoluteFill>
  );
}

function BRoll({ scene }: { scene: VideoScene & { videoSrc: string } }) {
  const { durationInFrames } = useVideoConfig();
  const clip = <OffthreadVideo src={resolveSrc(scene.videoSrc)} muted style={fill} />;
  const clipFrames = scene.videoDurationSeconds ? Math.floor(scene.videoDurationSeconds * FPS) : null;
  // Loop clips shorter than the narration instead of freezing on their last frame.
  return clipFrames && clipFrames < durationInFrames ? <Loop durationInFrames={clipFrames}>{clip}</Loop> : clip;
}

const CAPTION_STYLE: Record<VideoFormat, { maxWords: number; box: CSSProperties; text: CSSProperties }> = {
  SHORT: {
    maxWords: 3,
    box: { justifyContent: "flex-end", alignItems: "center", paddingBottom: "30%", paddingInline: 60 },
    text: {
      fontSize: 92,
      lineHeight: 1.1,
      textTransform: "uppercase",
      textAlign: "center",
      WebkitTextStroke: "14px black",
      paintOrder: "stroke fill",
    },
  },
  LONG_FORM: {
    maxWords: 7,
    box: { justifyContent: "flex-end", alignItems: "center", paddingBottom: 70, paddingInline: 160 },
    text: {
      fontSize: 54,
      lineHeight: 1.25,
      textAlign: "center",
      background: "rgba(0,0,0,0.62)",
      borderRadius: 14,
      padding: "10px 24px",
    },
  },
};

function Captions({ scene, format }: { scene: VideoScene; format: VideoFormat }) {
  const frame = useCurrentFrame();
  const style = CAPTION_STYLE[format];
  const nowMs = (frame / FPS) * 1000;
  const page = paginateCaptions(scene.words, style.maxWords).find((p) => nowMs >= p.startMs && nowMs < p.endMs);
  if (!page) return null;

  return (
    <AbsoluteFill style={style.box}>
      <div style={{ ...style.text, fontFamily: `${CAPTION_FONT_FAMILY}, "Noto Sans Devanagari", sans-serif`, fontWeight: 800, color: "white" }}>
        {page.words.map((word, i) => (
          <span key={`${word.startMs}-${i}`} style={{ color: nowMs >= word.startMs && nowMs < word.endMs ? "#FFD60A" : "white" }}>
            {word.word}
            {i < page.words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function SceneView({ scene, index, format, captions }: { scene: VideoScene; index: number; format: VideoFormat; captions: boolean }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {scene.videoSrc ? (
        <BRoll scene={{ ...scene, videoSrc: scene.videoSrc }} />
      ) : scene.imageSrc ? (
        <KenBurns src={scene.imageSrc} index={index} />
      ) : null}
      <Audio src={resolveSrc(scene.audioSrc)} />
      {captions && scene.words.length > 0 ? <Captions scene={scene} format={format} /> : null}
    </AbsoluteFill>
  );
}

export function LumenVideo({ format, scenes, captions }: LumenVideoProps) {
  const slots = sceneSlots(scenes);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {scenes.map((scene, index) => (
        <Sequence key={index} from={slots[index].from} durationInFrames={slots[index].durationInFrames} premountFor={FPS}>
          <SceneView scene={scene} index={index} format={format} captions={captions} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
