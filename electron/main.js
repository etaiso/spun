// Electron main process.
//
// Production: spawn the Next.js standalone server (.next/standalone/server.js)
// on a free port using Electron's own Node (ELECTRON_RUN_AS_NODE, so the native
// better-sqlite3 ABI matches), spawn the bundled recognizer sidecar on another
// free port, then load a BrowserWindow at the app URL. The SQLite DB lives in
// the OS user-data dir, so it survives uninstall-less browser-style clears.
//
// Dev: skip spawning; load the separately-running `next dev` at localhost:3000.

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
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

// Spawn the frozen recognizer sidecar. Non-fatal if it's not bundled — the app
// just loses the Shazam fallback (calls to RECOGNIZER_URL fail gracefully).
async function startRecognizer() {
  const port = await getFreePort();
  const bin = process.platform === 'win32' ? 'recognizer.exe' : 'recognizer';
  const recognizerBin = path.join(process.resourcesPath, 'recognizer', bin);
  if (!fs.existsSync(recognizerBin)) {
    console.warn('recognizer binary not bundled; Shazam fallback disabled');
    return port;
  }
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
  await createWindow();
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      console.error('updater init failed:', e);
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
});
