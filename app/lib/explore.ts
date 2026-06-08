'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { Station } from './stations';
import type { ExploreCountry, ExploreTag } from './explorePaths';

// Client data layer for Explore. The country/tag lists are fetched once and
// cached at module scope (they barely change and the server caches them for
// hours too), surfaced through useSyncExternalStore like the favorites/region
// stores. Station drill-ins are one-shot fetches (the caller manages state).

type Resource<T> = { data: T[]; loading: boolean; error: boolean };

// A self-fetching, fetch-once list endpoint exposed as a hook.
function createListResource<T>(url: string) {
  let state: Resource<T> = { data: [], loading: false, error: false };
  let started = false;
  const listeners = new Set<() => void>();
  // Stable server/hydration snapshot (no fetching on the server).
  const SERVER: Resource<T> = { data: [], loading: false, error: false };

  const emit = () => { for (const cb of listeners) cb(); };

  async function load() {
    if (started) return;
    started = true;
    state = { ...state, loading: true, error: false };
    emit();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as unknown;
      state = { data: Array.isArray(json) ? (json as T[]) : [], loading: false, error: false };
    } catch {
      started = false; // let a later mount retry
      state = { data: [], loading: false, error: true };
    }
    emit();
  }

  function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }

  return function useResource(): Resource<T> {
    const value = useSyncExternalStore(subscribe, () => state, () => SERVER);
    useEffect(() => { void load(); }, []);
    return value;
  };
}

export const useCountries = createListResource<ExploreCountry>('/api/countries');
export const useTags = createListResource<ExploreTag>('/api/tags');

async function fetchStations(url: string, signal?: AbortSignal): Promise<Station[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as unknown;
  return Array.isArray(json) ? (json as Station[]) : [];
}

export function fetchStationsByCountry(code: string, signal?: AbortSignal): Promise<Station[]> {
  return fetchStations(`/api/stations?country=${encodeURIComponent(code)}`, signal);
}

export function fetchStationsByTag(tag: string, signal?: AbortSignal): Promise<Station[]> {
  return fetchStations(`/api/stations?tag=${encodeURIComponent(tag)}`, signal);
}

// Curated genres for the Explore landing chips — a clean, recognizable subset
// of radio-browser's (thousands of) tags. Station counts are joined in from
// useTags() by name, and the same string is the drill-in query, so each entry
// must match radio-browser's exact tag spelling (verified against /json/tags)
// — e.g. "hiphop"/"rnb", not "hip hop"/"r&b" (which fragment into low counts).
export const GENRES = [
  'pop', 'rock', 'jazz', 'classical', 'electronic', 'dance',
  'hiphop', 'rnb', 'soul', 'funk', 'disco', 'metal',
  'punk', 'alternative', 'indie', 'country', 'folk', 'blues',
  'reggae', 'latin', 'house', 'techno', 'ambient', 'lounge',
  'chillout', 'oldies', '70s', '80s', '90s', 'news',
  'talk', 'sports',
] as const;
