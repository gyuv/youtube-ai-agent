#!/usr/bin/env python3
"""
google_flow_pipeline.py

Turns a script string (e.g. from the YouTube AI Agent) into a simple,
kid-friendly animated .mp4:

  script -> sentences -> Google Cloud TTS (Neural2) per sentence
         -> combined narration (pydub)
         -> one colourful "kinetic typography" slide per sentence (ffmpeg),
            optionally over a Pexels background photo
         -> final .mp4
  Intermediate assets (script, audio) are uploaded to Google Cloud Storage.

Environment variables:
  GOOGLE_APPLICATION_CREDENTIALS  path to service-account JSON (required)
  PROJECT_ID                      GCP project id (required)
  PEXELS_API_KEY                  optional; enables photo backgrounds
  GCS_BUCKET                      optional; reuse an existing bucket instead of
                                  creating ${PROJECT_ID}-yt-assets-${TIMESTAMP}

Usage:
  python google_flow_pipeline.py --script "Hello friends! Today we learn colours."
  python google_flow_pipeline.py --script-file story.txt --output out.mp4
  echo "Once upon a time..." | python google_flow_pipeline.py

Requires: google-cloud-texttospeech, google-cloud-storage, pydub, ffmpeg on PATH.
Free tier note: Neural2 voices are free up to 1M characters/month; this script
logs the character count so you can keep an eye on it.
"""

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from google.api_core import exceptions as gexc
from google.cloud import storage
from google.cloud import texttospeech
from pydub import AudioSegment

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("google_flow_pipeline")

# Upbeat, child-friendly Neural2 voices.
VOICES = {
    "en-US-Neural2-J": "en-US",
    "en-US-Neural2-F": "en-US",
    "en-AU-Neural2-D": "en-AU",
    "en-GB-Neural2-A": "en-GB",
}
DEFAULT_VOICE = "en-US-Neural2-J"

# Bright palette for slide backgrounds (cycled per sentence).
PALETTE = [
    "0xFF6B6B", "0xFFD93D", "0x6BCB77", "0x4D96FF",
    "0xC77DFF", "0xFF9F45", "0x00C2D1", "0xF15BB5",
]

WIDTH, HEIGHT, FPS = 1920, 1080, 30
PAUSE_MS = 350  # silence between sentences


class PipelineError(RuntimeError):
    pass


@dataclass
class Segment:
    index: int
    text: str
    audio_path: Path
    duration: float  # seconds, including trailing pause
    image_path: Optional[Path] = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def require_env() -> str:
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    project_id = os.environ.get("PROJECT_ID")
    if not creds or not Path(creds).is_file():
        raise PipelineError("GOOGLE_APPLICATION_CREDENTIALS must point to a service-account JSON file")
    if not project_id:
        raise PipelineError("PROJECT_ID environment variable is required")
    if not shutil.which("ffmpeg"):
        raise PipelineError("ffmpeg not found on PATH")
    return project_id


def split_sentences(script: str) -> List[str]:
    text = re.sub(r"\s+", " ", script).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if re.search(r"\w", p)]


def run_ffmpeg(args: List[str]) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args]
    log.debug("ffmpeg: %s", " ".join(cmd))
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise PipelineError(f"ffmpeg failed: {e.stderr.strip()}") from e


def find_font() -> Optional[str]:
    candidates = [
        os.environ.get("FONT_FILE", ""),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    return next((c for c in candidates if c and Path(c).is_file()), None)


def ff_escape_path(p: Path) -> str:
    # Escape for use inside an ffmpeg filter option value.
    return str(p).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


# --------------------------------------------------------------------------- #
# Google Cloud Storage
# --------------------------------------------------------------------------- #
class AssetStore:
    def __init__(self, project_id: str, bucket_name: Optional[str] = None):
        self.client = storage.Client(project=project_id)
        ts = time.strftime("%Y%m%d%H%M%S")
        name = (bucket_name or f"{project_id}-yt-assets-{ts}").lower()
        self.prefix = f"run-{ts}"
        try:
            self.bucket = self.client.lookup_bucket(name)
            if self.bucket is None:
                log.info("Creating GCS bucket gs://%s", name)
                self.bucket = self.client.create_bucket(name, location="US")
            else:
                log.info("Using existing GCS bucket gs://%s", name)
        except gexc.GoogleAPIError as e:
            raise PipelineError(f"Could not access/create bucket {name}: {e}") from e

    def upload_file(self, path: Path, dest: Optional[str] = None) -> str:
        blob_name = f"{self.prefix}/{dest or path.name}"
        try:
            self.bucket.blob(blob_name).upload_from_filename(str(path))
        except gexc.GoogleAPIError as e:
            log.warning("Upload of %s failed: %s", path, e)
            return ""
        uri = f"gs://{self.bucket.name}/{blob_name}"
        log.debug("Uploaded %s", uri)
        return uri

    def upload_text(self, text: str, dest: str) -> str:
        blob_name = f"{self.prefix}/{dest}"
        try:
            self.bucket.blob(blob_name).upload_from_string(text, content_type="text/plain")
        except gexc.GoogleAPIError as e:
            log.warning("Upload of %s failed: %s", dest, e)
            return ""
        return f"gs://{self.bucket.name}/{blob_name}"


# --------------------------------------------------------------------------- #
# Text-to-Speech
# --------------------------------------------------------------------------- #
class Narrator:
    def __init__(self, voice: str = DEFAULT_VOICE, speaking_rate: float = 1.05, pitch: float = 2.0):
        if voice not in VOICES:
            raise PipelineError(f"Unsupported voice {voice}; choose from {list(VOICES)}")
        self.client = texttospeech.TextToSpeechClient()
        self.voice = texttospeech.VoiceSelectionParams(language_code=VOICES[voice], name=voice)
        self.audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=speaking_rate,  # slightly quick = upbeat
            pitch=pitch,                  # slightly higher = friendlier
        )
        self.chars_used = 0

    def synthesize(self, text: str, out_path: Path, retries: int = 3) -> Path:
        req_input = texttospeech.SynthesisInput(text=text)
        for attempt in range(1, retries + 1):
            try:
                resp = self.client.synthesize_speech(
                    input=req_input, voice=self.voice, audio_config=self.audio_config
                )
                out_path.write_bytes(resp.audio_content)
                self.chars_used += len(text)
                return out_path
            except (gexc.ServiceUnavailable, gexc.DeadlineExceeded, gexc.ResourceExhausted) as e:
                wait = 2 ** attempt
                log.warning("TTS attempt %d failed (%s); retrying in %ds", attempt, e, wait)
                time.sleep(wait)
            except gexc.GoogleAPIError as e:
                raise PipelineError(f"TTS failed for '{text[:40]}...': {e}") from e
        raise PipelineError(f"TTS failed after {retries} attempts for '{text[:40]}...'")


# --------------------------------------------------------------------------- #
# Optional Pexels backgrounds
# --------------------------------------------------------------------------- #
def fetch_pexels_image(query: str, out_path: Path) -> Optional[Path]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        return None
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode(
        {"query": query, "per_page": 1, "orientation": "landscape"}
    )
    try:
        req = urllib.request.Request(url, headers={"Authorization": key, "User-Agent": "yt-ai-agent"})
        with urllib.request.urlopen(req, timeout=15) as r:
            photos = json.load(r).get("photos", [])
        if not photos:
            return None
        img_req = urllib.request.Request(photos[0]["src"]["landscape"], headers={"User-Agent": "yt-ai-agent"})
        with urllib.request.urlopen(img_req, timeout=30) as r:
            out_path.write_bytes(r.read())
        return out_path
    except Exception as e:  # network/API issues should never kill the run
        log.warning("Pexels lookup for '%s' failed: %s", query, e)
        return None


def keyword_for(sentence: str, topic: str) -> str:
    stop = {"the", "and", "a", "an", "to", "of", "is", "are", "we", "you", "it", "in",
            "on", "for", "with", "this", "that", "let's", "lets", "can", "our", "my"}
    words = [w for w in re.findall(r"[A-Za-z']+", sentence.lower()) if w not in stop and len(w) > 3]
    return f"{topic} {max(words, key=len)}" if words else topic


# --------------------------------------------------------------------------- #
# Video
# --------------------------------------------------------------------------- #
def render_slide(seg: Segment, out_path: Path, workdir: Path, font: Optional[str]) -> Path:
    """One slide: coloured (or photo) background + bouncing, fading-in caption."""
    color = PALETTE[seg.index % len(PALETTE)]
    dur = f"{seg.duration:.3f}"

    textfile = workdir / f"caption_{seg.index:03d}.txt"
    textfile.write_text("\n".join(textwrap.wrap(seg.text, width=28)), encoding="utf-8")

    font_opt = f"fontfile='{ff_escape_path(Path(font))}':" if font else ""
    # Text pops in (alpha ramp) and gently bobs up and down.
    drawtext = (
        f"drawtext={font_opt}textfile='{ff_escape_path(textfile)}':"
        "fontsize=84:fontcolor=white:line_spacing=18:"
        "borderw=6:bordercolor=black@0.6:"
        "box=1:boxcolor=black@0.25:boxborderw=40:"
        "x=(w-text_w)/2:y=(h-text_h)/2+20*sin(2*PI*t/1.6):"
        "alpha='min(1,t/0.4)'"
    )
    # Floating, bouncing stars for extra motion.
    bubble = ",".join(
        f"drawtext={font_opt}text='★':fontsize={size}:fontcolor=white@0.55:"
        f"x='{x}+{amp}*sin(t*{spd})':y='{y}+{amp}*cos(t*{spd}*0.8)'"
        for x, y, amp, spd, size in [
            ("w*0.08", "h*0.12", 60, 1.3, 160),
            ("w*0.82", "h*0.70", 50, 1.7, 120),
            ("w*0.75", "h*0.10", 40, 2.1, 90),
        ]
    )

    if seg.image_path:
        inputs = ["-loop", "1", "-t", dur, "-i", str(seg.image_path)]
        vf = (
            f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},"
            f"zoompan=z='min(zoom+0.0008,1.15)':d=1:s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"{drawtext}"
        )
    else:
        inputs = ["-f", "lavfi", "-t", dur, "-i", f"color=c={color}:s={WIDTH}x{HEIGHT}:r={FPS}"]
        vf = f"{bubble},{drawtext}"

    run_ffmpeg([
        *inputs,
        "-vf", f"{vf},fade=t=in:st=0:d=0.25,format=yuv420p",
        "-t", dur, "-r", str(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        str(out_path),
    ])
    return out_path


def concat_videos(clips: List[Path], out_path: Path, workdir: Path) -> Path:
    listfile = workdir / "clips.txt"
    listfile.write_text("".join(f"file '{c.as_posix()}'\n" for c in clips), encoding="utf-8")
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listfile), "-c", "copy", str(out_path)])
    return out_path


def mux(video: Path, audio: Path, out_path: Path) -> Path:
    run_ffmpeg([
        "-i", str(video), "-i", str(audio),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart", str(out_path),
    ])
    return out_path


# --------------------------------------------------------------------------- #
# Pipeline
# --------------------------------------------------------------------------- #
class GoogleFlowPipeline:
    def __init__(self, voice: str = DEFAULT_VOICE, topic: str = "kids cartoon",
                 bucket_name: Optional[str] = None, upload: bool = True):
        self.project_id = require_env()
        self.narrator = Narrator(voice)
        self.topic = topic
        self.store = AssetStore(self.project_id, bucket_name or os.environ.get("GCS_BUCKET")) if upload else None
        self.font = find_font()
        if not self.font:
            log.warning("No TTF font found; ffmpeg default font will be used (set FONT_FILE to override)")

    def run(self, script: str, output: Path) -> Path:
        sentences = split_sentences(script)
        if not sentences:
            raise PipelineError("Script contains no sentences")
        log.info("Processing %d sentences (%d chars)", len(sentences), sum(map(len, sentences)))

        workdir = Path(tempfile.mkdtemp(prefix="gflow_"))
        try:
            if self.store:
                self.store.upload_text(script, "script.txt")

            # 1. TTS per sentence + combine
            segments: List[Segment] = []
            narration = AudioSegment.silent(duration=0)
            pause = AudioSegment.silent(duration=PAUSE_MS)
            for i, sentence in enumerate(sentences):
                mp3 = self.narrator.synthesize(sentence, workdir / f"line_{i:03d}.mp3")
                clip = AudioSegment.from_file(mp3, format="mp3") + pause
                narration += clip
                segments.append(Segment(i, sentence, mp3, len(clip) / 1000.0))
                log.info("  [%d/%d] %.2fs  %s", i + 1, len(sentences), len(clip) / 1000.0, sentence[:60])
                if self.store:
                    self.store.upload_file(mp3, f"audio/{mp3.name}")

            narration_path = workdir / "narration.mp3"
            narration.export(narration_path, format="mp3", bitrate="192k")
            if self.store:
                self.store.upload_file(narration_path, "audio/narration.mp3")
            log.info("Narration: %.1fs, TTS chars used this run: %d",
                     len(narration) / 1000.0, self.narrator.chars_used)

            # 2. Visuals synced to each sentence's duration
            clips = []
            for seg in segments:
                seg.image_path = fetch_pexels_image(
                    keyword_for(seg.text, self.topic), workdir / f"bg_{seg.index:03d}.jpg"
                )
                clips.append(render_slide(seg, workdir / f"slide_{seg.index:03d}.mp4", workdir, self.font))

            # 3. Assemble
            silent_video = concat_videos(clips, workdir / "video_noaudio.mp4", workdir)
            output.parent.mkdir(parents=True, exist_ok=True)
            mux(silent_video, narration_path, output)
            log.info("Final video written to %s", output.resolve())

            if self.store:
                uri = self.store.upload_file(output, f"video/{output.name}")
                if uri:
                    log.info("Video uploaded to %s", uri)
            return output
        finally:
            if os.environ.get("KEEP_WORKDIR"):
                log.info("Intermediate files kept in %s", workdir)
            else:
                shutil.rmtree(workdir, ignore_errors=True)


def create_video_from_script(script: str, output: str = "output/kids_video.mp4", **kwargs) -> str:
    """Entry point for the existing agent: pass a script string, get an mp4 path."""
    return str(GoogleFlowPipeline(**kwargs).run(script, Path(output)))


def main() -> int:
    p = argparse.ArgumentParser(description="Script -> Google TTS -> animated kids' mp4")
    src = p.add_mutually_exclusive_group()
    src.add_argument("--script", help="Script text")
    src.add_argument("--script-file", type=Path, help="File containing the script")
    p.add_argument("--output", type=Path, default=Path("output/kids_video.mp4"))
    p.add_argument("--voice", default=DEFAULT_VOICE, choices=list(VOICES))
    p.add_argument("--topic", default="kids cartoon", help="Pexels search theme for backgrounds")
    p.add_argument("--bucket", help="Existing GCS bucket to use")
    p.add_argument("--no-upload", action="store_true", help="Skip Google Cloud Storage uploads")
    a = p.parse_args()

    if a.script:
        script = a.script
    elif a.script_file:
        script = a.script_file.read_text(encoding="utf-8")
    elif not sys.stdin.isatty():
        script = sys.stdin.read()
    else:
        p.error("Provide --script, --script-file, or pipe text on stdin")

    try:
        pipeline = GoogleFlowPipeline(a.voice, a.topic, a.bucket, upload=not a.no_upload)
        pipeline.run(script, a.output)
        return 0
    except PipelineError as e:
        log.error("%s", e)
    except Exception:
        log.exception("Unexpected failure")
    return 1


if __name__ == "__main__":
    sys.exit(main())
