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

const { app, BrowserWindow, shell, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
let win = null;
let serverProc = null;
let recognizerProc = null;

// Diagnostics log — a Finder-launched app has no terminal, so child stdio and
// our own messages go here: <userData>/desktop.log.
let logFd = null;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { if (logFd !== null) fs.writeSync(logFd, line); } catch { /* ignore */ }
  console.log(msg);
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
  recognizerProc = spawn(recognizerBin, [], {
    env: { ...process.env, RECOGNIZER_PORT: String(port), PATH: recPath },
    stdio: ['ignore', out, out],
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#faf7f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
  try {
    logFd = fs.openSync(path.join(app.getPath('userData'), 'desktop.log'), 'a');
  } catch { /* logging is best-effort */ }
  log(`--- launch (packaged=${app.isPackaged}, platform=${process.platform}) ---`);
  await createWindow();
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      log(`updater init failed: ${e}`);
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
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
