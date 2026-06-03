'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';

const KEY = 'radio:favorites';

function read(): Station[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Station[]) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function emit() { for (const cb of listeners) cb(); }

function write(next: Station[]) {
  window.localStorage.setItem(KEY, JSON.stringify(next));
  emit();
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, () => []);

  const isFavorite = useCallback(
    (id: string) => favorites.some(s => s.id === id),
    [favorites],
  );

  const toggle = useCallback((station: Station) => {
    const current = read();
    const next = current.some(s => s.id === station.id)
      ? current.filter(s => s.id !== station.id)
      : [...current, station];
    write(next);
  }, []);

  return { favorites, isFavorite, toggle };
}
