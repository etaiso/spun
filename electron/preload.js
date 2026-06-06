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

  // Subscribe to updater lifecycle events. Returns an unsubscribe fn.
  onUpdateStatus: (cb) => {
    const handler = (_event, status) => cb(status);
    ipcRenderer.on('spun:update-status', handler);
    return () => ipcRenderer.removeListener('spun:update-status', handler);
  },

  // Spotify playlist export — exposed only when SPOTIFY_CLIENT_ID is configured,
  // so the renderer's isAvailable() guard hides the feature otherwise. All calls
  // are handled in the main process (see electron/spotify.js).
  ...(process.env.SPOTIFY_CLIENT_ID ? {
    spotify: {
      getStatus: () => ipcRenderer.invoke('spun:spotify:get-status'),
      connect: () => ipcRenderer.invoke('spun:spotify:connect'),
      disconnect: () => ipcRenderer.invoke('spun:spotify:disconnect'),
      search: (query) => ipcRenderer.invoke('spun:spotify:search', query),
      ensurePlaylist: () => ipcRenderer.invoke('spun:spotify:ensure-playlist'),
      playlistTrackIds: () => ipcRenderer.invoke('spun:spotify:playlist-track-ids'),
      addTracks: (uris) => ipcRenderer.invoke('spun:spotify:add-tracks', uris),
    },
  } : {}),
});
