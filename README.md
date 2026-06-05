<p align="center">
  <img src="docs/spun-logo.svg" alt="Spun" width="180" />
</p>

<p align="center">
  Listen to live internet radio and see what's playing — even when the station doesn't tell you.
</p>

Stations are discovered through [radio-browser.info](https://www.radio-browser.info/).
The current song comes from the station's broadcast metadata when available
(in-band ICY `StreamTitle`); when a station doesn't name its songs, the app
falls back to **fingerprinting the live audio with Shazam** to identify it.

## Features

- 🔎 **Command palette search** (`⌘K` / `Ctrl K`) with fuzzy matching and
  results ranked by your region, recently played, and favorites.
- 🎙️ **Now playing** with the current song and **album cover art**, plus a
  **playlist history** restored when you reload or switch back to a station.
- 〰️ **Audio-reactive visualiser** — "radio wave" rings behind the player that
  pulse to the live audio (Web Audio analyser).
- 📡 **Background tracking** — track multiple stations at once and watch what's
  playing on each in a live monitor panel, no audio needed.
- 💾 **Saved songs** — save any recognized track to a persisted playlist with a
  ~30s preview and an **Apple Music** link.
- ⭐ **Favorites** and a region-aware **Popular** list, with duplicate stations
  collapsed but still searchable by any of their names.
- 🙈 **Hide stations** to banish them from every list, **region-only mode** to
  filter to a single country, and other knobs in **Settings**.
- ⌨️ **Keyboard & media-key shortcuts** — play/pause, mute, volume, switch
  favorites, search, saved songs; the OS "Now Playing" panel reflects the track.

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
instant. It listens on `http://127.0.0.1:8755`. **It's entirely optional** — if
it isn't running, the app still works; you just won't get Shazam results on
stations that lack broadcast metadata. See
[`recognizer/README.md`](recognizer/README.md) for details.

### 3. Desktop app (optional)

The same app packages as a self-contained desktop app (macOS + Windows) via
Electron — the Next server + recognizer are bundled and state lives in SQLite at
the OS user-data dir. Run it in dev with `npm run electron:dev`.

Prebuilt installers (macOS Apple Silicon `.dmg`, Windows `.exe`) are
published to [**Releases**](https://github.com/etaiso/spun/releases) by
CI on every version tag, and the app auto-updates from there. (Intel macOS is
not built yet — GitHub's Intel runners are being retired; see the docs.)
Building, code-signing, and the full release flow are documented in
[`docs/DESKTOP.md`](docs/DESKTOP.md).

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm start        # serve the production build
npm test         # unit tests (Vitest)
npm run lint     # ESLint
```

## Tech stack

**Next.js 16** · **React 19** · **TypeScript** · **Tailwind CSS v4** ·
**SQLite** · **Electron** · **Web Audio API** · **Server-Sent Events** ·
a **Python/ShazamIO** recognizer sidecar.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how song detection works,
the API routes, persistence, and the project layout.
