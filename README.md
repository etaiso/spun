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

- 🪄 **Smart song recognition** — on stations that don't broadcast titles, Spun
  fingerprints the live audio with Shazam and predicts when each song ends, so it
  catches the next track the moment it starts.
- 🔎 **Command palette search** (`⌘K` / `Ctrl K`) with fuzzy matching and
  results ranked by your region, recently played, and favorites.
- 🧭 **Explore** — browse the catalogue by **country** and **genre**, or combine
  both (e.g. *jazz + blues in Germany*), with searchable pickers and multi-genre
  filters. A docked mini-player keeps your station playing while you browse.
- 🎙️ **Now playing** with the current song and **album cover art**, plus a
  **playlist history** restored when you reload or switch back to a station.
- ⏪ **Rewind live radio** — scrub back up to **an hour** on any live station:
  drag the timeline to seek, jump straight to any song still in the buffer, and
  snap back to the **LIVE** edge. Audio is bit-identical to live with no added
  latency.
- 📡 **Background tracking** — track multiple stations at once and watch what's
  playing on each in a live monitor panel, no audio needed.
- 💾 **Saved songs** — save any recognized track to a persisted playlist with a
  ~30s preview and an **Apple Music** link.
- ⭐ **Favorites** and a **Popular** list personalized to your taste — ranked by
  the genres you listen to most and your region.

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

Append `?debug=true` to the URL to reveal a diagnostics panel in Settings (web
only — it's never shown in the desktop app).

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
**SQLite** · **Electron** · **Web Audio API** · **Media Source Extensions** ·
**Server-Sent Events** · a **Python/ShazamIO** recognizer sidecar.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how song detection works,
the API routes, persistence, and the project layout.

## Disclaimer

Spun is an independent, hobby project. It is **not affiliated with, endorsed
by, or sponsored by** Apple Inc., Shazam, or radio-browser.info.

The optional song-recognition fallback uses [ShazamIO](https://github.com/shazamio/ShazamIO),
an **unofficial, third-party** library that talks to Shazam's service.
"Shazam" is a trademark of its respective owner and is used here only to
describe what that optional component does. The recognizer is disabled unless
you choose to run it, and the app is fully functional without it. Use of any
third-party service is subject to that service's own terms.

## Acknowledgements

- **[radio-browser.info](https://www.radio-browser.info/)** — the community
  station directory that powers search and the Popular list.
- **[iTunes Search API](https://performance-partners.apple.com/search-api)** —
  cover art, ~30s previews, and Apple Music links.
- **[ShazamIO](https://github.com/shazamio/ShazamIO)** and **[FFmpeg](https://ffmpeg.org/)**
  — the optional audio-fingerprinting recognizer.

A fuller list of bundled components and their licenses is in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Etai Solomon. Bundled and third-party components retain
their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
