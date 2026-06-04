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
