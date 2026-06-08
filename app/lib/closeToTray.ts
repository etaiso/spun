'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// Whether closing the window (the title-bar ✕) hides the app to the system tray
// instead of quitting it. Persisted, on by default. Windows/Linux only — macOS
// already keeps the app alive when its last window closes, so the tray-hide
// dance is unnecessary there and the toggle is hidden in Settings.
//
// Same shape as the auto-update preference (see app/lib/autoUpdate.ts): the
// SQLite-backed store is the source of truth (the BrowserWindow's localStorage
// origin/port changes each launch), and the Electron main process — which owns
// the tray and the window 'close' handler — is kept in sync over the IPC bridge
// exposed on `window.spun` (see electron/preload.js). On the plain web build
// `window.spun` is absent and the sync is a no-op.

const KEY = 'radio:closeToTray';

function loadFromStorage(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default on: only an explicit '0' disables it.
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

let snapshot: boolean | null = null;
function read(): boolean {
  if (snapshot === null) snapshot = loadFromStorage();
  return snapshot;
}

const listeners = new Set<() => void>();
function emit() { for (const cb of listeners) cb(); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { snapshot = loadFromStorage(); cb(); syncToShell(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

/** Tell the Electron main process the current preference (no-op on web). */
export function syncToShell(): void {
  if (typeof window === 'undefined') return;
  try { window.spun?.setCloseToTray?.(read()); } catch { /* shell gone / web build */ }
}

/** True when running inside a desktop shell that supports the tray toggle. */
export function canCloseToTray(): boolean {
  return typeof window !== 'undefined' && typeof window.spun?.setCloseToTray === 'function';
}

function write(next: boolean) {
  snapshot = next;
  persistSet(KEY, next ? '1' : '0');
  emit();
  syncToShell();
}

export function useCloseToTray() {
  // Server snapshot is `true` (on) to match the default and avoid a hydration
  // flash; the client value resolves from localStorage immediately.
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const setEnabled = useCallback((v: boolean) => write(v), []);
  const toggle = useCallback(() => write(!read()), []);
  return { enabled, setEnabled, toggle };
}
