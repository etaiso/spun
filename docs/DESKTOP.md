# Desktop app (Electron)

The web app ships as a self-contained desktop app (macOS + Windows) via Electron.
In production, the Electron main process spawns the Next.js **standalone server**
(`.next/standalone/server.js`) and the bundled **recognizer** sidecar, then loads
a window. State is stored in **SQLite** at the OS user-data dir, so it survives
clearing browser data.

- macOS: `~/Library/Application Support/Shazam Radio/app_state.db`
- Windows: `%APPDATA%/Shazam Radio/app_state.db`

## Develop

```bash
npm run electron:dev      # runs `next dev` + opens an Electron window at :3000
```
In dev the window just loads `localhost:3000` (no server/recognizer spawned), so
`better-sqlite3` runs under normal Node — no native rebuild needed.

## Build prerequisites

- Node 18+, plus native build tools (macOS: `xcode-select --install`; Windows:
  the "Desktop development with C++" workload).
- Python 3.10+ to freeze the recognizer.
- A platform `ffmpeg` binary (static, LGPL/GPL-clean build) for redistribution.

## Build steps (run on each target OS — outputs are per-platform)

```bash
# 1) Freeze the recognizer + stage ffmpeg
./scripts/build-recognizer.sh
mkdir -p dist-ffmpeg && cp "$(which ffmpeg)" dist-ffmpeg/   # or a static build

# 2) Build + package the app
npm run electron:build     # electron:rebuild → next build → electron-builder
```

`electron:build` runs in this order on purpose:
1. **`electron-rebuild`** rebuilds `better-sqlite3` against Electron's Node ABI.
2. **`next build`** then traces that Electron-ABI binary into `.next/standalone`.
3. **`electron-builder`** packages everything (`extraResources`: the standalone
   server, `recognizer`, and `ffmpeg`).

> **Native-module gotcha:** after `electron:build`, `node_modules/better-sqlite3`
> is on Electron's ABI, so `npm test` / `npm run dev` will fail to load it until
> you restore the Node ABI:
> ```bash
> npm rebuild better-sqlite3
> ```

## Code signing + notarization (macOS) — required for distribution

Auto-update and a warning-free install need a Developer ID cert + notarization.
Set these env vars before `npm run electron:build`:

```bash
export CSC_LINK=...                      # path/base64 of the Developer ID .p12
export CSC_KEY_PASSWORD=...              # its password
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=...   # app-specific password
export APPLE_TEAM_ID=XXXXXXXXXX
```
The `afterSign` hook (`electron/notarize.js`) is a no-op when `APPLE_ID` is unset,
so unsigned local builds still complete. Windows signing is optional (a cert just
removes the SmartScreen prompt).

Verify a notarized macOS build:
```bash
spctl -a -vv "/Applications/Shazam Radio.app"   # → accepted, source=Notarized Developer ID
```

## Release / auto-update

`electron-updater` checks **GitHub Releases** on launch (production only).

1. Bump `version` in `package.json`.
2. `GH_TOKEN=<token> npm run electron:build` — electron-builder publishes the
   installers + `latest-mac.yml` / `latest.yml` to GitHub Releases.
3. Installed apps download the update in the background and apply it on restart.
   The DB **migration runner** runs on first launch of the new version, so user
   data is preserved across updates.
