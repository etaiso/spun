'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';

const KEY = 'radio:recent';
const MAX_RECENT = 5;
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

// Cached snapshot — same pattern as favorites; useSyncExternalStore needs
// a stable reference from getSnapshot.
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
    // best-effort persistence; in-memory snapshot still correct
  }
  emit();
}

export function useRecent() {
  const recent = useSyncExternalStore(subscribe, read, () => EMPTY);

  // Add to the front of the list. If the station was already there, move it
  // to the front (don't duplicate). Cap at MAX_RECENT.
  const add = useCallback((station: Station) => {
    const current = read();
    const without = current.filter(s => s.id !== station.id);
    const next = [station, ...without].slice(0, MAX_RECENT);
    // Skip the write if the head is already this station — avoids a pointless
    // localStorage round-trip when the user clicks the same row twice.
    if (current.length > 0 && current[0].id === station.id && current.length === next.length) {
      return;
    }
    write(next);
  }, []);

  return { recent, add };
}
