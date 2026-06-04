'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Whether the audio-reactive "radio wave" rings render behind the now-playing
// cover. Persisted, on by default. Same useSyncExternalStore pattern as the
// other stores so the Settings toggle and the visualiser stay in sync live.

const KEY = 'radio:rings';

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
    if (e.key === KEY) { snapshot = loadFromStorage(); cb(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function write(next: boolean) {
  snapshot = next;
  try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* best-effort */ }
  emit();
}

export function useRingsEnabled() {
  // Server snapshot is `true` (rings on) to match the default and avoid a
  // hydration flash; the client value resolves from localStorage immediately.
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const setEnabled = useCallback((v: boolean) => write(v), []);
  const toggle = useCallback(() => write(!read()), []);
  return { enabled, setEnabled, toggle };
}
