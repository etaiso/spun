# shazam-radio

Listen to live internet radio and see what's playing — even when the station
doesn't tell you.

Stations are discovered through [radio-browser.info](https://www.radio-browser.info/).
The current song comes from the station's broadcast metadata when available
(in-band ICY `StreamTitle`); when a station doesn't name its songs, the app
falls back to **fingerprinting the live audio with Shazam** to identify it.

## Features

- 🔎 **Command palette search** (`⌘K` / `Ctrl K`), Raycast-style with a glass
  overlay, fuzzy matching, and results ranked by your region, recently played,
  and favorites. Empty query shows your recently played stations.
- ⭐ **Favorites** and a region-aware **Popular** list, persisted in the
  browser. Duplicate entries (the same station submitted to radio-browser more
  than once) are collapsed, while staying searchable by any of their names.
- 🎙️ **Now playing** with the current song and **album cover art** — from
  Shazam, with an iTunes Search fallback for broadcast-metadata tracks — plus a
  **playlist history** that's restored when you reload or switch back to a
  station (within 5 minutes). The active station + song also appear in the
  browser tab title.
- 〰️ **Audio-reactive canvas** — concentric "radio wave" rings behind the
  player that pulse to the live audio (Web Audio analyser), with a gentle
  timed fallback when a stream can't be analysed (toggle off in Settings).
- ✦ **Shazam fallback** for stations that broadcast no song title.
- 📡 **Background tracking** — track multiple stations at once and watch what's
  playing on each in a live monitor panel beside the player (recognised in the
  background, no audio). The station you're listening to stays in the list,
  highlighted as "Playing". Add/remove from a station's right-click menu.
- 💾 **Saved songs** — save any recognized track to a personal, persisted
  playlist (top-bar button, or the `S` shortcut). Each entry links to **Apple
  Music**, plays a ~30s preview (at the player's volume, pausing the radio), and
  is fuzzy-searchable. Previews come from Shazam or an iTunes lookup, backfilled
  for older entries when the list is opened.
- ⚙️ **Settings** (gear in the top bar): **localization**, **region-only mode**
  (filter every list to a single country), a **pulse-rings** toggle, and
  **hidden stations**.
- 🙈 **Hide stations** — right-click any station in the sidebar to banish it
  from search, favorites, popular and recent; restore it from Settings.
- 🌍 **Region detection** from your IP (with a browser-locale fallback), shown
  in the top bar and overridable in Settings — drives search/Popular ranking.
- 🔁 Reopens your **last played station** on reload.
- ⌨️ Keyboard shortcuts (play/pause, mute, volume, prev/next favorite, search,
  saved songs, help), scroll-to-change-volume over the slider, an auto-play
  toggle (off by default), and persisted volume.

## Requirements

- Node.js 18+
- For the Shazam fallback only: Python 3.10+ and `ffmpeg`
  (`brew install ffmpeg` on macOS)

## Running

### 1. The web app

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

This is fully functional on its own: stations that broadcast song titles show
them, and stations that don't show "No song info right now."

### 2. The Shazam recognizer (optional)

To identify songs on stations that don't broadcast a title, run the recognizer
sidecar in a second terminal:

```bash
./recognizer/run.sh
```

First run creates a Python virtualenv and installs dependencies; later runs are
instant. It listens on `http://127.0.0.1:8755`.

The app discovers it via the `RECOGNIZER_URL` env var (default
`http://127.0.0.1:8755`). **It's entirely optional** — if the recognizer isn't
running, the app still works; you just won't get Shazam results on stations
that lack broadcast metadata. See [`recognizer/README.md`](recognizer/README.md)
for details.

> Why a separate process? Shazam recognition uses [ShazamIO](https://github.com/shazamio/ShazamIO),
> an async Python library that depends on `ffmpeg` — neither fits inside the
> Next.js (Node) runtime, so it runs as a small local HTTP service the app
> calls.

### 3. Desktop app (optional)

The same app packages as a self-contained desktop app (macOS + Windows) via
Electron — the Next server + recognizer are bundled and state lives in SQLite at
the OS user-data dir. Run it in dev with `npm run electron:dev`.

Prebuilt installers (macOS Apple Silicon / Intel `.dmg`, Windows `.exe`) are
published to [**Releases**](https://github.com/etaiso/shazam-radio/releases) by
CI on every version tag, and the app auto-updates from there. Building,
code-signing, and the full release flow are documented in
[`docs/DESKTOP.md`](docs/DESKTOP.md).

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

### API routes

| Route | Purpose |
|-------|---------|
| `GET /api/search?q=&region=` | radio-browser search proxy; region + global candidate pool, 60s cache |
| `GET /api/popular?region=` | Top stations (region-first), 5-min cache |
| `GET /api/now-playing?url=` | SSE stream of track changes (ICY metadata + Shazam fallback) |
| `GET /api/stream?url=` | Same-origin audio proxy (enables Web Audio analysis) |
| `GET /api/state` · `PUT /api/state` | Read all / upsert persisted app state (SQLite) |

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm start        # serve the production build
npm test         # unit tests (Vitest)
npm run lint     # ESLint
```

## Tech stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** (strict)
- **Tailwind CSS v4**
- **SQLite** (`better-sqlite3`) — durable local persistence behind `/api/state`
- **Electron** (electron-builder + electron-updater) — desktop packaging &
  auto-update; see [`docs/DESKTOP.md`](docs/DESKTOP.md)
- **Web Audio API** — `AnalyserNode` for the audio-reactive visualiser
- **Server-Sent Events** — live now-playing updates
- **Vitest** — unit tests (ICY parser, ranking, station normalizer, …)
- **[radio-browser.info](https://www.radio-browser.info/)** — station directory
- **Recognizer sidecar:** Python · [FastAPI](https://fastapi.tiangolo.com/) ·
  [Uvicorn](https://www.uvicorn.org/) · [ShazamIO](https://github.com/shazamio/ShazamIO) ·
  `ffmpeg`

State (favorites, saved songs, recently played, tracked stations, volume,
auto-play, region + region-only mode, hidden stations) is persisted in a local
**SQLite** database (`better-sqlite3`) via the `/api/state` route, with
`localStorage` kept as a synchronous cache and a one-time import of any
pre-existing `localStorage` data on first load. So it survives clearing browser
data. The dev DB lives at `data/app_state.db`; the desktop app stores it in the
OS user-data dir. The short-lived per-station now-playing cache stays in
`localStorage` only. No accounts.

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
