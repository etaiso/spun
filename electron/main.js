// Electron main process.
//
// Production: spawn the Next.js standalone server (.next/standalone/server.js)
// on a free port as an Electron utilityProcess — it runs under Electron's own
// Node ABI (so native better-sqlite3 matches) but headless, with NO Dock tile.
// (Re-launching process.execPath with ELECTRON_RUN_AS_NODE also matched the ABI
// but the relaunched binary got its own generic "exec" Dock tile.) Spawn the
// bundled recognizer sidecar on another free port, then load a BrowserWindow at
// the app URL. The SQLite DB lives in the OS user-data dir, so it survives
// uninstall-less browser-style clears.
//
// Dev: skip spawning; load the separately-running `next dev` at localhost:3000.

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, utilityProcess, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
let win = null;
let serverProc = null;
let recognizerProc = null;

// --- System tray (Windows) --------------------------------------------------
// On Windows the title-bar ✕ hides the window to the tray by default instead of
// quitting, so playback/tracking keeps running in the background. The renderer
// owns the on/off setting (Settings → "Close to tray") and reports it over IPC;
// `closeToTray` mirrors it here. `isQuitting` distinguishes a real quit (tray
// menu, updater restart, before-quit) from a tray-hide so the 'close' handler
// knows whether to swallow the event. macOS keeps its own last-window-closed
// behavior and has no tray.
const hasTray = process.platform === 'win32';
let tray = null;
let closeToTray = true;   // default on; renderer pushes the persisted value after boot
let isQuitting = false;   // set true once a genuine quit is underway

// Single-instance lock (Windows). Once the app is hidden in the tray, launching
// the shortcut again must reveal the existing window — not boot a second copy
// (which would spawn its own Next server + recognizer on fresh ports). The
// second instance fails the lock, quits, and the first gets 'second-instance'.
const gotSingleInstanceLock = !hasTray || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else if (hasTray) {
  app.on('second-instance', () => showWindow());
}

// Diagnostics log — a Finder-launched app has no terminal, so child stdio and
// our own messages go here: <userData>/desktop.log.
let logFd = null;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { if (logFd !== null) fs.writeSync(logFd, line); } catch { /* ignore */ }
  console.log(msg);
}

// --- Auto-update (electron-updater) -----------------------------------------
// The renderer owns the on/off setting (Settings → Software update) and reports
// it over IPC; the main process owns the updater. The automatic check runs once
// per launch, and only after the renderer confirms the preference is ON — so a
// user who turned it OFF is never surprised by a background download. A manual
// "Check now" (also in Settings) can be triggered at any time regardless of the
// preference. Delta downloads are automatic either way: electron-builder
// publishes a .blockmap beside each installer/zip, so electron-updater fetches
// only the changed blocks instead of the full installer.
let updaterInited = false;
let autoChecked = false;

// macOS auto-INSTALL needs Developer ID signing: Squirrel.Mac validates the
// downloaded app against the running app's code requirement before swapping it
// in, and our Phase 1 mac builds are unsigned — so a self-install always fails
// ("code signature … did not pass validation"). Until the mac build is signed
// we still CHECK on macOS, but an available update is handed off to the browser
// for a manual download. Windows (NSIS) has no such gate and keeps the full
// background updater. Flip this to `true` for macOS once the build is signed.
const canSelfUpdate = process.platform !== 'darwin';
const RELEASES_URL = 'https://github.com/etaiso/spun/releases/latest';

function openReleasePage() {
  shell.openExternal(RELEASES_URL).catch((e) => log(`openReleasePage failed: ${e}`));
}

function sendUpdateStatus(status) {
  log(`auto-update: ${JSON.stringify(status)}`);
  try { win?.webContents.send('spun:update-status', status); } catch { /* window gone */ }
}

// Lazily require electron-updater and wire its lifecycle events to the renderer.
// Idempotent: the handlers are attached once, then shared by both the automatic
// check and any manual "Check now". Returns the autoUpdater, or null in dev.
function initUpdater() {
  if (isDev) return null;            // dev runs the live server — nothing to update
  const { autoUpdater } = require('electron-updater');
  if (updaterInited) return autoUpdater;
  updaterInited = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload = true;   // download (delta) as soon as one is found
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => sendUpdateStatus({ state: 'available', version: i?.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'downloading', percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on('update-downloaded', (i) => sendUpdateStatus({ state: 'downloaded', version: i?.version }));
  autoUpdater.on('error', (e) => sendUpdateStatus({ state: 'error', message: String(e?.message ?? e) }));
  return autoUpdater;
}

// Automatic check: runs once per launch, only when the preference is ON. It
// downloads in the background (autoDownload) and applies on the next quit.
function setAutoUpdate(enabled) {
  if (isDev) return;
  if (!enabled) { log('auto-update: disabled by preference'); return; }
  if (autoChecked) return;           // one automatic check per launch
  autoChecked = true;
  try {
    const u = initUpdater();
    if (!u) return;
    if (canSelfUpdate) {
      u.autoDownload = true;
      // checkForUpdatesAndNotify downloads in the background and fires a native
      // OS notification when the update is staged; it applies on next restart.
      u.checkForUpdatesAndNotify();
    } else {
      // macOS: detect only — never auto-download (the self-install would fail
      // the signature check). The renderer surfaces the available update and
      // opens the release page for a manual download.
      u.autoDownload = false;
      u.checkForUpdates();
    }
  } catch (e) {
    log(`updater init failed: ${e}`);
  }
}

// Manual check: triggered by the user clicking "Check now" in Settings, and
// works regardless of the auto-update preference. Unlike the automatic path it
// does NOT auto-download — the renderer shows the user a dialog and only calls
// downloadUpdate() if they agree, so a manual check never downloads behind their
// back. The update-(not-)available events drive that dialog.
function checkForUpdate() {
  if (isDev) { sendUpdateStatus({ state: 'none' }); return; }
  try {
    const u = initUpdater();
    if (!u) { sendUpdateStatus({ state: 'none' }); return; }
    u.autoDownload = false;
    u.checkForUpdates();
  } catch (e) {
    sendUpdateStatus({ state: 'error', message: String(e?.message ?? e) });
  }
}

// Download an update the user agreed to from the manual "Update now" dialog.
// Progress and completion arrive via download-progress / update-downloaded.
function downloadUpdate() {
  if (isDev) return;
  if (!canSelfUpdate) { openReleasePage(); return; }  // mac can't self-install — hand off to the browser
  try {
    initUpdater()?.downloadUpdate();
  } catch (e) {
    sendUpdateStatus({ state: 'error', message: String(e?.message ?? e) });
  }
}

// Quit and install a downloaded update now (user clicked "Restart now").
function quitAndInstall() {
  if (isDev) return;
  try {
    initUpdater()?.quitAndInstall();
  } catch (e) {
    log(`quitAndInstall failed: ${e}`);
  }
}

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

// Spawn the frozen recognizer sidecar. Non-fatal if it's not bundled — the app
// just loses the Shazam fallback (calls to RECOGNIZER_URL fail gracefully).
function recognizerBinPath() {
  const base = path.join(process.resourcesPath, 'recognizer');
  // macOS: a .app BUNDLE (dock-less); elsewhere: a onedir COLLECT folder.
  if (process.platform === 'darwin') {
    return path.join(base, 'recognizer.app', 'Contents', 'MacOS', 'recognizer');
  }
  if (process.platform === 'win32') {
    return path.join(base, 'recognizer', 'recognizer.exe');
  }
  return path.join(base, 'recognizer', 'recognizer');
}

// Unique substring of the recognizer's command line, used to kill it on quit
// when it's launched detached via `open` on macOS.
const RECOGNIZER_PROC_MATCH = 'recognizer.app/Contents/MacOS/recognizer';

async function startRecognizer() {
  const port = await getFreePort();
  const recognizerBin = recognizerBinPath();
  log(`recognizer: path=${recognizerBin} exists=${fs.existsSync(recognizerBin)} port=${port}`);
  if (!fs.existsSync(recognizerBin)) {
    log('recognizer: binary not bundled; Shazam fallback disabled');
    return port;
  }
  const ffmpegDir = path.join(process.resourcesPath, 'ffmpeg');
  const recPath = `${ffmpegDir}${path.delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`;
  const out = logFd !== null ? logFd : 'ignore';
  // SSL: the recognizer points OpenSSL at its bundled certifi itself.

  if (process.platform === 'darwin') {
    // Launch the .app via LaunchServices (`open`) so its Info.plist LSUIElement
    // is honored → no Dock tile. (Exec'ing the binary directly bypasses
    // LaunchServices, and an in-process activation-policy change doesn't update
    // the Dock without a Cocoa run loop.) `open` returns immediately and the
    // recognizer runs detached, so it's killed by command-line match on quit.
    const appPath = path.join(process.resourcesPath, 'recognizer', 'recognizer.app');
    const recLog = path.join(app.getPath('userData'), 'recognizer.log');
    const args = [
      '-n', '-g', '-j',
      '--stdout', recLog, '--stderr', recLog,
      '--env', `RECOGNIZER_PORT=${port}`,
      '--env', `PATH=${recPath}`,
      appPath,
    ];
    recognizerProc = spawn('open', args, { stdio: ['ignore', out, out] });
    recognizerProc.on('error', (e) => log(`recognizer(open): launch failed: ${e}`));
    recognizerProc.on('exit', (code) => log(`recognizer(open): launcher exited code=${code} (recognizer runs detached → ${recLog})`));
    return port;
  }

  // Windows / Linux: spawn the onedir binary directly (no Dock concern).
  // windowsHide passes CREATE_NO_WINDOW so the console-subsystem recognizer.exe
  // (PyInstaller console=True) doesn't pop a terminal window — the Windows
  // analog of the macOS LSUIElement bundle trick above.
  recognizerProc = spawn(recognizerBin, [], {
    env: { ...process.env, RECOGNIZER_PORT: String(port), PATH: recPath },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  recognizerProc.on('spawn', () => log(`recognizer: spawned pid=${recognizerProc.pid}`));
  recognizerProc.on('error', (e) => log(`recognizer: failed to start: ${e}`));
  recognizerProc.on('exit', (code, signal) => log(`recognizer: exited code=${code} signal=${signal}`));
  return port;
}

async function startNextServer(recognizerPort) {
  const port = await getFreePort();
  const serverJs = path.join(process.resourcesPath, 'app', 'server.js');
  log(`server: ${serverJs} port=${port} recognizer=http://127.0.0.1:${recognizerPort}`);
  // utilityProcess: headless Node child on Electron's ABI — no Dock tile.
  // stdio:'pipe' surfaces the child's output as streams we forward to the log
  // file (a Finder-launched app has no terminal to 'inherit').
  serverProc = utilityProcess.fork(serverJs, [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      APP_DB_PATH: path.join(app.getPath('userData'), 'app_state.db'),
      APP_TIMESHIFT_DIR: path.join(app.getPath('userData'), 'timeshift'),
      RECOGNIZER_URL: `http://127.0.0.1:${recognizerPort}`,
    },
  });
  const pipe = (chunk) => { try { if (logFd !== null) fs.writeSync(logFd, chunk); } catch { /* ignore */ } };
  serverProc.stdout?.on('data', pipe);
  serverProc.stderr?.on('data', pipe);
  serverProc.on('spawn', () => log(`server: spawned pid=${serverProc.pid}`));
  serverProc.on('exit', (code) => log(`server: exited code=${code}`));
  await waitForHttp(port);
  log(`server: ready on :${port}`);
  return port;
}

// Bring the (possibly hidden/minimized) main window back to the foreground.
// Used by the tray, the tray's double-click, and the second-instance handler.
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Create the Windows tray icon + context menu. The icon (electron/tray-icon.png,
// bundled in the asar via the `files` glob) is downscaled to 16px — the tray
// renders it at the system DPI. Idempotent: only ever one tray.
function createTray() {
  if (!hasTray || tray) return;
  try {
    const img = nativeImage
      .createFromPath(path.join(__dirname, 'tray-icon.png'))
      .resize({ width: 16, height: 16 });
    tray = new Tray(img.isEmpty() ? path.join(__dirname, 'tray-icon.png') : img);
    tray.setToolTip('Spun');
    const menu = Menu.buildFromTemplate([
      { label: 'Open Spun', click: showWindow },
      { type: 'separator' },
      // A real quit: flip isQuitting so the 'close' handler doesn't re-hide,
      // then app.quit() tears down the sidecars via the before-quit handler.
      { label: 'Quit Spun', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    // Left-click / double-click the tray icon to reopen the window — the gesture
    // Windows users expect from a tray app.
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    log('tray: created');
  } catch (e) {
    log(`tray: creation failed: ${e}`);
  }
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#faf7f2',
    // Give the BrowserWindow an explicit icon on Windows (taskbar + Alt-Tab);
    // packaged builds also get the NSIS .ico, but this covers the dev run.
    ...(hasTray ? { icon: path.join(__dirname, 'tray-icon.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Close-to-tray: when enabled, the title-bar ✕ hides the window instead of
  // destroying it (preventDefault), so the app keeps running in the tray. A
  // genuine quit (tray "Quit", updater restart, before-quit) sets isQuitting
  // first and falls through. No-op where there's no tray.
  win.on('close', (e) => {
    if (hasTray && closeToTray && !isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // Open external links (Apple Music, Shazam, etc.) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

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
  if (!gotSingleInstanceLock) return;   // a copy is already running; this one is quitting
  try {
    logFd = fs.openSync(path.join(app.getPath('userData'), 'desktop.log'), 'a');
  } catch { /* logging is best-effort */ }
  log(`--- launch (packaged=${app.isPackaged}, platform=${process.platform}) ---`);
  // On Windows/Linux the default menu bar (File, Edit, View, …) is attached to
  // each window — drop it. macOS keeps its system menu bar so the standard
  // ⌘C/⌘V/⌘Q shortcuts and app menu survive.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  // The renderer pushes the persisted auto-update preference after it hydrates
  // (see app/components/PersistenceBootstrap.tsx); setAutoUpdate gates the check.
  ipcMain.handle('spun:set-auto-update', (_event, enabled) => { setAutoUpdate(enabled); return true; });
  // Manual "Check now" from Settings — works regardless of the auto preference.
  ipcMain.handle('spun:check-for-update', () => { checkForUpdate(); return true; });
  // User agreed to the update in the dialog → download it, then (optionally) install.
  ipcMain.handle('spun:download-update', () => { downloadUpdate(); return true; });
  ipcMain.handle('spun:quit-and-install', () => { quitAndInstall(); return true; });
  // Open the GitHub releases page for a manual download (unsigned macOS path).
  ipcMain.handle('spun:open-release-page', () => { openReleasePage(); return true; });
  // Close-to-tray preference (Windows). The renderer pushes the persisted value
  // after it hydrates (see app/components/PersistenceBootstrap.tsx); main uses
  // it in the window 'close' handler.
  ipcMain.handle('spun:set-close-to-tray', (_event, enabled) => { closeToTray = !!enabled; return true; });
  if (hasTray) createTray();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // A real teardown is underway (menu Quit, updater restart, OS shutdown) — let
  // the window actually close instead of re-hiding to the tray.
  isQuitting = true;
  try { serverProc?.kill(); } catch { /* already gone */ }
  try { recognizerProc?.kill(); } catch { /* already gone */ }
  // On macOS the recognizer is launched detached via `open`, so recognizerProc
  // is just the (exited) launcher — kill the real process by command-line match.
  if (process.platform === 'darwin') {
    try {
      require('node:child_process').execFileSync('/usr/bin/pkill', ['-f', RECOGNIZER_PROC_MATCH]);
    } catch { /* nothing to kill */ }
  }
});

// Timeshift buffers are session-only: wipe on quit. (Boot also wipes — see
// app/lib/server/timeshiftDir.ts — covering crashes where this never runs.)
app.on('will-quit', () => {
  try {
    fs.rmSync(path.join(app.getPath('userData'), 'timeshift'), { recursive: true, force: true });
  } catch { /* best-effort */ }
});
