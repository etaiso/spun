'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Best-guess ISO 3166 alpha-2 region for the current user, derived from their
 * browser locale(s) — e.g. "he-IL" → "IL". Used to rank stations from the
 * user's country higher in search. Returns null if no region can be inferred.
 */
export function userRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const locale of locales) {
    if (!locale) continue;
    try {
      const region = new Intl.Locale(locale).region;
      if (region) return region.toUpperCase();
    } catch {
      // Fall back to parsing the subtag after "-" (e.g. "en-US" → "US").
      const part = locale.split('-')[1];
      if (part && part.length === 2) return part.toUpperCase();
    }
  }
  return null;
}

// ── Region preference store ──────────────────────────────────────────────
// The effective search region: a user override persisted in localStorage,
// falling back to the browser-detected region. Empty string = "Global".
const KEY = 'radio:region';
let cache: string | null = null;
const listeners = new Set<() => void>();

function read(): string {
  if (cache !== null) return cache;
  let v = '';
  if (typeof window !== 'undefined') {
    try { v = window.localStorage.getItem(KEY) ?? ''; } catch { /* ignore */ }
  }
  // No stored choice yet → seed from the detected locale region.
  if (!v) v = userRegion() ?? '';
  cache = v;
  return cache;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

export function useRegion(): { region: string; setRegion: (r: string) => void } {
  const region = useSyncExternalStore(subscribe, read, () => '');
  const setRegion = useCallback((r: string) => {
    cache = r;
    try { window.localStorage.setItem(KEY, r); } catch { /* ignore */ }
    for (const cb of listeners) cb();
  }, []);
  return { region, setRegion };
}
