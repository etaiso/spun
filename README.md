# shazam-radio

Listen to live internet radio and see what's playing — even when the station
doesn't tell you.

Stations are discovered through [radio-browser.info](https://www.radio-browser.info/).
The current song comes from the station's broadcast metadata when available
(in-band ICY `StreamTitle`); when a station doesn't name its songs, the app
falls back to **fingerprinting the live audio with Shazam** to identify it.

## Features

- 🔎 **Command palette search** (`⌘K` / `Ctrl K`) with fuzzy matching, ranked
  by your region, recently played, and favorites.
- ⭐ **Favorites**, **Recently played**, and a region-aware **Popular** list —
  all persisted in the browser.
- 🎙️ **Now playing** with the current song, live session history, station
  cover art, and a sidebar marquee.
- ✦ **Shazam fallback** for stations that broadcast no song title.
- ⌨️ Keyboard shortcuts, auto-play toggle, persisted volume, and a region
  picker.

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

- The browser plays the stream directly via `<audio>`.
- A Next.js route opens its own connection with `Icy-MetaData: 1`, parses the
  interleaved `StreamTitle`, and pushes track changes to the browser over
  Server-Sent Events.
- When the metadata is empty or absent, the route asks the recognizer to
  fingerprint ~6 seconds of the live audio and returns the match (tagged
  "Identified by Shazam").

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm start        # serve the production build
npm test         # unit tests (Vitest)
npm run lint     # ESLint
```

## Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
radio-browser.info · ShazamIO.
