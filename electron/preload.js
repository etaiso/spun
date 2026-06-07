// Preload — contextIsolation is on (nodeIntegration off), so the renderer can't
// touch Node/Electron directly. We expose a tiny, explicit IPC surface on
// `window.spun` for the bits the web app legitimately needs from the shell.
//
// Currently: the auto-update preference (renderer owns the setting UI; the main
// process owns electron-updater) and a one-way stream of updater status events.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spun', {
  // Renderer reports the user's auto-update preference; main gates the updater.
  setAutoUpdate: (enabled) => ipcRenderer.invoke('spun:set-auto-update', !!enabled),

  // Renderer asks the shell to check for an update now (manual "Check now").
  checkForUpdate: () => ipcRenderer.invoke('spun:check-for-update'),

  // After the user agrees in the update dialog: download, then restart to apply.
  downloadUpdate: () => ipcRenderer.invoke('spun:download-update'),
  quitAndInstall: () => ipcRenderer.invoke('spun:quit-and-install'),

  // Whether the shell can download & install updates itself. False on unsigned
  // macOS builds (Squirrel.Mac can't validate the signature) — there the
  // renderer offers a manual download via openReleasePage instead.
  canSelfUpdate: process.platform !== 'darwin',

  // Open the GitHub releases page in the system browser for a manual download.
  openReleasePage: () => ipcRenderer.invoke('spun:open-release-page'),

  // Subscribe to updater lifecycle events. Returns an unsubscribe fn.
  onUpdateStatus: (cb) => {
    const handler = (_event, status) => cb(status);
    ipcRenderer.on('spun:update-status', handler);
    return () => ipcRenderer.removeListener('spun:update-status', handler);
  },
});
