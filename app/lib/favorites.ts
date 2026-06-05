'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';
import { parseStoredStations } from './stations';
import { persistSet } from './persist';

const KEY = 'radio:favorites';
const EMPTY: Station[] = [];

function loadFromStorage(): Station[] {
  if (typeof window === 'undefined') return EMPTY;
  return parseStoredStations(window.localStorage.getItem(KEY));
}

// Cached snapshot: useSyncExternalStore requires getSnapshot to return a
// referentially stable value when data hasn't changed, or React 19 throws.
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
    if (e.key === KEY) {
      snapshot = loadFromStorage();
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function write(next: Station[]) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  emit();
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, () => EMPTY);

  const isFavorite = useCallback(
    (id: string) => favorites.some(s => s.id === id),
    [favorites],
  );

  // Read fresh from storage (not the closed-over `favorites`) so rapid
  // toggles within a single render tick stay consistent.
  const toggle = useCallback((station: Station) => {
    const current = read();
    const next = current.some(s => s.id === station.id)
      ? current.filter(s => s.id !== station.id)
      : [...current, station];
    write(next);
  }, []);

  return { favorites, isFavorite, toggle };
}
