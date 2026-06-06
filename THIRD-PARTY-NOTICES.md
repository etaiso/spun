# Third-Party Notices

Spun is distributed under the [MIT License](LICENSE). It depends on, and its
desktop installers bundle, third-party software covered by their own licenses.
This file summarizes the notable components and their terms. It is not
exhaustive — see each package's own license text (in `node_modules/`,
`recognizer/requirements.txt`, and the bundled runtimes) for the authoritative
terms.

## Bundled in the desktop app (installers)

| Component | Role | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) | Desktop shell + bundled Chromium/Node | MIT (Electron); Chromium ships its own `LICENSES.chromium.html` |
| [FFmpeg](https://ffmpeg.org/) | Audio decoding for the recognizer | LGPL-2.1+ (LGPL build, no GPL/nonfree components) |
| [Python](https://www.python.org/) runtime (frozen via [PyInstaller](https://pyinstaller.org/)) | Runs the recognizer sidecar | PSF License; PyInstaller is GPL **with a bootloader exception** permitting redistribution of frozen apps under any license |
| [ShazamIO](https://github.com/shazamio/ShazamIO) | Audio fingerprinting client | MIT |
| [FastAPI](https://fastapi.tiangolo.com/) · [uvicorn](https://www.uvicorn.org/) · [aiohttp](https://docs.aiohttp.org/) · [certifi](https://github.com/certifi/python-certifi) | Recognizer HTTP service + TLS roots | MIT · BSD-3-Clause · Apache-2.0 · MPL-2.0 |

### FFmpeg (LGPL) — relinking notice

The bundled `ffmpeg` is an LGPL build invoked as a standalone executable (a
separate process — it is not linked into Spun). In keeping with the LGPL, you
may replace it: delete the bundled binary under the app's resources and supply
your own compatible `ffmpeg` build. FFmpeg's source and license are available
at <https://ffmpeg.org/> and <https://git.ffmpeg.org/ffmpeg.git>.

## Application dependencies (npm)

Next.js, React, React-DOM, Tailwind CSS, better-sqlite3, electron-builder,
electron-updater, ESLint, Vitest, and zod are distributed under the **MIT
License**. TypeScript is **Apache-2.0**. SQLite (via better-sqlite3) is in the
**public domain**. Full license texts ship in each package's directory under
`node_modules/`.

## Third-party services

Spun calls the following services at runtime. They are not bundled, but users
and redistributors should be aware of their terms:

- **[radio-browser.info](https://www.radio-browser.info/)** — station directory.
  Community-run; station data is dedicated to the public domain (CC0). Spun
  sends a descriptive `User-Agent` and respects the API's rate limits.
- **[iTunes Search API](https://performance-partners.apple.com/search-api)** —
  cover art, ~30s previews, and Apple Music links. Used to surface and link
  Apple content per Apple's API terms.
- **Shazam** (via the unofficial ShazamIO library) — see the disclaimer in the
  [README](README.md#disclaimer). Not affiliated with or endorsed by Apple or
  Shazam.
