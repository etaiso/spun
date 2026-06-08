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

/** Record a finished song. Dedupes consecutive re-broadcasts, consumes an armed
 *  gap (placing it beneath the resumed song), and caps the list. */
export function applyTrack(s: StationHistory, finishedTitle: string, at: number): StationHistory {
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
  items = [{ time: hhmm(at), title: finishedTitle, at }, ...items].slice(0, CAP);
  return { items, lastActiveAt: at }; // gapFromAt dropped (consumed)
}
