import { Composition, continueRender, delayRender, type CalculateMetadataFunction } from "remotion";
import montserratLatin800 from "@fontsource/montserrat/files/montserrat-latin-800-normal.woff2";
import devanagari700 from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2";
import { CAPTION_FONT_FAMILY, LumenVideo } from "./LumenVideo";
import { COMPOSITION_ID, FPS, dimensionsFor, totalFrames, type LumenVideoProps } from "./timeline";

// Fonts ship inside the bundle (from npm), so renders never depend on a font CDN.
const fontsReady = delayRender("Loading caption fonts");
Promise.all([
  new FontFace(CAPTION_FONT_FAMILY, `url(${montserratLatin800}) format("woff2")`, { weight: "800" }).load(),
  new FontFace("Noto Sans Devanagari", `url(${devanagari700}) format("woff2")`, { weight: "700" }).load(),
])
  .then((faces) => faces.forEach((face) => document.fonts.add(face)))
  .catch((error) => console.warn("Caption fonts failed to load; falling back to system fonts", error))
  .finally(() => continueRender(fontsReady));

const calculateMetadata: CalculateMetadataFunction<LumenVideoProps> = ({ props }) => ({
  ...dimensionsFor(props.format),
  durationInFrames: totalFrames(props.scenes),
  fps: FPS,
});

/** Placeholder props for `npx remotion studio`; real renders always pass inputProps. */
const PREVIEW_PROPS: LumenVideoProps = {
  format: "SHORT",
  captions: true,
  scenes: [],
};

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={LumenVideo}
      defaultProps={PREVIEW_PROPS}
      calculateMetadata={calculateMetadata}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={FPS}
    />
  );
}
