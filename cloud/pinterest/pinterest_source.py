"""Pinterest video source: search Pinterest for a topic and download the first video Pin.

Playwright (sync API) loads the public search page and collects Pin URLs; yt-dlp then tries
each one in order and keeps the first that yields a video. Image-only Pins (and any Pin yt-dlp
cannot handle) are skipped. The file lands in a temporary directory the caller owns.

Usage:
    python pinterest_source.py "ocean waves at sunset" [--max-pins 25] [--out DIR]
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
import urllib.parse
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

SEARCH_URL = "https://www.pinterest.com/search/pins/?q={query}"
PIN_PATH = re.compile(r"^/pin/(\d+)/?")
SCROLLS = 4
NAV_TIMEOUT_MS = 30_000


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("topic")
    parser.add_argument("--max-pins", type=int, default=25)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    path = fetch_pinterest_video(args.topic, args.out, args.max_pins)
    if not path:
        sys.exit(f"No downloadable video Pin found for {args.topic!r}.")
    print(path)


if __name__ == "__main__":
    main()
