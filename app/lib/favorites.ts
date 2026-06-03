'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';

const KEY = 'radio:favorites';
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
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Safari private mode / quota exceeded — keep in-memory state correct
    // so the UI still reflects the toggle; persistence is best-effort.
  }
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
