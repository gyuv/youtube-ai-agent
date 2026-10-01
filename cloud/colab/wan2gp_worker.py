"""Lumen Cloud <-> Wan2GP GPU worker.

Runs next to a Wan2GP checkout on any NVIDIA GPU machine (the Colab notebook in this folder sets
it up on a free T4). It polls Lumen for scenes queued for an AI video clip, generates each clip
with the WanGP Python API (shared/api.py), uploads the mp4 straight to Lumen's storage through a
signed URL, and reports the result. Lumen calls nothing on this machine, so no tunnel or public
URL is needed, and the worker can stop at any time: an abandoned claim is re-queued after 45 min.

Usage:
    LUMEN_URL=https://your-app.vercel.app WAN2GP_WORKER_SECRET=... \
        python wan2gp_worker.py --wan2gp-dir /content/Wan2GP

This integration uses WanGP by DeepBeepMeep (https://github.com/deepbeepmeep/Wan2GP), subject to
the WanGP terms and conditions.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

import requests

POLL_SECONDS = 20
HTTP_TIMEOUT = 60


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


class Lumen:
    def __init__(self, base_url: str, secret: str) -> None:
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {secret}"

    def claim(self) -> dict | None:
        res = self.session.post(f"{self.base}/api/wan2gp/claim", timeout=HTTP_TIMEOUT)
        if res.status_code == 204:
            return None
        if res.status_code == 401:
            sys.exit("Lumen rejected WAN2GP_WORKER_SECRET. It must match the value set in Vercel.")
        res.raise_for_status()
        return res.json()

    def report(self, job: dict, error: str | None = None) -> None:
        body = {"ok": error is None, "sceneId": job["sceneId"], "claimedAt": job["claimedAt"]}
        if error is not None:
            body["error"] = error[:2000]
        res = self.session.post(f"{self.base}/api/wan2gp/complete", json=body, timeout=HTTP_TIMEOUT)
        res.raise_for_status()
        if not res.json().get("applied"):
            log("Lumen ignored the result (the request was cancelled, re-queued or the scene was locked).")


def upload(job: dict, path: Path) -> None:
    upload = job["upload"]
    with path.open("rb") as body:
        res = requests.request(upload["method"], upload["url"], data=body, headers=upload["headers"], timeout=600)
    if not res.ok:
        raise RuntimeError(f"Storage upload failed ({res.status_code}): {res.text[:300]}")


def frame_count(duration_seconds: float, fps: int, max_frames: int) -> int:
    """Wan models take 4n+1 frames. Cap at max_frames; Lumen loops a short clip over the narration."""
    wanted = max(1, math.ceil(duration_seconds * fps))
    frames = min(max_frames, wanted)
    return (frames - 1) // 4 * 4 + 1 if frames > 1 else 17


def build_settings(job: dict, args: argparse.Namespace, image_path: str | None) -> dict:
    settings = {
        "model_type": args.i2v_model if image_path else args.model,
        "prompt": job["prompt"],
        "negative_prompt": "text, watermark, logo, subtitles, blurry, distorted, low quality",
        "resolution": f"{job['width']}x{job['height']}",
        "video_length": frame_count(job["durationSeconds"], args.fps, args.max_frames),
        "num_inference_steps": args.steps,
        "seed": -1,
    }
    if image_path:
        settings["image_prompt_type"] = "S"
        settings["image_start"] = image_path
    return settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Lumen scene clips with Wan2GP.")
    parser.add_argument("--wan2gp-dir", default=os.environ.get("WAN2GP_DIR", "/content/Wan2GP"))
    parser.add_argument("--model", default=os.environ.get("WAN2GP_MODEL", "t2v_1.3B"), help="WanGP model_type for text-to-video")
    parser.add_argument("--i2v-model", default=os.environ.get("WAN2GP_I2V_MODEL", ""), help="Animate the scene's image with this model instead (needs more VRAM/RAM)")
    parser.add_argument("--steps", type=int, default=int(os.environ.get("WAN2GP_STEPS", "20")))
    parser.add_argument("--fps", type=int, default=16, help="Wan 2.1 generates 16 fps")
    parser.add_argument("--max-frames", type=int, default=int(os.environ.get("WAN2GP_MAX_FRAMES", "81")), help="81 frames = 5 s")
    parser.add_argument("--profile", default=os.environ.get("WAN2GP_PROFILE", "4"))
    parser.add_argument("--once", action="store_true", help="Process the queue, then exit")
    args = parser.parse_args()

    base_url = os.environ.get("LUMEN_URL", "").strip()
    secret = os.environ.get("WAN2GP_WORKER_SECRET", "").strip()
    if not base_url or not secret:
        sys.exit("Set LUMEN_URL and WAN2GP_WORKER_SECRET.")

    root = Path(args.wan2gp_dir).resolve()
    sys.path.insert(0, str(root))
    os.chdir(root)
    from shared.api import init  # noqa: E402  (WanGP's in-process API)

    log("Loading WanGP...")
    session = init(root=root, output_dir=root / "lumen_outputs", cli_args=["--attention", "sdpa", "--profile", str(args.profile)])
    lumen = Lumen(base_url, secret)
    log(f"Polling {base_url} for queued clips. Model: {args.i2v_model or args.model}")

    while True:
        try:
            job = lumen.claim()
        except requests.RequestException as error:
            log(f"Could not reach Lumen: {error}")
            time.sleep(POLL_SECONDS)
            continue
        if job is None:
            if args.once:
                log("Queue empty.")
                return
            time.sleep(POLL_SECONDS)
            continue

        log(f"Scene {job['sceneId']}: {job['prompt'][:100]}")
        started = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                image_path = None
                if args.i2v_model and job.get("imageUrl"):
                    image_path = str(Path(tmp) / "start.jpg")
                    urllib.request.urlretrieve(job["imageUrl"], image_path)
                result = session.submit_task(build_settings(job, args, image_path)).result()
                videos = [Path(f) for f in result.generated_files if str(f).lower().endswith(".mp4")]
                if not result.success or not videos:
                    messages = "; ".join(e.message for e in result.errors) or "WanGP produced no video"
                    raise RuntimeError(messages)
                upload(job, videos[-1])
                lumen.report(job)
                log(f"Done in {time.time() - started:.0f}s")
                for video in videos:
                    video.unlink(missing_ok=True)
            except Exception as error:  # report every failure so the studio shows it
                traceback.print_exc()
                try:
                    lumen.report(job, error=f"{type(error).__name__}: {error}")
                except requests.RequestException as report_error:
                    log(f"Could not report the failure: {report_error}")


if __name__ == "__main__":
    main()
