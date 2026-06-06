'use client';

// Typed wrapper over the Electron-main Spotify bridge (window.spun.spotify).
// All Spotify auth/token/network lives in the main process; the renderer only
// calls through here. `isAvailable()` is false on the web/dev build (no Electron
// shell), where every method is a safe no-op so the UI can hide the feature.

import type { Candidate } from './spotifyMatch';

export type SpotifyStatus = {
  connected: boolean;
  displayName?: string;
  playlistUrl?: string;
};

type Bridge = {
  getStatus(): Promise<SpotifyStatus>;
  connect(): Promise<{ ok: boolean; displayName?: string }>;
  disconnect(): Promise<void>;
  search(query: string): Promise<Candidate[]>;
  ensurePlaylist(): Promise<{ id: string; url: string }>;
  playlistTrackIds(): Promise<string[]>;
  addTracks(uris: string[]): Promise<void>;
};

function raw(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { spun?: { spotify?: Bridge } }).spun?.spotify ?? null;
}

/** True only in the Electron shell with the Spotify bridge wired (client id configured). */
export function isAvailable(): boolean {
  return raw() !== null;
}

export const spotify: Bridge = {
  async getStatus() { return (await raw()?.getStatus()) ?? { connected: false }; },
  async connect() { return (await raw()?.connect()) ?? { ok: false }; },
  async disconnect() { await raw()?.disconnect(); },
  async search(query) { return (await raw()?.search(query)) ?? []; },
  async ensurePlaylist() {
    const r = await raw()?.ensurePlaylist();
    if (!r) throw new Error('Spotify is not available');
    return r;
  },
  async playlistTrackIds() { return (await raw()?.playlistTrackIds()) ?? []; },
  async addTracks(uris) { await raw()?.addTracks(uris); },
};
