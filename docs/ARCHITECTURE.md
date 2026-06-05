# Architecture

Technical notes on how Spun is put together. For setup and a feature tour, see
the [README](../README.md).

## How song detection works

```
Browser ── plays audio ─────────────────────────► Radio station
   │
   └── EventSource(/api/now-playing) ─► Next.js route ─► Radio station (ICY metadata)
                                              │
                                  empty / no metadata?
                                              │
                                              └─► POST /recognize ─► Shazam recognizer (Python)
```

- The browser plays the stream through `/api/stream`, a same-origin proxy.
  This serves two purposes: it sidesteps mixed-content / playlist quirks, and
  it lets the Web Audio API analyse the waveform to drive the reactive rings
  (cross-origin streams can't be analysed).
- A Next.js route (`/api/now-playing`) opens its own connection with
  `Icy-MetaData: 1`, parses the interleaved `StreamTitle`, and pushes track
  changes to the browser over Server-Sent Events.
- When the metadata is empty or absent, the route asks the recognizer to
  fingerprint ~6 seconds of the live audio and returns the match (tagged
  "Identified by Shazam") along with its cover art. Broadcast-metadata tracks
  that carry no art get a cover from the iTunes Search API.

### Why the recognizer is a separate process

Shazam recognition uses [ShazamIO](https://github.com/shazamio/ShazamIO), an
async Python library that depends on `ffmpeg` — neither fits inside the Next.js
(Node) runtime, so it runs as a small local HTTP service the app calls. The app
discovers it via the `RECOGNIZER_URL` env var (default `http://127.0.0.1:8755`)
and works fine without it; you just lose Shazam results on stations that lack
broadcast metadata. See [`recognizer/README.md`](../recognizer/README.md).

## API routes

| Route | Purpose |
|-------|---------|
| `GET /api/search?q=&region=` | radio-browser search proxy; region + global candidate pool, 60s cache |
| `GET /api/popular?region=` | Top stations (region-first), 5-min cache |
| `GET /api/now-playing?url=` | SSE stream of track changes (ICY metadata + Shazam fallback) |
| `GET /api/stream?url=` | Same-origin audio proxy (enables Web Audio analysis) |
| `GET /api/state` · `PUT /api/state` | Read all / upsert persisted app state (SQLite) |

## Persistence

State (favorites, saved songs, recently played, tracked stations, volume,
auto-play, region + region-only mode, hidden stations) is persisted in a local
**SQLite** database (`better-sqlite3`) via the `/api/state` route, with
`localStorage` kept as a synchronous cache and a one-time import of any
pre-existing `localStorage` data on first load. So it survives clearing browser
data. The dev DB lives at `data/app_state.db`; the desktop app stores it in the
OS user-data dir. The short-lived per-station now-playing cache stays in
`localStorage` only. No accounts.

## Tech stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** (strict)
- **Tailwind CSS v4**
- **SQLite** (`better-sqlite3`) — durable local persistence behind `/api/state`
- **Electron** (electron-builder + electron-updater) — desktop packaging &
  auto-update; see [`DESKTOP.md`](DESKTOP.md)
- **Web Audio API** — `AnalyserNode` for the audio-reactive visualiser
- **Server-Sent Events** — live now-playing updates
- **Vitest** — unit tests (ICY parser, ranking, station normalizer, …)
- **[radio-browser.info](https://www.radio-browser.info/)** — station directory
- **Recognizer sidecar:** Python · [FastAPI](https://fastapi.tiangolo.com/) ·
  [Uvicorn](https://www.uvicorn.org/) · [ShazamIO](https://github.com/shazamio/ShazamIO) ·
  `ffmpeg`

## Project layout

```
app/
  api/{search,popular,now-playing,stream,state}/  route handlers
  components/                               UI (player, sidebar, palette, …)
  lib/                                      icy parser, ranking, stores, audio bus
  lib/db/                                   SQLite connection + migrations + queries
electron/                                   desktop shell (main, preload, notarize)
recognizer/                                 Python ShazamIO sidecar (+ PyInstaller spec)
scripts/                                    build-recognizer.sh
tests/                                      Vitest unit tests
docs/                                       DESKTOP.md + superpowers specs/plans
```
