'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// Whether the desktop app installs updates automatically. Persisted, on by
// default. Lives in the same SQLite-backed store as the other settings (the
// BrowserWindow's localStorage origin/port changes each launch, so the server
// DB — rehydrated on boot — is the real source of truth).
//
// The Electron main process owns electron-updater, so on every change (and once
// after boot) we mirror the preference across the IPC bridge exposed on
// `window.spun` (see electron/preload.js). In the plain web build `window.spun`
// is absent and the sync is a no-op.

const KEY = 'radio:autoUpdate';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'available'; version?: string }
  | { state: 'downloading'; percent?: number }
  | { state: 'downloaded'; version?: string }
  | { state: 'error'; message?: string };

// The IPC surface exposed by the Electron preload. Optional everywhere because
// it only exists in the desktop shell.
type SpunShell = {
  setAutoUpdate: (enabled: boolean) => void;
  checkForUpdate: () => void;
  downloadUpdate: () => void;
  quitAndInstall: () => void;
  canSelfUpdate?: boolean;
  openReleasePage: () => void;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
};

declare global {
  interface Window {
    spun?: SpunShell;
  }
}

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
  try { window.spun?.setAutoUpdate(read()); } catch { /* shell gone / web build */ }
}

/** True when running inside the desktop shell (manual checks are possible). */
export function canCheckForUpdate(): boolean {
  return typeof window !== 'undefined' && typeof window.spun?.checkForUpdate === 'function';
}

/** Ask the shell to check for an update now (no-op on web). */
export function requestUpdateCheck(): void {
  if (typeof window === 'undefined') return;
  try { window.spun?.checkForUpdate(); } catch { /* shell gone / web build */ }
}

/**
 * Whether the shell can download & install updates itself. False on unsigned
 * macOS builds, where the install can't pass Squirrel.Mac's signature check —
 * there the UI offers a manual download via openReleasePage() instead.
 */
export function canSelfInstallUpdate(): boolean {
  return typeof window !== 'undefined' && window.spun?.canSelfUpdate === true;
}

/** Open the GitHub releases page for a manual download (no-op on web). */
export function openReleasePage(): void {
  if (typeof window === 'undefined') return;
  try { window.spun?.openReleasePage(); } catch { /* shell gone / web build */ }
}

/** Download the update found by a manual check, after the user agrees. */
export function downloadUpdate(): void {
  if (typeof window === 'undefined') return;
  try { window.spun?.downloadUpdate(); } catch { /* shell gone / web build */ }
}

/** Quit and install a downloaded update now ("Restart now"). */
export function quitAndInstall(): void {
  if (typeof window === 'undefined') return;
  try { window.spun?.quitAndInstall(); } catch { /* shell gone / web build */ }
}

function write(next: boolean) {
  snapshot = next;
  persistSet(KEY, next ? '1' : '0');
  emit();
  syncToShell();
}

export function useAutoUpdate() {
  // Server snapshot is `true` (on) to match the default and avoid a hydration
  // flash; the client value resolves from localStorage immediately.
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const setEnabled = useCallback((v: boolean) => write(v), []);
  const toggle = useCallback(() => write(!read()), []);
  return { enabled, setEnabled, toggle };
}
