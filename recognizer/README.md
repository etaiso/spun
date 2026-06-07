# Shazam recognizer sidecar

A small Python service that powers the app's song-detection fallback. When a
station's broadcast metadata doesn't name the current song (empty `StreamTitle`,
or no metadata channel at all), the Next.js app asks this service to fingerprint
a few seconds of the live stream with [ShazamIO](https://github.com/shazamio/ShazamIO)
and identify the track.

It runs as a **separate process** because ShazamIO is async Python and depends
on `ffmpeg` for audio decoding — neither fits inside the Next.js (Node) runtime.

## Prerequisites

- Python 3.10+
- `ffmpeg` on your PATH (`brew install ffmpeg` on macOS)

## Run

```bash
./recognizer/run.sh
```

First run creates a virtualenv and installs dependencies; subsequent runs are
instant. The service listens on `http://127.0.0.1:8755`.

The Next.js app finds it via the `RECOGNIZER_URL` env var (default
`http://127.0.0.1:8755`). **If this service isn't running, the app still works**
— stations that broadcast song titles show them normally, and stations that
don't simply show "No song info right now" instead of a Shazam result.

## API

```
GET  /health                      -> { "ok": true }
POST /recognize  { "url", "seconds" }
     -> { "match": true, "artist", "title", "raw",
          "offset", "durationMs" }                    identified
     -> { "match": false }                            no match
     -> 503 { "error" }                               capture/recognition failed
```

`offset` (seconds into the song the sample matched) and `durationMs` (full track
length, resolved via a cached iTunes lookup) let the app predict when the song
ends and time its next fingerprint instead of polling blindly — either may be
null when unavailable. See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Notes

- macOS python.org builds don't trust the system cert store; `run.sh` points
  `SSL_CERT_FILE` at certifi's bundle so HTTPS to stream CDNs and Shazam works.
- Recognition takes ~6–8s (it captures ~6s of audio, then fingerprints).
