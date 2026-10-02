"""Pinterest video source: search Pinterest for a topic and download the first video Pin.

Playwright (sync API) loads the public search page and collects Pin URLs; yt-dlp then tries
each one in order and keeps the first that yields a video. Image-only Pins (and any Pin yt-dlp
cannot handle) are skipped. The file lands in a temporary directory the caller owns.

As a Lumen worker it polls the app for scenes queued with the "Pinterest" visual source (the
same claim/complete protocol as the Wan2GP worker in cloud/colab/), uploads the video through the
signed URL it is handed, and reports back. Lumen calls nothing on this machine.

Usage:
    python pinterest_source.py "ocean waves at sunset" [--max-pins 25] [--out DIR]
    LUMEN_URL=https://your-app.vercel.app PINTEREST_WORKER_SECRET=... \
        python pinterest_source.py --worker [--once]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
import time
import traceback
import urllib.parse
from pathlib import Path

import requests

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

SEARCH_URL = "https://www.pinterest.com/search/pins/?q={query}"
PIN_PATH = re.compile(r"^/pin/(\d+)/?")
SCROLLS = 4
NAV_TIMEOUT_MS = 30_000
POLL_SECONDS = 20
HTTP_TIMEOUT = 60


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def search_pin_urls(topic: str, max_pins: int = 25) -> list[str]:
    """Return up to max_pins unique Pin URLs from Pinterest's search results for topic."""
    url = SEARCH_URL.format(query=urllib.parse.quote_plus(topic))
    pins: dict[str, str] = {}  # pin id -> canonical URL, insertion-ordered
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 1600})
            page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            try:
                page.wait_for_selector('a[href*="/pin/"]', timeout=NAV_TIMEOUT_MS)
            except PlaywrightTimeout:
                return []
            # Results load lazily; scroll a few screens to collect more Pins.
            for _ in range(SCROLLS):
                for href in page.eval_on_selector_all('a[href*="/pin/"]', "els => els.map(e => e.getAttribute('href'))"):
                    match = PIN_PATH.match(urllib.parse.urlparse(href or "").path)
                    if match:
                        pins.setdefault(match.group(1), f"https://www.pinterest.com/pin/{match.group(1)}/")
                if len(pins) >= max_pins:
                    break
                page.mouse.wheel(0, 3000)
                page.wait_for_timeout(1200)
        finally:
            browser.close()
    return list(pins.values())[:max_pins]


def download_first_video(pin_urls: list[str], out_dir: Path) -> Path | None:
    """Download the first Pin that is a video into out_dir; return its path, or None."""
    options = {
        "outtmpl": str(out_dir / "pinterest-%(id)s.%(ext)s"),
        "format": "bestvideo*+bestaudio/best",
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    with YoutubeDL(options) as ydl:
        for url in pin_urls:
            try:
                info = ydl.extract_info(url, download=False)
                # Image Pins come back without any video formats; skip them before downloading.
                if not info or not any(f.get("vcodec") not in (None, "none") for f in info.get("formats") or [info]):
                    print(f"skip (no video): {url}", file=sys.stderr)
                    continue
                info = ydl.process_ie_result(info, download=True)
                path = Path(info["requested_downloads"][0]["filepath"]) if info.get("requested_downloads") else None
                if path and path.exists():
                    return path
            except (DownloadError, KeyError, OSError) as error:
                print(f"skip ({type(error).__name__}): {url}: {error}", file=sys.stderr)
                continue
    return None


def fetch_pinterest_video(topic: str, out_dir: Path | None = None, max_pins: int = 25) -> Path | None:
    """Search Pinterest for topic and download the first video Pin. None when nothing usable is found."""
    out_dir = out_dir or Path(tempfile.mkdtemp(prefix="pinterest-"))
    out_dir.mkdir(parents=True, exist_ok=True)
    return download_first_video(search_pin_urls(topic, max_pins), out_dir)


class Lumen:
    def __init__(self, base_url: str, secret: str) -> None:
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {secret}"

    def claim(self) -> dict | None:
        res = self.session.post(f"{self.base}/api/pinterest/claim", timeout=HTTP_TIMEOUT)
        if res.status_code == 204:
            return None
        if res.status_code == 401:
            sys.exit("Lumen rejected PINTEREST_WORKER_SECRET. It must match the value set in Vercel.")
        res.raise_for_status()
        return res.json()

    def report(self, job: dict, error: str | None = None) -> None:
        body = {"ok": error is None, "sceneId": job["sceneId"], "claimedAt": job["claimedAt"]}
        if error is not None:
            body["error"] = error[:2000]
        res = self.session.post(f"{self.base}/api/pinterest/complete", json=body, timeout=HTTP_TIMEOUT)
        res.raise_for_status()
        if not res.json().get("applied"):
            log("Lumen ignored the result (the request was cancelled, re-queued or the scene was locked).")


def upload(job: dict, path: Path) -> None:
    target = job["upload"]
    with path.open("rb") as body:
        res = requests.request(target["method"], target["url"], data=body, headers=target["headers"], timeout=600)
    if not res.ok:
        raise RuntimeError(f"Storage upload failed ({res.status_code}): {res.text[:300]}")


def run_worker(max_pins: int, once: bool) -> None:
    base_url = os.environ.get("LUMEN_URL", "").strip()
    secret = os.environ.get("PINTEREST_WORKER_SECRET", "").strip()
    if not base_url or not secret:
        sys.exit("Set LUMEN_URL and PINTEREST_WORKER_SECRET.")
    lumen = Lumen(base_url, secret)
    log(f"Polling {base_url} for Pinterest searches.")
    while True:
        try:
            job = lumen.claim()
        except requests.RequestException as error:
            log(f"Claim failed: {error}")
            job = None
        if job is None:
            if once:
                return
            time.sleep(POLL_SECONDS)
            continue

        query = job["prompt"]
        log(f"Scene {job['sceneId']}: searching Pinterest for {query!r}")
        with tempfile.TemporaryDirectory(prefix="pinterest-") as tmp:
            try:
                path = fetch_pinterest_video(query, Path(tmp), max_pins)
                if not path:
                    raise RuntimeError(f"No downloadable video Pin found for {query!r}.")
                upload(job, path)
                lumen.report(job)
                log(f"Scene {job['sceneId']}: uploaded {path.name}")
            except Exception as error:  # report every failure so the scene doesn't sit RUNNING
                traceback.print_exc()
                try:
                    lumen.report(job, f"{type(error).__name__}: {error}")
                except requests.RequestException as report_error:
                    log(f"Report failed: {report_error}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("topic", nargs="?")
    parser.add_argument("--max-pins", type=int, default=25)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--worker", action="store_true", help="Poll Lumen for queued Pinterest searches")
    parser.add_argument("--once", action="store_true", help="With --worker: process the queue, then exit")
    args = parser.parse_args()
    if args.worker:
        run_worker(args.max_pins, args.once)
        return
    if not args.topic:
        parser.error("give a topic, or --worker")
    path = fetch_pinterest_video(args.topic, args.out, args.max_pins)
    if not path:
        sys.exit(f"No downloadable video Pin found for {args.topic!r}.")
    print(path)


if __name__ == "__main__":
    main()
