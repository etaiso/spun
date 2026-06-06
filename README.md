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
  ~30s preview and an **Apple Music** link. **Export** the list as **CSV / M3U8**
  (import anywhere), or connect **Spotify** to auto-sync saves into a private
  "Spun" playlist.
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

### 4. Spotify playlist export (optional, desktop only)

Saved songs always export to **CSV / M3U8** (no setup). To additionally **auto-sync**
them into a private **"Spun"** Spotify playlist, set a Spotify app client id:

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
   choose the **Web API**, and add the redirect URI **`http://127.0.0.1:8888/callback`**.
   Copy the **Client ID** (PKCE — no client secret needed).
2. Set it before launching the desktop app: `SPOTIFY_CLIENT_ID=xxx npm run electron:dev`
   (or via `.env` — see [`.env.example`](.env.example)).
3. In the app: **Settings → Spotify → Connect**.

> **Caveats (Spotify, since Feb 2026):** the Web API requires the **app owner to
> have Spotify Premium**, and a Development-Mode app is limited to **5 authorized
> users**. This is therefore a personal / small-group feature, not something the
> bundled app ships enabled. The integration stays hidden unless `SPOTIFY_CLIENT_ID`
> is set.

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
