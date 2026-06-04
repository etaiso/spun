"""
Shazam recognizer sidecar.

A tiny HTTP service the Next.js app calls when a station's broadcast metadata
doesn't name the current song. It pulls a few seconds of the live stream,
fingerprints it with ShazamIO, and returns the recognized track.

Why a separate service: ShazamIO is async Python and depends on ffmpeg for
audio decoding — neither fits inside the Next.js (Node) runtime. The Next app
talks to this over plain HTTP on localhost.

Run:  ./recognizer/run.sh   (creates a venv, installs deps, starts uvicorn)
API:  POST /recognize  { "url": "<stream url>", "seconds": 6 }
      -> 200 { "match": true, "artist": "...", "title": "...",
               "raw": "Artist - Title", "cover": "<art url|>" }
      -> 200 { "match": false }            (no song identified)
      -> 503 { "error": "..." }            (capture/recognition failed)
"""

import contextlib
import json
import re
import ssl

import aiohttp
import certifi
from fastapi import FastAPI
from pydantic import BaseModel
from shazamio import Shazam

def extract_apple_music_url(hub: dict | None) -> str:
    """First https://music.apple.com/... link found in the hub deep links, or ''."""
    blob = json.dumps(hub or {})
    m = re.search(r"music\.apple\.com[^\"#\\]*", blob)
    return ("https://" + m.group(0)) if m else ""


def extract_preview_url(hub: dict | None) -> str:
    """The ~30s AAC preview clip (.m4a) from the hub actions, or ''."""
    for a in (hub or {}).get("actions") or []:
        uri = a.get("uri") or ""
        if ".m4a" in uri:
            return uri
    return ""


# macOS python.org builds don't use the system trust store, so HTTPS to the
# stream CDNs (and Shazam) fails cert verification. Pin certifi's CA bundle.
_SSL_CTX = ssl.create_default_context(cafile=certifi.where())

app = FastAPI(title="shazam-radio recognizer")

# Cap the captured clip so a request can't run away. ~6s is plenty for Shazam.
MAX_SECONDS = 12
DEFAULT_SECONDS = 6
# Stop pulling once we have enough audio (≈ 320 kbps * 12s, generous).
MAX_BYTES = 600_000
CAPTURE_TIMEOUT = 20


class RecognizeRequest(BaseModel):
    url: str
    seconds: int = DEFAULT_SECONDS


async def capture(url: str, seconds: int) -> bytes:
    """Pull roughly `seconds` of audio from the stream into memory."""
    seconds = max(3, min(seconds, MAX_SECONDS))
    # Rough byte budget: assume up to ~40 KB/s (320 kbps) and add headroom.
    budget = min(MAX_BYTES, seconds * 48_000)
    chunks = bytearray()
    timeout = aiohttp.ClientTimeout(total=CAPTURE_TIMEOUT)
    connector = aiohttp.TCPConnector(ssl=_SSL_CTX)
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        async with session.get(url, headers={"User-Agent": "shazam-radio/0.1"}) as resp:
            resp.raise_for_status()
            async for chunk in resp.content.iter_chunked(16_384):
                chunks.extend(chunk)
                if len(chunks) >= budget:
                    break
    return bytes(chunks)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/recognize")
async def recognize(req: RecognizeRequest):
    try:
        audio = await capture(req.url, req.seconds)
    except Exception as e:  # noqa: BLE001 — surface any capture failure as 503
        return _error(f"capture failed: {e}")

    if len(audio) < 20_000:
        return _error("captured too little audio")

    try:
        shazam = Shazam()
        result = await shazam.recognize(audio)
    except Exception as e:  # noqa: BLE001
        return _error(f"recognition failed: {e}")

    track = (result or {}).get("track")
    if not track:
        return {"match": False}

    artist = track.get("subtitle") or ""
    title = track.get("title") or ""
    raw = f"{artist} - {title}".strip(" -") if artist else title

    images = track.get("images") or {}
    cover = (
        images.get("coverarthq")
        or images.get("coverart")
        or (track.get("share") or {}).get("image")
        or ""
    )
    hub = track.get("hub") or {}
    shazam_url = (track.get("share") or {}).get("href") or track.get("url") or ""

    return {
        "match": True,
        "artist": artist,
        "title": title,
        "raw": raw,
        "cover": cover,
        "shazamUrl": shazam_url,
        "appleMusicUrl": extract_apple_music_url(hub),
        "previewUrl": extract_preview_url(hub),
        "key": str(track.get("key") or ""),
    }


def _error(message: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=503, content={"error": message})


# Allow `python main.py` for convenience (run.sh uses uvicorn directly).
if __name__ == "__main__":
    import uvicorn

    with contextlib.suppress(KeyboardInterrupt):
        uvicorn.run(app, host="127.0.0.1", port=8755)
