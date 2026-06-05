# Electron Desktop Shell + Auto-Update + Bundled Recognizer — Implementation Plan (Spec 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Package the existing Next.js app as a self-contained, auto-updating desktop app (macOS + Windows) with the Shazam recognizer bundled, persisting state in SQLite at the OS user-data dir.

**Architecture:** Electron `main` (CommonJS) boots in production by spawning the **Next standalone server** (`.next/standalone/server.js`) on a free port using Electron's own Node (`ELECTRON_RUN_AS_NODE`, so the native `better-sqlite3` ABI matches), spawning the **PyInstaller-frozen recognizer** sidecar (with bundled `ffmpeg`) on another free port, then loading a `BrowserWindow` at the app URL. In dev it skips spawning and loads `http://localhost:3000`. Packaging is `electron-builder`; updates are `electron-updater` against GitHub Releases; macOS is signed + notarized.

**Tech Stack:** Electron, electron-builder, electron-updater, @electron/notarize, @electron/rebuild, Next 16 standalone output, PyInstaller, ffmpeg.

**Branch:** `claude/desktop-electron-shell` (off `main`, which now has Spec 1). Repo root: `/path/to/shazam-radio`.

## Feasibility / hand-off
The app-side scaffolding (Tasks 1–4, 6, 8, 9) is buildable and verifiable on a dev machine. The parts that **require the user's machine + credentials** and cannot be produced in a CI sandbox are flagged **[HAND-OFF]**: macOS Developer ID signing + notarization (Task 7), per-platform PyInstaller binaries + ffmpeg (Task 5), and publishing real GitHub Releases (Task 9). Verification for those is a documented manual checklist, not an automated test.

---

## File Structure
- `next.config.ts` — add `output: 'standalone'`.
- `electron/main.js` — main process: port allocation, server + recognizer spawn, window, lifecycle, updater.
- `electron/preload.js` — minimal contextIsolation preload (no API surface yet).
- `electron/notarize.js` — `afterSign` notarization hook (macOS). **[HAND-OFF]**
- `build/entitlements.mac.plist` — hardened-runtime entitlements (allow JIT for Node/Chromium).
- `electron-builder.yml` — packaging config (targets, extraResources, publish).
- `scripts/build-recognizer.sh` — PyInstaller freeze + ffmpeg fetch. **[HAND-OFF per platform]**
- `package.json` — `main` entry, electron scripts, `postinstall` rebuild, electron deps.
- `recognizer/recognizer.spec` — PyInstaller spec.
- `docs/DESKTOP.md` — build/sign/release runbook.

---

### Task 1: Next standalone output

**Files:** Modify `next.config.ts`

- [ ] **Step 1: Enable standalone output**

```ts
// next.config.ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
```

- [ ] **Step 2: Build and verify the standalone server exists**

Run: `npm run build`
Expected: `.next/standalone/server.js` exists, and `.next/standalone/node_modules/better-sqlite3` is present (traced because `/api/state` imports it):
```bash
ls .next/standalone/server.js && ls .next/standalone/node_modules/better-sqlite3
```

- [ ] **Step 3: Smoke-test the standalone server reads the DB env**

Run:
```bash
APP_DB_PATH=/tmp/desktop-smoke.db PORT=3210 HOSTNAME=127.0.0.1 \
  node .next/standalone/server.js &
sleep 3
curl -s -X PUT localhost:3210/api/state -H 'Content-Type: application/json' -d '{"key":"radio:smoke","value":"ok"}' -o /dev/null -w "%{http_code}\n"
curl -s localhost:3210/api/state | grep radio:smoke
kill %1
ls -la /tmp/desktop-smoke.db
```
Expected: `204`, the `radio:smoke` key present, and the DB file created at the custom path. (Confirms the standalone server honors `APP_DB_PATH` — the contract Electron relies on.)

- [ ] **Step 4: Commit**
```bash
git add next.config.ts
git commit -m "build(next): emit standalone server output for Electron packaging"
```

---

### Task 2: Electron toolchain + native rebuild

**Files:** Modify `package.json`

- [ ] **Step 1: Install Electron toolchain**

Run:
```bash
npm install -D electron electron-builder electron-updater @electron/notarize @electron/rebuild
```
(`electron-updater` is a runtime dep of the packaged app; electron-builder bundles it from devDeps fine.)

- [ ] **Step 2: Add the main entry + scripts to package.json**

Add `"main": "electron/main.js"` at top level, and these scripts:
```json
"electron:dev": "concurrently -k \"npm:dev\" \"wait-on tcp:3000 && electron .\"",
"electron:rebuild": "electron-rebuild -f -w better-sqlite3",
"electron:build": "npm run build && npm run electron:rebuild && electron-builder",
"postinstall": "electron-rebuild -f -w better-sqlite3 || true"
```
Install the two dev helpers: `npm install -D concurrently wait-on`.

Note: `postinstall` rebuilds `better-sqlite3` against Electron's ABI. The `|| true` keeps `npm install` from hard-failing on machines without Electron build prerequisites; the explicit `electron:rebuild` before packaging is the authoritative one.

- [ ] **Step 3: Verify rebuild runs**

Run: `npm run electron:rebuild`
Expected: exits 0; `node_modules/better-sqlite3/build/Release/better_sqlite3.node` rebuilt for Electron.

- [ ] **Step 4: Commit**
```bash
git add package.json package-lock.json
git commit -m "build(electron): add electron toolchain + better-sqlite3 rebuild"
```

---

### Task 3: Electron main process + preload

**Files:** Create `electron/main.js`, `electron/preload.js`

- [ ] **Step 1: Create `electron/preload.js`**

```js
// electron/preload.js
// Minimal preload — contextIsolation is on, no privileged API is exposed yet.
// Present so future native integration has a home.
```

- [ ] **Step 2: Create `electron/main.js`**

```js
// electron/main.js
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
let win = null;
let serverProc = null;
let recognizerProc = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForHttp(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`server on :${port} did not start`));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function startRecognizer() {
  const port = await getFreePort();
  const bin = process.platform === 'win32' ? 'recognizer.exe' : 'recognizer';
  const recognizerBin = path.join(process.resourcesPath, 'recognizer', bin);
  const ffmpegDir = path.join(process.resourcesPath, 'ffmpeg');
  recognizerProc = spawn(recognizerBin, [], {
    env: {
      ...process.env,
      RECOGNIZER_PORT: String(port),
      PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  });
  recognizerProc.on('error', (e) => console.error('recognizer failed to start:', e));
  return port;
}

async function startNextServer(recognizerPort) {
  const port = await getFreePort();
  const serverJs = path.join(process.resourcesPath, 'app', 'server.js');
  serverProc = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      APP_DB_PATH: path.join(app.getPath('userData'), 'app_state.db'),
      RECOGNIZER_URL: `http://127.0.0.1:${recognizerPort}`,
    },
    stdio: 'inherit',
  });
  serverProc.on('error', (e) => console.error('next server failed to start:', e));
  await waitForHttp(port);
  return port;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#faf7f2',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  // Open external links (Apple Music, Shazam) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  let url;
  if (isDev) {
    url = 'http://localhost:3000';
  } else {
    const recognizerPort = await startRecognizer();
    const appPort = await startNextServer(recognizerPort);
    url = `http://127.0.0.1:${appPort}`;
  }
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  await createWindow();
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) { console.error('updater init failed:', e); }
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { serverProc?.kill(); } catch {} try { recognizerProc?.kill(); } catch {} });
```

- [ ] **Step 3: Verify it launches in dev (manual)**

Run: `npm run electron:dev`
Expected: `next dev` starts, then an Electron window opens showing the app at `localhost:3000`; external links open in the system browser; closing the window quits (non-mac). This is a manual check — there is no automated GUI test.

- [ ] **Step 4: Commit**
```bash
git add electron/main.js electron/preload.js
git commit -m "feat(electron): main process — spawn next server + recognizer, window lifecycle"
```

---

### Task 4: Recognizer sidecar — dev fallback + graceful absence

**Files:** Modify `electron/main.js`

- [ ] **Step 1: Make a missing recognizer non-fatal**

The app already treats the recognizer as optional (no Shazam fallback if absent). Ensure `startRecognizer` never blocks window creation: it's already fire-and-spawn (we don't await its readiness, only the Next server's). Add a guard so a missing binary (e.g., a dev/unpackaged run without the frozen recognizer) logs and continues:

```js
async function startRecognizer() {
  const port = await getFreePort();
  const bin = process.platform === 'win32' ? 'recognizer.exe' : 'recognizer';
  const recognizerBin = path.join(process.resourcesPath, 'recognizer', bin);
  if (!require('node:fs').existsSync(recognizerBin)) {
    console.warn('recognizer binary not bundled; Shazam fallback disabled');
    return port; // RECOGNIZER_URL points here; calls just fail gracefully
  }
  const ffmpegDir = path.join(process.resourcesPath, 'ffmpeg');
  recognizerProc = spawn(recognizerBin, [], {
    env: { ...process.env, RECOGNIZER_PORT: String(port), PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ''}` },
    stdio: 'inherit',
  });
  recognizerProc.on('error', (e) => console.error('recognizer failed to start:', e));
  return port;
}
```

- [ ] **Step 2: Verify** — `npx eslint electron/main.js` (configure eslint to lint `electron/` as CommonJS Node, or add an override). Expected: clean.

- [ ] **Step 3: Commit**
```bash
git add electron/main.js
git commit -m "feat(electron): tolerate a missing recognizer binary"
```

---

### Task 5: Freeze the recognizer + bundle ffmpeg  **[HAND-OFF per platform]**

**Files:** Create `recognizer/recognizer.spec`, `scripts/build-recognizer.sh`

- [ ] **Step 1: PyInstaller spec**

```python
# recognizer/recognizer.spec
# Build: cd recognizer && pyinstaller recognizer.spec
a = Analysis(['main.py'], pathex=['.'], hiddenimports=['uvicorn', 'shazamio', 'aiohttp'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name='recognizer', console=True)
```

- [ ] **Step 2: Build script (freeze + fetch ffmpeg)**

```bash
#!/usr/bin/env bash
# scripts/build-recognizer.sh — produce dist/recognizer/<bin> + a static ffmpeg.
# Run on each target platform (PyInstaller output is per-OS/arch).
set -euo pipefail
cd "$(dirname "$0")/../recognizer"
python3 -m venv .build-venv
./.build-venv/bin/pip install --upgrade pip pyinstaller -r requirements.txt
./.build-venv/bin/pyinstaller recognizer.spec --distpath ../dist-recognizer --workpath /tmp/pyi-work -y
echo "Frozen recognizer at dist-recognizer/recognizer"
echo "NOTE: place a platform ffmpeg binary at dist-ffmpeg/ffmpeg (LGPL/GPL-clean build)."
```

- [ ] **Step 3: Verify (manual, per platform)** — run the script; confirm `dist-recognizer/recognizer` launches and serves: `RECOGNIZER_PORT=8799 ./dist-recognizer/recognizer &` then `curl localhost:8799/health` → `{"ok":true}`.

- [ ] **Step 4: Commit**
```bash
git add recognizer/recognizer.spec scripts/build-recognizer.sh
git commit -m "build(recognizer): PyInstaller freeze spec + build script"
```

---

### Task 6: electron-builder configuration

**Files:** Create `electron-builder.yml`

- [ ] **Step 1: Config**

```yaml
# electron-builder.yml
appId: com.shazamradio.app
productName: Shazam Radio
files:
  - electron/**
  - package.json
extraResources:
  - from: .next/standalone
    to: app
  - from: .next/static
    to: app/.next/static
  - from: public
    to: app/public
  - from: dist-recognizer
    to: recognizer
  - from: dist-ffmpeg
    to: ffmpeg
mac:
  category: public.app-category.music
  target: [dmg]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
win:
  target: [nsis]
publish:
  provider: github
  owner: etaiso
  repo: shazam-radio
afterSign: electron/notarize.js
```

- [ ] **Step 2: Entitlements**

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
```
(`disable-library-validation` is needed so the bundled, separately-built `better-sqlite3` and recognizer binaries load under hardened runtime.)

- [ ] **Step 3: Verify config parses** — `npx electron-builder --help` runs; `node -e "require('js-yaml')"` not required. Lint the YAML by running a dry pack on the dev platform without publish: `npx electron-builder --dir -c electron-builder.yml` (produces an unpacked app in `dist/`). **[HAND-OFF]** A full signed build needs Task 7.

- [ ] **Step 4: Commit**
```bash
git add electron-builder.yml build/entitlements.mac.plist
git commit -m "build(electron): electron-builder config + mac entitlements"
```

---

### Task 7: macOS signing + notarization  **[HAND-OFF — needs Apple Developer ID]**

**Files:** Create `electron/notarize.js`

- [ ] **Step 1: Notarize hook**

```js
// electron/notarize.js
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  if (!process.env.APPLE_ID) { console.log('notarize: APPLE_ID not set, skipping'); return; }
  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appBundleId: 'com.shazamradio.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
```

- [ ] **Step 2: Document the required env (in docs/DESKTOP.md, Task 9)** — `CSC_LINK`/`CSC_KEY_PASSWORD` (Developer ID cert), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

- [ ] **Step 3: Verify (manual, on a Mac with certs)** — `npm run electron:build`; the produced `.dmg` installs without Gatekeeper warnings and `spctl -a -vv "/Applications/Shazam Radio.app"` reports `accepted`/`source=Notarized Developer ID`.

- [ ] **Step 4: Commit**
```bash
git add electron/notarize.js
git commit -m "build(electron): macOS notarization afterSign hook"
```

---

### Task 8: Auto-update wiring (verify)

**Files:** none new (wired in Task 3 main.js)

- [ ] **Step 1: Confirm updater is invoked only in production** — already guarded by `if (!isDev)`. `autoUpdater.checkForUpdatesAndNotify()` uses the `publish` block in `electron-builder.yml` (GitHub) to locate `latest-mac.yml`/`latest.yml`.

- [ ] **Step 2: Verify (manual, [HAND-OFF])** — after publishing `v0.1.0` then `v0.1.1` to GitHub Releases, an installed `v0.1.0` shows the "downloaded, restart to update" flow on next launch and relaunches into `v0.1.1` with the SQLite data intact (migration runner runs on the new version).

- [ ] **Step 3: Commit** — n/a (no code change beyond Task 3).

---

### Task 9: Scripts, docs, release runbook

**Files:** Create `docs/DESKTOP.md`; Modify `README.md`

- [ ] **Step 1: Write `docs/DESKTOP.md`** with: prerequisites (Node, Python, Xcode CLT / Windows build tools), the build sequence (`build-recognizer.sh` per platform → `npm run electron:build`), the required signing/notarization env vars, and the **release flow**: bump `version` in `package.json` → `npm run electron:build` (publishes to GitHub Releases when `GH_TOKEN` is set) → installed apps auto-update on next launch.

- [ ] **Step 2: README pointer** — add a short "Desktop app" section linking `docs/DESKTOP.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/DESKTOP.md README.md
git commit -m "docs: desktop build + release runbook"
```

---

### Task 10: End-to-end verification checklist

- [ ] **Step 1: Unit suite still green** — `npm test && npx tsc --noEmit && npm run lint` (the persistence tests must still pass; Electron files are excluded from the Next/TS app build — confirm `electron/` isn't type-checked by the app tsconfig or add an exclude).
- [ ] **Step 2: Dev launch** — `npm run electron:dev` opens the app window. ✅ automated-ish (process starts).
- [ ] **Step 3: Packaged launch [HAND-OFF]** — `npm run electron:build` (unpacked `--dir` at minimum); launch the app; save a song; quit; relaunch → data persists at `~/Library/Application Support/Shazam Radio/app_state.db` (macOS). Recognizer identifies a song with no separate install.
- [ ] **Step 4: Auto-update [HAND-OFF]** — per Task 8 Step 2.

---

## Risks
- **better-sqlite3 ABI**: the standalone trace must contain the Electron-rebuilt binary. Order: `electron-rebuild` → `next build` → `electron-builder`. If the wrong ABI ships, the server crashes on launch (visible in `stdio: 'inherit'` logs). Mitigation: the `electron:build` script enforces the order; consider committing a CI matrix later.
- **Standalone server under ELECTRON_RUN_AS_NODE**: validated by Task 1 Step 3 (the server honors `APP_DB_PATH`) and Task 3 Step 3 (it boots under Electron). If `process.resourcesPath/app/server.js` pathing is wrong, the window never loads — logs show it.
- **Recognizer freeze size/licensing**: PyInstaller output is large and per-platform; ffmpeg must be an LGPL/GPL-clean static build. This is the heaviest hand-off item.
- **Notarization**: requires a paid Apple Developer account; without it macOS users get Gatekeeper warnings and auto-update won't apply cleanly.
