'use client';

// Durable, per-station playlist history for TRACKED stations. Unlike the
// ephemeral radio:sessions cache (which self-erases after 5 min), this persists
// for the whole tracking duration and across reloads/restarts. localStorage
// only — never synced to SQLite (see persist.ts isEphemeralKey).
//
// All logic lives in the pure reducers below (unit-tested). The exported
// noteConnect/heartbeat/recordTrack wrappers just stamp Date.now() and persist.

import type { HistoryItem, HistoryEntry } from './nowPlayingTypes';
import { isGap } from './nowPlayingTypes';

// A pause longer than this (between losing the SSE and reconnecting) shows as a
// gap. Shorter blips — a reconnect, a select/deselect handoff — do not.
export const GAP_MS = 2 * 60_000;
// Per-station entry cap, bounding localStorage growth over long/part-time use.
export const CAP = 200;
// How often a connected watcher bumps lastActiveAt, so a long quiet song never
// reads as a tracking gap.
export const HEARTBEAT_MS = 30_000;

export type StationHistory = {
  items: HistoryItem[]; // newest first
  lastActiveAt: number; // epoch ms of the last connect / heartbeat / track
  gapFromAt?: number;   // armed on reconnect-after-pause; consumed by next applyTrack
};

export function emptyStation(): StationHistory {
  return { items: [], lastActiveAt: 0 };
}

/** Epoch ms -> "HH:MM" in local time. Pure (deterministic for a given `at`). */
export function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** On (re)connect: arm a gap if we have history and were away longer than
 *  GAP_MS. Always refresh lastActiveAt. */
export function applyConnect(s: StationHistory, at: number): StationHistory {
  const away = s.items.length > 0 && at - s.lastActiveAt > GAP_MS;
  return away ? { ...s, gapFromAt: s.lastActiveAt, lastActiveAt: at } : { ...s, lastActiveAt: at };
}

/** Heartbeat while connected — keeps lastActiveAt fresh so a long quiet song
 *  isn't later mistaken for a tracking gap. */
export function applyHeartbeat(s: StationHistory, at: number): StationHistory {
  return { ...s, lastActiveAt: at };
}

/** A short, friendly label for a gap's duration: "~5 min", "~2 hr", "~3 days". */
export function humanizeGap(fromAt: number, toAt: number): string {
  const min = Math.max(1, Math.round((toAt - fromAt) / 60_000));
  if (min < 60) return `~${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `~${hr} hr`;
  const days = Math.round(hr / 24);
  return `~${days} day${days === 1 ? '' : 's'}`;
}

/** Record a finished song. Dedupes consecutive re-broadcasts, consumes an armed
 *  gap (placing it beneath the resumed song), and caps the list. `startedAt` is
 *  the song's air-start time when known (drives timeshift jump-to-song). */
export function applyTrack(s: StationHistory, finishedTitle: string, at: number, startedAt?: number): StationHistory {
  const latestSong = s.items.find((it): it is HistoryEntry => !isGap(it));
  if (latestSong && latestSong.title === finishedTitle) {
    // Same song re-announced — don't log it again, but keep any armed gap for
    // the next genuinely new song, and record that we're still active.
    // Consequence: gapFromAt is intentionally preserved here, so the gap's
    // toAt will be the timestamp of the first genuinely-new song after
    // reconnect, not the reconnect moment itself.
    return { ...s, lastActiveAt: at };
  }
  let items = s.items;
  if (s.gapFromAt !== undefined) {
    items = [{ gap: true, fromAt: s.gapFromAt, toAt: at }, ...items];
  }
  items = [{ time: hhmm(at), title: finishedTitle, at, startedAt }, ...items].slice(0, CAP);
  return { items, lastActiveAt: at }; // gapFromAt dropped (consumed)
}

const KEY = 'radio:trackingHistory';
const EMPTY: HistoryItem[] = [];

type Store = Record<string, StationHistory>;

function readStore(): Store {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // best-effort persistence
  }
}

function mutate(stationId: string, fn: (s: StationHistory) => StationHistory): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  store[stationId] = fn(store[stationId] ?? emptyStation());
  writeStore(store);
}

/** The persisted history items for a station (newest first), or empty. */
export function loadTrackingHistory(stationId: string): HistoryItem[] {
  return readStore()[stationId]?.items ?? EMPTY;
}

/** Call when a tracked station's SSE (re)opens. */
export function noteConnect(stationId: string): void {
  mutate(stationId, s => applyConnect(s, Date.now()));
}

/** Call on the heartbeat interval while the SSE is OPEN. */
export function heartbeat(stationId: string): void {
  mutate(stationId, s => applyHeartbeat(s, Date.now()));
}

/** Call when a new real track replaces `finishedTitle` (which just ended).
 *  `startedAt` = when the finished song began airing, when known. */
export function recordTrack(stationId: string, finishedTitle: string, startedAt?: number): void {
  mutate(stationId, s => applyTrack(s, finishedTitle, Date.now(), startedAt));
}
