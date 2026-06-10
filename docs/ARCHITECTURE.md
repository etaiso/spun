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

### Timing the fingerprint loop

Metadata stations push title changes live, so nothing here applies to them —
this is only about stations the recognizer drives. Re-fingerprinting on a fixed
interval is wasteful (most polls land mid-song, unchanged) and laggy (a switch
isn't seen until the next tick). Instead the route **predicts when the song
ends** and times the next attempt to it (`app/lib/recognitionSchedule.ts`):

- Every Shazam match carries an **offset** — how far into the song the sample
  landed — and the route resolves the track's **duration** via a cached iTunes
  lookup (Shazam's result has none). Together: `remaining ≈ duration − offset`.
- **Coast** until the song is nearly over (capped at 120s), then **bracket** the
  boundary — probe every ~12s until the title actually changes — and re-sync.
- This is mid-song-aware: catching a track 2:30 into a 3:00 song schedules the
  next poll ~30s out, not a blind 60s. After the first match the loop locks onto
  the song boundaries, so each subsequent prediction starts near a song's start.
- Fallbacks keep it honest: no resolvable duration → a fixed 60s cadence; a
  no-match (ad break / talk) → retry in 30s; a radio edit that overruns the
  catalog length (offset past duration) is treated as "at the boundary" so
  recognition never goes silent. Capture-then-recognize takes ~6s, so polls are
  floored at 10s.

### Why the recognizer is a separate process

Shazam recognition uses [ShazamIO](https://github.com/shazamio/ShazamIO), an
async Python library that depends on `ffmpeg` — neither fits inside the Next.js
(Node) runtime, so it runs as a small local HTTP service the app calls. The app
discovers it via the `RECOGNIZER_URL` env var (default `http://127.0.0.1:8755`)
and works fine without it; you just lose Shazam results on stations that lack
broadcast metadata. See [`recognizer/README.md`](../recognizer/README.md).

## Timeshift (rewind live radio)

```
Radio station ──► StationTee (one upstream per station)
                     ├─► titles ──► /api/now-playing SSE (ts=1|disk)
                     ├─► DiskRing (tracked stations, ≤5) ── seg-*.bin files
                     └─► /api/timeshift ── framed bytes ──► browser engine
                                                              ├─► RamRing (1 hr / 150 MB)
                                                              └─► MSE SourceBuffer (sliding window)
```

- A server-side `StationTee` owns the single upstream connection per station and
  fans audio out to the now-playing SSE (titles), an optional per-station disk
  ring, and any number of `/api/timeshift` playback feeds. One connection means
  song timestamps align with the audio buffer to sub-second.
- Every chunk travels framed as `[f64 LE wallClockMs][u32 LE len][payload]`
  (`app/lib/timeshift/framing.ts`) — the in-band wall clock is what makes seeks
  and jump-to-song exact, on the wire and on disk. The stamp is *media time*
  (broadcast wall-clock of the chunk's newest sample, derived from the stream
  bitrate by `app/lib/server/mediaClock.ts`), not arrival time — Icecast's
  bursty delivery would otherwise compress ~60 s of burst-on-connect audio
  into seconds of stamp span.
- The browser plays through MSE (`SourceBuffer`, `mode: 'sequence'`); the
  authoritative client store is a 1-hour RAM ring, with the SourceBuffer holding
  only a small window around the playhead. Seeks resolve fastest-tier-first:
  window → RAM ring → disk ring. Unsupported formats (Ogg/HLS) silently fall
  back to the plain `<audio src=/api/stream>` path, as does any engine error.
- Disk rings are session-only: segment files (60 s each, GC'd to ≤60 / ≤150 MB
  per station) live under `data/timeshift/` in dev or `<userData>/timeshift/`
  in the desktop app, wiped on boot and on quit. Untracking a station deletes
  its ring immediately.
- The "Rewind live radio" setting (default on) gates the whole feature; off
  reverts to the exact pre-timeshift code paths.

## API routes

| Route | Purpose |
|-------|---------|
| `GET /api/search?q=&region=` | radio-browser search proxy; region + global candidate pool, 60s cache |
| `GET /api/popular?region=` | Top stations (region-first), 5-min cache |
| `GET /api/now-playing?url=&ts=&sid=` | SSE stream of track changes (ICY metadata + Shazam fallback); `ts=1\|disk` rides the station tee |
| `GET /api/stream?url=` | Same-origin audio proxy (enables Web Audio analysis) |
| `GET /api/timeshift?url=&sid=&from=` | Framed timeshift audio (disk history burst + live follow); `DELETE ?sid=` drops a ring |
| `GET /api/timeshift-stats` | Tee + disk-ring diagnostics for the debug panel |
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
