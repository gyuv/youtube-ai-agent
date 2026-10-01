"""Kidzulagum: a free, fully cloud-run YouTube Kids video pipeline.

Runs on a GitHub Actions Ubuntu runner (see .github/workflows/generate.yml):

    1. Script   Gemini writes a ~2 minute episode as JSON scenes (image_prompt + tts_text).
    2. Assets   Hugging Face makes one 16:9 image per scene; edge-tts voices each scene.
    3. Render   MoviePy zooms each image 10% over its narration, joins the scenes and
                mixes a background track at 10% volume.
    4. Upload   YouTube Data API v3 uploads the video as "Made for Kids".

Every setting comes from environment variables (GitHub secrets / workflow inputs), so nothing
private lives in the repository.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import io
import json
import os
import random
import sys
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

import edge_tts
import numpy as np
import requests
from PIL import Image

# ─────────────────────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ.get("KZ_WORK_DIR", ROOT / "output"))
MUSIC_DIR = ROOT / "music"
TOPICS_FILE = ROOT / "topics.txt"

VIDEO_SIZE = (1920, 1080)
FPS = 24
ZOOM = 0.10  # 10% Ken Burns zoom-in per scene
MUSIC_VOLUME = 0.10
SCENE_PAD_SECONDS = 0.6  # breathing room after each line: toddlers need time to answer

VOICE = os.environ.get("KZ_VOICE", "en-US-AnaNeural")
VOICE_RATE = os.environ.get("KZ_VOICE_RATE", "-10%")

GEMINI_MODELS = [m for m in (os.environ.get("GEMINI_MODEL", "gemini-3.7-flash"), os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")) if m]
HF_MODELS = [m.strip() for m in os.environ.get("HF_IMAGE_MODELS", "stabilityai/stable-diffusion-xl-base-1.0,black-forest-labs/FLUX.1-schnell").split(",") if m.strip()]

IMAGE_SUFFIX = (
    ", 3D animation, Pixar Disney style, ultra-cute, oversized expressive eyes, "
    "bright vibrant primary colors, soft studio lighting, clean background, 16:9"
)
HOSTS = (
    "Milo, a fluffy white Persian cat with big round blue eyes and a tiny red bow tie, "
    "and Coco, a playful golden-and-white Shih Tzu puppy with a little top-knot and a pink bow"
)

PRIVACY = os.environ.get("KZ_PRIVACY", "public")  # public | unlisted | private
CATEGORY_EDUCATION = "27"


def log(message: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"Missing environment variable {name}. Add it as a GitHub repository secret.")
    return value


@dataclass
class Scene:
    index: int
    image_prompt: str
    tts_text: str

    @property
    def image(self) -> Path:
        return WORK / f"scene_{self.index}.jpg"

    @property
    def audio(self) -> Path:
        return WORK / f"scene_{self.index}.mp3"


# ─────────────────────────────────────────────────────────────
# Step 1: Scripting (Gemini)
# ─────────────────────────────────────────────────────────────

SCRIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"image_prompt": {"type": "string"}, "tts_text": {"type": "string"}},
                "required": ["image_prompt", "tts_text"],
            },
        },
    },
    "required": ["title", "description", "tags", "scenes"],
}


def pick_topic() -> str:
    """Workflow input wins; otherwise rotate through topics.txt by day so episodes don't repeat."""
    override = os.environ.get("KZ_TOPIC", "").strip()
    if override:
        return override
    topics = [t.strip() for t in TOPICS_FILE.read_text(encoding="utf-8").splitlines() if t.strip() and not t.startswith("#")]
    return topics[dt.date.today().toordinal() % len(topics)]


def build_script_prompt(topic: str) -> str:
    return f"""You write episodes for "Kidzulagum", a YouTube Kids channel for toddlers and preschoolers (ages 2-5).
The hosts are always the same two characters: {HOSTS}. They appear together in every scene.

Write one episode that teaches: {topic}

Rules:
- About 2 minutes when read slowly: 16 to 20 scenes, each tts_text 1 to 3 very short sentences (max 30 words).
- Slow, warm, cheerful and highly interactive: ask the child questions, then pause ("Can you say red? ... Red!"),
  invite them to clap, point, count or copy a sound. Repeat the key words several times.
- Simple words a 3-year-old knows. No scary, sad, violent or unsafe content; no brands; no real people.
- Start with a happy greeting from Milo and Coco ("Hello friends! Welcome to Kidzulagum!") and end with a song-like
  recap and a goodbye wave.
- image_prompt: a literal, concrete visual description of ONE frame with Milo the Persian cat and Coco the Shih Tzu
  puppy (always describe both by species and look), what they are doing, and the teaching object in the frame.
  No text, letters or numbers written in the image unless the lesson is about that letter or number.
- title: under 70 characters, cheerful, includes the topic, ends with " | Kidzulagum".
- description: 2-3 friendly sentences for parents about what the child learns.
- tags: 10-15 short tags (toddler learning, preschool, the topic, cat and puppy...).
Return JSON only."""


def generate_script(topic: str) -> dict:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=require("GEMINI_API_KEY"))
    errors = []
    for model in GEMINI_MODELS:
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=build_script_prompt(topic),
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=SCRIPT_SCHEMA,
                        temperature=0.9,
                    ),
                )
                script = json.loads(response.text)
                scenes = [s for s in script.get("scenes", []) if s.get("image_prompt", "").strip() and s.get("tts_text", "").strip()]
                if len(scenes) < 8:
                    raise ValueError(f"only {len(scenes)} usable scenes")
                script["scenes"] = scenes
                log(f"Script ready from {model}: {len(scenes)} scenes, '{script['title']}'")
                return script
            except Exception as error:  # quota, overload or bad JSON: retry, then fall back to the next model
                errors.append(f"{model} #{attempt + 1}: {error}")
                time.sleep(5 * (attempt + 1))
    sys.exit("Gemini could not write the script:\n" + "\n".join(errors))


# ─────────────────────────────────────────────────────────────
# Step 2: Assets (Hugging Face images + edge-tts voice)
# ─────────────────────────────────────────────────────────────


def fit_16x9(image: Image.Image) -> Image.Image:
    """Center-crop to 16:9 and scale to the video size, whatever the model returned."""
    image = image.convert("RGB")
    w, h = image.size
    target = VIDEO_SIZE[0] / VIDEO_SIZE[1]
    if w / h > target:
        new_w = int(h * target)
        image = image.crop(((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h))
    else:
        new_h = int(w / target)
        image = image.crop((0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h))
    return image.resize(VIDEO_SIZE, Image.LANCZOS)


def huggingface_image(prompt: str) -> Image.Image:
    from huggingface_hub import InferenceClient

    client = InferenceClient(token=require("HF_TOKEN"), timeout=180)
    last_error: Exception | None = None
    for model in HF_MODELS:
        for attempt in range(3):
            try:
                return client.text_to_image(prompt, model=model, width=1344, height=768,
                                            negative_prompt="text, watermark, scary, dark, blurry, deformed, extra limbs")
            except Exception as error:  # cold model (503), rate limit (429) or out of free credits (402)
                last_error = error
                log(f"  Hugging Face {model} attempt {attempt + 1} failed: {str(error)[:160]}")
                if "402" in str(error):
                    break  # free monthly credits used up: retrying this provider won't help
                time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Hugging Face failed: {last_error}")


def pollinations_image(prompt: str) -> Image.Image:
    """Keyless free fallback so a busy Hugging Face never stops the daily episode."""
    url = "https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt[:900])
    params = {"width": 1344, "height": 768, "model": "flux", "nologo": "true", "safe": "true", "seed": random.randint(1, 2**31 - 1)}
    for attempt in range(4):
        res = requests.get(url, params=params, timeout=180)
        if res.ok and res.headers.get("content-type", "").startswith("image/"):
            return Image.open(io.BytesIO(res.content))
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Pollinations failed ({res.status_code})")


def generate_image(scene: Scene) -> None:
    prompt = scene.image_prompt.strip().rstrip(".") + IMAGE_SUFFIX
    try:
        image = huggingface_image(prompt)
    except Exception as error:
        log(f"  Falling back to Pollinations for scene {scene.index}: {str(error)[:120]}")
        image = pollinations_image(prompt)
    fit_16x9(image).save(scene.image, "JPEG", quality=92)


async def _speak(text: str, path: Path) -> None:
    await edge_tts.Communicate(text, VOICE, rate=VOICE_RATE).save(str(path))


def generate_audio(scene: Scene) -> None:
    for attempt in range(3):
        try:
            asyncio.run(_speak(scene.tts_text, scene.audio))
            if scene.audio.stat().st_size > 1000:
                return
        except Exception as error:
            log(f"  edge-tts attempt {attempt + 1} failed: {error}")
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"edge-tts could not voice scene {scene.index}")


def generate_assets(scenes: list[Scene]) -> None:
    for scene in scenes:
        log(f"Scene {scene.index}: image + voice")
        generate_image(scene)
        generate_audio(scene)


# ─────────────────────────────────────────────────────────────
# Step 3: Rendering (MoviePy 2.x)
# ─────────────────────────────────────────────────────────────


def ken_burns(image_path: Path, duration: float):
    """A static image that zooms in by ZOOM over `duration`, centered, at the video size."""
    from moviepy import VideoClip

    base = Image.open(image_path).convert("RGB")
    # Work from a larger source so the zoom stays sharp.
    big = base.resize((int(VIDEO_SIZE[0] * (1 + ZOOM)), int(VIDEO_SIZE[1] * (1 + ZOOM))), Image.LANCZOS)
    bw, bh = big.size

    def frame(t: float) -> np.ndarray:
        progress = min(max(t / duration, 0.0), 1.0)
        progress = progress * progress * (3 - 2 * progress)  # ease in and out: gentle for little eyes
        scale = 1 + ZOOM * progress  # 1.0 -> 1.1
        crop_w, crop_h = bw / scale, bh / scale
        left, top = (bw - crop_w) / 2, (bh - crop_h) / 2
        view = big.crop((round(left), round(top), round(left + crop_w), round(top + crop_h)))
        return np.asarray(view.resize(VIDEO_SIZE, Image.BILINEAR))

    return VideoClip(frame, duration=duration)


def pick_music() -> Path | None:
    tracks = sorted(p for p in MUSIC_DIR.glob("*") if p.suffix.lower() in {".mp3", ".wav", ".m4a", ".ogg"})
    return random.choice(tracks) if tracks else None


def render_video(scenes: list[Scene], output: Path) -> Path:
    from moviepy import AudioFileClip, CompositeAudioClip, concatenate_videoclips
    from moviepy.audio.fx import AudioFadeIn, AudioFadeOut, AudioLoop

    clips = []
    for scene in scenes:
        voice = AudioFileClip(str(scene.audio))
        duration = voice.duration + SCENE_PAD_SECONDS
        clips.append(ken_burns(scene.image, duration).with_audio(voice))
        log(f"Scene {scene.index}: {duration:.1f}s")

    video = concatenate_videoclips(clips, method="chain")
    track = pick_music()
    if track:
        music = (
            AudioFileClip(str(track))
            .with_effects([AudioLoop(duration=video.duration)])
            .with_volume_scaled(MUSIC_VOLUME)
            .with_effects([AudioFadeIn(1.5), AudioFadeOut(3)])
        )
        video = video.with_audio(CompositeAudioClip([video.audio, music]))
        log(f"Background music: {track.name} at {int(MUSIC_VOLUME * 100)}%")
    else:
        log("No music in kidzulagum/music/: rendering voice only")

    video.write_videofile(
        str(output), fps=FPS, codec="libx264", audio_codec="aac", preset="medium",
        threads=os.cpu_count() or 2, ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"], logger="bar",
    )
    log(f"Rendered {output.name}: {video.duration:.0f}s, {output.stat().st_size / 1e6:.1f} MB")
    return output


# ─────────────────────────────────────────────────────────────
# Step 4: Upload (YouTube Data API v3)
# ─────────────────────────────────────────────────────────────


def youtube_client():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    credentials = Credentials(
        token=None,
        refresh_token=require("YOUTUBE_REFRESH_TOKEN"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=require("YOUTUBE_CLIENT_ID"),
        client_secret=require("YOUTUBE_CLIENT_SECRET"),
        scopes=["https://www.googleapis.com/auth/youtube.upload"],
    )
    return build("youtube", "v3", credentials=credentials, cache_discovery=False)


def upload_video(path: Path, script: dict) -> str:
    from googleapiclient.http import MediaFileUpload

    tags, total = [], 0
    for tag in ["Kidzulagum", *script.get("tags", [])]:
        tag = tag.replace("<", "").replace(">", "").strip()[:30]
        if tag and tag not in tags and total + len(tag) < 450:  # YouTube caps tags at 500 characters
            tags.append(tag)
            total += len(tag) + 2
    body = {
        "snippet": {
            "title": script["title"].replace("<", "").replace(">", "")[:100],
            "description": (script["description"] + "\n\nLearn and play with Milo the cat and Coco the puppy on Kidzulagum!")[:5000],
            "tags": tags,
            "categoryId": CATEGORY_EDUCATION,
            "defaultLanguage": "en",
            "defaultAudioLanguage": "en",
        },
        "status": {
            "privacyStatus": PRIVACY,
            "selfDeclaredMadeForKids": True,
            "containsSyntheticMedia": True,  # AI voice and AI images
        },
    }
    request = youtube_client().videos().insert(
        part="snippet,status", body=body, media_body=MediaFileUpload(str(path), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)
    )
    response = None
    while response is None:
        status, response = request.next_chunk(num_retries=5)
        if status:
            log(f"Upload {int(status.progress() * 100)}%")
    video_id = response["id"]
    log(f"Uploaded: https://youtu.be/{video_id} ({response.get('status', {}).get('privacyStatus', PRIVACY)})")
    return video_id


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    topic = pick_topic()
    log(f"Topic: {topic}")

    script = generate_script(topic)
    (WORK / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8")
    scenes = [Scene(i + 1, s["image_prompt"], s["tts_text"]) for i, s in enumerate(script["scenes"])]

    generate_assets(scenes)
    video = render_video(scenes, WORK / "video.mp4")

    if os.environ.get("KZ_SKIP_UPLOAD", "").lower() in {"1", "true", "yes"}:
        log("KZ_SKIP_UPLOAD is set: not uploading (download the video from the workflow artifacts).")
        return
    upload_video(video, script)


if __name__ == "__main__":
    main()
