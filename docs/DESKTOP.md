# Desktop app (Electron)

The web app ships as a self-contained desktop app (macOS + Windows) via Electron.
In production, the Electron main process spawns the Next.js **standalone server**
(`.next/standalone/server.js`) and the bundled **recognizer** sidecar, then loads
a window. State is stored in **SQLite** at the OS user-data dir, so it survives
clearing browser data.

The user-data dir is named from the package.json `name` (`spun`), not
the display name:
- macOS: `~/Library/Application Support/spun/` (holds `app_state.db` and,
  in builds with logging, `desktop.log`)
- Windows: `%APPDATA%/spun/`

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

> **Electron version is pinned (`^35`) on purpose.** `better-sqlite3@12.10.0`
> doesn't compile against the V8 in Electron 37+ (the mandatory external-pointer
> "tag" API: `External::New(isolate, value, tag)`). Don't bump Electron past what
> `better-sqlite3` supports without checking that `npm run electron:rebuild`
> still compiles — otherwise the packaged app crashes on launch.

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
spctl -a -vv "/Applications/Spun.app"   # → accepted, source=Notarized Developer ID
```

## Release / auto-update

Releases are built in CI and published to **GitHub Releases**, one Release per
version tag. `electron-updater` checks that Release feed on launch (production
only) and updates installed apps in the background.

### Cutting a release (the normal path)

```bash
# 1) Bump the version, commit it
npm version patch        # or minor / major — edits package.json + makes a commit
# 2) Push the commit and the tag it created (e.g. v0.2.0)
git push && git push --tags
```

Pushing the `v*` tag triggers `.github/workflows/release.yml`, a build matrix
that runs once per target and publishes to a **draft** Release named after the
tag:

| Runner | Artifact | Auto-update |
| --- | --- | --- |
| `macos-14` (Apple Silicon) | `…-arm64.dmg` + `…-arm64-mac.zip` | ✅ via `latest-mac.yml` |
| `macos-13` (Intel) | `…-x64.dmg` | ❌ manual download (see below) |
| `windows-latest` | `…Setup….exe` (NSIS) | ✅ via `latest.yml` |

Each runner freezes its **own** recognizer (PyInstaller can't cross-compile) and
stages its own ffmpeg (via the `ffmpeg-static` npm package), then runs
`electron-builder --publish always`. The job uses the built-in `GITHUB_TOKEN`
(the workflow grants it `contents: write`) — no PAT needed.

**After the matrix finishes:** open the draft Release on GitHub, sanity-check the
attached files, and click **Publish**. Installed apps then download the update on
next launch and apply it on restart. The DB **migration runner** runs on first
launch of the new version, so user data is preserved across updates.

`workflow_dispatch` is also enabled, so you can trigger a build manually from the
Actions tab (it publishes to the `v<version>` draft) without pushing a tag.

### Builds are unsigned (Phase 1)

The pipeline produces **unsigned** installers, so on first open users must
click through Gatekeeper (macOS: right-click → Open) / SmartScreen (Windows:
More info → Run anyway). To remove those prompts, add the signing secrets from
the section above as GitHub **repository secrets** (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)
and expose them as `env:` on the *Package + publish* step — no code changes
needed; `electron/notarize.js` activates once `APPLE_ID` is present.

### Intel Mac auto-update (deferred)

The Intel (`x64`) job builds a `.dmg` only. A `.zip` would generate its own
`latest-mac.yml` and **clobber** the arm64 one on the shared Release (a single
file name per Release), breaking arm64 auto-update. So Intel users download each
new `.dmg` manually for now. Full dual-arch auto-update needs a follow-up step
that uploads each arch's `latest-mac.yml` under a unique name and merges them
into one canonical file — left for a later phase.

### Local one-off build (no CI)

To build + publish from your own machine instead of CI:

```bash
./scripts/build-recognizer.sh
mkdir -p dist-ffmpeg && cp "$(which ffmpeg)" dist-ffmpeg/
GH_TOKEN=<token> npm run electron:build -- --publish always
```
This only produces artifacts for *your* OS/arch — CI is how you get all three.
