'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';
import { persistSet } from './persist';

// Hidden stations: ones the user has chosen to banish from every list (search,
// favorites, popular, recent). We keep the full Station objects (not just ids)
// so Settings can list them by name for un-hiding. Same store pattern as
// favorites/recent.

const KEY = 'radio:hidden';
const EMPTY: Station[] = [];

function loadFromStorage(): Station[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Station[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let snapshot: Station[] | null = null;
function read(): Station[] {
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

function write(next: Station[]) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  emit();
}

export function useHidden() {
  const hidden = useSyncExternalStore(subscribe, read, () => EMPTY);

  const isHidden = useCallback((id: string) => hidden.some(s => s.id === id), [hidden]);

  const hide = useCallback((station: Station) => {
    const current = read();
    if (current.some(s => s.id === station.id)) return;
    write([station, ...current]);
  }, []);

  const unhide = useCallback((id: string) => {
    write(read().filter(s => s.id !== id));
  }, []);

  return { hidden, isHidden, hide, unhide };
}

// Whether to skip the "Hide station?" confirmation. Off by default (we always
// confirm). Flipped on when the user ticks "Don't ask again" in the dialog, and
// revertable from Settings → Hidden stations. Same store shape as the toggles in
// app/lib/closeToTray.ts; the StorageEvent listener also picks up the value when
// hydrateFromServer() replays the server state on boot.
const SKIP_CONFIRM_KEY = 'radio:hideSkipConfirm';

function loadSkipConfirm(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(SKIP_CONFIRM_KEY) === '1'; } catch { return false; }
}

let skipSnapshot: boolean | null = null;
function readSkip(): boolean {
  if (skipSnapshot === null) skipSnapshot = loadSkipConfirm();
  return skipSnapshot;
}

const skipListeners = new Set<() => void>();
function subscribeSkip(cb: () => void): () => void {
  skipListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SKIP_CONFIRM_KEY) { skipSnapshot = loadSkipConfirm(); cb(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { skipListeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function writeSkip(next: boolean) {
  skipSnapshot = next;
  persistSet(SKIP_CONFIRM_KEY, next ? '1' : '0');
  for (const cb of skipListeners) cb();
}

/** The "skip the hide confirmation" preference + a setter. */
export function useHideConfirm() {
  const skipConfirm = useSyncExternalStore(subscribeSkip, readSkip, () => false);
  const setSkipConfirm = useCallback((v: boolean) => writeSkip(v), []);
  return { skipConfirm, setSkipConfirm };
}

/**
 * Returns a filter that drops hidden stations from any list — apply it
 * everywhere stations are shown so hidden ones never reappear.
 */
export function useHiddenFilter(): <T extends { id: string }>(stations: T[]) => T[] {
  const hidden = useSyncExternalStore(subscribe, read, () => EMPTY);
  return useCallback(
    <T extends { id: string }>(stations: T[]) => {
      if (hidden.length === 0) return stations;
      const ids = new Set(hidden.map(s => s.id));
      return stations.filter(s => !ids.has(s.id));
    },
    [hidden],
  );
}
