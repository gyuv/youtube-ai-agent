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
import { FPS, INTRO_FRAMES, OUTRO_FRAMES, paginateCaptions, sceneSlots, type LumenVideoProps, type VideoBrand, type VideoFormat, type VideoScene } from "./timeline";

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
      <div style={{ ...style.text, fontFamily: `${CAPTION_FONT_FAMILY}, "Noto Sans Tamil", "Noto Sans Devanagari", sans-serif`, fontWeight: 800, color: "white" }}>
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
      {scene.audioSrc ? <Audio src={resolveSrc(scene.audioSrc)} /> : null}
      {captions && scene.words.length > 0 ? <Captions scene={scene} format={format} /> : null}
    </AbsoluteFill>
  );
}

const brandFont = `${CAPTION_FONT_FAMILY}, "Noto Sans Tamil", "Noto Sans Devanagari", sans-serif`;

function Avatar({ brand, size }: { brand: VideoBrand; size: number }) {
  return brand.avatarSrc ? (
    <Img src={resolveSrc(brand.avatarSrc)} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `${Math.round(size / 18)}px solid white` }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: "50%", background: brand.color, border: `${Math.round(size / 18)}px solid white`, display: "grid", placeItems: "center", fontFamily: brandFont, fontWeight: 800, fontSize: size * 0.42, color: "white" }}>
      {brand.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** 1.5 s opener: the channel's badge pops in over its colour, then the first scene starts. */
function BrandIntro({ brand, format }: { brand: VideoBrand; format: VideoFormat }) {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [0, 10, 16], [0.4, 1.12, 1], { extrapolateRight: "clamp" });
  const fade = interpolate(frame, [INTRO_FRAMES - 8, INTRO_FRAMES], [1, 0], { extrapolateLeft: "clamp" });
  const big = format === "SHORT" ? 1 : 0.8;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, white 0%, ${brand.color} 55%, #ff6b6b 100%)`, opacity: fade, justifyContent: "center", alignItems: "center", gap: 40 * big }}>
      <div style={{ transform: `scale(${pop})` }}>
        <Avatar brand={brand} size={320 * big} />
      </div>
      <div style={{ transform: `scale(${pop})`, fontFamily: brandFont, fontWeight: 800, fontSize: 120 * big, color: "white", WebkitTextStroke: "12px #1d3557", paintOrder: "stroke fill", textAlign: "center" }}>
        {brand.name}
      </div>
    </AbsoluteFill>
  );
}

/** Around every scene: a rounded colour border and the channel badge at the top. */
function BrandFrame({ brand, format }: { brand: VideoBrand; format: VideoFormat }) {
  const edge = format === "SHORT" ? 18 : 14;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ border: `${edge}px solid ${brand.color}`, borderRadius: edge * 3, boxShadow: "inset 0 0 40px rgba(0,0,0,0.35)" }} />
      <div style={{ position: "absolute", top: edge * 3, left: edge * 3, display: "flex", alignItems: "center", gap: 18, padding: "10px 28px 10px 10px", borderRadius: 999, background: "rgba(0,0,0,0.45)" }}>
        <Avatar brand={brand} size={format === "SHORT" ? 96 : 72} />
        <span style={{ fontFamily: brandFont, fontWeight: 800, fontSize: format === "SHORT" ? 46 : 36, color: "white" }}>{brand.name}</span>
      </div>
    </AbsoluteFill>
  );
}

/** 3 s closer: the badge, the name and a pulsing subscribe button. */
function BrandOutro({ brand, format }: { brand: VideoBrand; format: VideoFormat }) {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 12], [80, 0], { extrapolateRight: "clamp" });
  const pulse = 1 + 0.06 * Math.sin((frame / FPS) * Math.PI * 2);
  const big = format === "SHORT" ? 1 : 0.75;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${brand.color}, #ff6b6b)`, justifyContent: "center", alignItems: "center", gap: 44 * big, transform: `translateY(${rise}px)` }}>
      <Avatar brand={brand} size={260 * big} />
      <div style={{ fontFamily: brandFont, fontWeight: 800, fontSize: 96 * big, color: "white", WebkitTextStroke: "10px #1d3557", paintOrder: "stroke fill", textAlign: "center" }}>{brand.name}</div>
      <div style={{ transform: `scale(${pulse})`, background: "#e63946", color: "white", fontFamily: brandFont, fontWeight: 800, fontSize: 72 * big, padding: `${24 * big}px ${64 * big}px`, borderRadius: 999, boxShadow: "0 12px 30px rgba(0,0,0,0.3)" }}>
        SUBSCRIBE
      </div>
      <div style={{ fontFamily: brandFont, fontWeight: 800, fontSize: 48 * big, color: "white", textAlign: "center", paddingInline: 80 }}>{brand.cta}</div>
    </AbsoluteFill>
  );
}

export function LumenVideo({ format, scenes, captions, brand }: LumenVideoProps) {
  const slots = sceneSlots(scenes);
  const offset = brand ? INTRO_FRAMES : 0;
  const bodyEnd = offset + (slots.at(-1) ? slots.at(-1)!.from + slots.at(-1)!.durationInFrames : 0);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {brand ? (
        <Sequence from={0} durationInFrames={INTRO_FRAMES}>
          <BrandIntro brand={brand} format={format} />
        </Sequence>
      ) : null}
      {scenes.map((scene, index) => (
        <Sequence key={index} from={offset + slots[index].from} durationInFrames={slots[index].durationInFrames} premountFor={FPS}>
          <SceneView scene={scene} index={index} format={format} captions={captions} />
          {brand ? <BrandFrame brand={brand} format={format} /> : null}
        </Sequence>
      ))}
      {brand ? (
        <Sequence from={bodyEnd} durationInFrames={OUTRO_FRAMES}>
          <BrandOutro brand={brand} format={format} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
}
