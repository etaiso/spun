# Tracked-Station Playlist History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tracked stations a persistent, gap-aware playlist history (the same kind the selected station has), built from their background SSE and shown when you navigate to the station.

**Architecture:** A new localStorage-only store (`radio:trackingHistory`, no staleness) holds per-station history. Pure reducers (`applyConnect`/`applyHeartbeat`/`applyTrack`) own all logic — recording finished songs, capping growth, and inserting a gap marker when tracking resumes after a pause. The non-active tracked rows (`TrackedStationRow`) and the active station (`NowPlaying`) both feed this store, mutually exclusively, so no song is double-recorded. The existing ephemeral `radio:sessions` cache is left untouched for non-tracked stations.

**Tech Stack:** Next.js 16 / React 19 / TypeScript (strict) · localStorage · Server-Sent Events · Vitest.

---

## Background for the implementer (read once)

Spun shows what's playing on live radio. Two flows build "playlist history":

1. **Selected station** — `app/components/NowPlaying.tsx` opens an SSE to
   `/api/now-playing`. The SSE emits a `{type:'track', title}` event **only when
   the title changes**. On each change, the component pushes the *previous*
   title onto a `history` array (newest first) and persists it per-station to the
   `radio:sessions` localStorage cache (`app/lib/session.ts`). That cache
   self-erases after 5 minutes — fine for "switch back" but wrong for tracking.

2. **Tracked stations** — `app/components/TrackingPanel.tsx` renders a
   `TrackedStationRow` per tracked station. Each non-active row opens its **own**
   background SSE and updates only its "current" status; it **never appends to
   history**. The active (currently-playing) station opens **no** row SSE — to
   avoid double recognition — so `NowPlaying` is the only watcher for it.

This plan makes both watchers record into a new durable store, and renders a
"no tracking" divider where tracking paused.

Key existing types (`app/lib/nowPlayingTypes.ts`):
```ts
export type TrackSource = 'metadata' | 'shazam';
export type HistoryEntry = { time: string; title: string };
```

Conventions to follow:
- Pure logic is exported as plain functions and unit-tested directly (see
  `app/lib/savedSongs.ts` + `tests/savedSongs.test.ts`).
- localStorage-only stores use `window.localStorage` directly with try/catch (see
  `app/lib/session.ts`) — **not** `persistSet` (that syncs to SQLite, which we do
  not want here).
- Tests live in `tests/<module>.test.ts`, run with `npm test` (Vitest, node env).
- Typecheck with `npx tsc --noEmit`. Lint with `npm run lint`.

Commit after every task. Each task leaves the codebase compiling and green.

---

## Task 1: History types — `at`, gap marker, and `isGap`

**Files:**
- Modify: `app/lib/nowPlayingTypes.ts`
- Test: `tests/nowPlayingTypes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/nowPlayingTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isGap } from '../app/lib/nowPlayingTypes';
import type { HistoryItem } from '../app/lib/nowPlayingTypes';

describe('isGap', () => {
  it('is true for a gap marker and false for a song entry', () => {
    const gap: HistoryItem = { gap: true, fromAt: 1, toAt: 2 };
    const song: HistoryItem = { time: '10:00', title: 'A - B', at: 3 };
    expect(isGap(gap)).toBe(true);
    expect(isGap(song)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- nowPlayingTypes`
Expected: FAIL — `isGap` / `HistoryItem` not exported.

- [ ] **Step 3: Implement the types and guard**

Replace the contents of `app/lib/nowPlayingTypes.ts` with:

```ts
// Shared now-playing types, used by the NowPlaying component, the session
// cache (lib/session.ts), and the tracking-history store (lib/trackingHistory.ts).

export type TrackSource = 'metadata' | 'shazam';

// A logged song. `at` (epoch ms) is set for tracking-history entries — it drives
// gap math and humanized durations. `time` (HH:MM) is for display. `at` is
// optional so pre-existing session entries (which lack it) remain valid.
export type HistoryEntry = { time: string; title: string; at?: number };

// A "tracking paused" marker between an older run and a newer one.
// fromAt = last activity before the pause; toAt = when tracking resumed.
export type HistoryGap = { gap: true; fromAt: number; toAt: number };

export type HistoryItem = HistoryEntry | HistoryGap;

export function isGap(i: HistoryItem): i is HistoryGap {
  return 'gap' in i;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- nowPlayingTypes`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (`HistoryEntry` gained only an optional field; `HistoryItem`/`isGap` are new and not yet consumed).

- [ ] **Step 6: Commit**

```bash
git add app/lib/nowPlayingTypes.ts tests/nowPlayingTypes.test.ts
git commit -m "feat: add gap-aware history types (HistoryItem, isGap)"
```

---

## Task 2: `applyTrack` reducer + store scaffolding

Records a finished song: dedupes consecutive re-broadcasts, consumes an armed
gap (placing it beneath the resumed run), and caps growth.

**Files:**
- Create: `app/lib/trackingHistory.ts`
- Test: `tests/trackingHistory.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/trackingHistory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  emptyStation, applyTrack, CAP,
  type StationHistory,
} from '../app/lib/trackingHistory';
import { isGap } from '../app/lib/nowPlayingTypes';

describe('applyTrack', () => {
  it('prepends a finished song with an HH:MM time derived from `at`', () => {
    // Build `at` from a LOCAL date so the expected HH:MM is timezone-independent
    // (hhmm() reads local hours/minutes).
    const at = new Date(2026, 0, 1, 9, 5).getTime();
    const s = applyTrack(emptyStation(), 'Artist - Song', at);
    expect(s.items).toHaveLength(1);
    const e = s.items[0];
    expect(isGap(e)).toBe(false);
    if (!isGap(e)) {
      expect(e.title).toBe('Artist - Song');
      expect(e.at).toBe(at);
      expect(e.time).toBe('09:05');
    }
    expect(s.lastActiveAt).toBe(at);
  });

  it('keeps newest first', () => {
    let s = emptyStation();
    s = applyTrack(s, 'first', 1000);
    s = applyTrack(s, 'second', 2000);
    expect(s.items.map(i => (isGap(i) ? 'GAP' : i.title))).toEqual(['second', 'first']);
  });

  it('skips a consecutive re-broadcast of the same song (no duplicate)', () => {
    let s = applyTrack(emptyStation(), 'same', 1000);
    s = applyTrack(s, 'same', 2000);
    expect(s.items).toHaveLength(1);
    expect(s.lastActiveAt).toBe(2000); // still bumps activity
  });

  it('consumes an armed gap, placing it BELOW the resumed song', () => {
    const s0: StationHistory = {
      items: [{ time: '08:00', title: 'old', at: 1000 }],
      lastActiveAt: 1000,
      gapFromAt: 1000,
    };
    const s1 = applyTrack(s0, 'new', 9000);
    expect(s1.items.map(i => (isGap(i) ? 'GAP' : i.title))).toEqual(['new', 'GAP', 'old']);
    const gap = s1.items[1];
    expect(isGap(gap) && gap.fromAt).toBe(1000);
    expect(isGap(gap) && gap.toAt).toBe(9000);
    expect(s1.gapFromAt).toBeUndefined(); // gap consumed
  });

  it('caps the list at CAP items (gaps count)', () => {
    let s = emptyStation();
    for (let i = 0; i < CAP + 10; i++) s = applyTrack(s, `song ${i}`, i + 1);
    expect(s.items).toHaveLength(CAP);
    const newest = s.items[0];
    expect(isGap(newest) ? '' : newest.title).toBe(`song ${CAP + 9}`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- trackingHistory`
Expected: FAIL — module `app/lib/trackingHistory` not found.

- [ ] **Step 3: Implement the reducer + scaffolding**

Create `app/lib/trackingHistory.ts`:

```ts
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
    return { ...s, lastActiveAt: at };
  }
  let items = s.items;
  if (s.gapFromAt !== undefined) {
    items = [{ gap: true, fromAt: s.gapFromAt, toAt: at }, ...items];
  }
  items = [{ time: hhmm(at), title: finishedTitle, at }, ...items].slice(0, CAP);
  return { items, lastActiveAt: at }; // gapFromAt dropped (consumed)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- trackingHistory`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add app/lib/trackingHistory.ts tests/trackingHistory.test.ts
git commit -m "feat: applyTrack reducer for tracking history"
```

---

## Task 3: `applyConnect` / `applyHeartbeat` — gap arming

**Files:**
- Modify: `app/lib/trackingHistory.ts`
- Test: `tests/trackingHistory.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/trackingHistory.test.ts`:

```ts
import { applyConnect, applyHeartbeat, GAP_MS } from '../app/lib/trackingHistory';

describe('applyConnect', () => {
  it('does not arm a gap on the very first connect (no items yet)', () => {
    const s = applyConnect(emptyStation(), 1_000_000);
    expect(s.gapFromAt).toBeUndefined();
    expect(s.lastActiveAt).toBe(1_000_000);
  });

  it('arms a gap when reconnecting after longer than GAP_MS', () => {
    const base: StationHistory = { items: [{ time: '08:00', title: 'old', at: 1000 }], lastActiveAt: 1000 };
    const s = applyConnect(base, 1000 + GAP_MS + 1);
    expect(s.gapFromAt).toBe(1000);
    expect(s.lastActiveAt).toBe(1000 + GAP_MS + 1);
  });

  it('does NOT arm a gap for a short blip under GAP_MS', () => {
    const base: StationHistory = { items: [{ time: '08:00', title: 'old', at: 1000 }], lastActiveAt: 1000 };
    const s = applyConnect(base, 1000 + GAP_MS - 1);
    expect(s.gapFromAt).toBeUndefined();
  });
});

describe('applyHeartbeat', () => {
  it('bumps lastActiveAt so a long quiet song is not mistaken for a gap', () => {
    const base: StationHistory = { items: [{ time: '08:00', title: 'old', at: 1000 }], lastActiveAt: 1000 };
    const beat = applyHeartbeat(base, 1000 + 10 * 60_000); // 10 min of heartbeats
    const s = applyConnect(beat, 1000 + 10 * 60_000 + 30_000); // reconnect 30s later
    expect(s.gapFromAt).toBeUndefined(); // no false gap
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- trackingHistory`
Expected: FAIL — `applyConnect` / `applyHeartbeat` not exported.

- [ ] **Step 3: Implement the two reducers**

In `app/lib/trackingHistory.ts`, add after `hhmm` (before `applyTrack`):

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- trackingHistory`
Expected: PASS (8 cases total).

- [ ] **Step 5: Commit**

```bash
git add app/lib/trackingHistory.ts tests/trackingHistory.test.ts
git commit -m "feat: applyConnect/applyHeartbeat gap arming"
```

---

## Task 4: `humanizeGap` — duration label

**Files:**
- Modify: `app/lib/trackingHistory.ts`
- Test: `tests/trackingHistory.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/trackingHistory.test.ts`:

```ts
import { humanizeGap } from '../app/lib/trackingHistory';

describe('humanizeGap', () => {
  const MS = 60_000;
  it('formats minutes, hours, and days', () => {
    expect(humanizeGap(0, 5 * MS)).toBe('~5 min');
    expect(humanizeGap(0, 2 * 60 * MS)).toBe('~2 hr');
    expect(humanizeGap(0, 25 * 60 * MS)).toBe('~1 day');
    expect(humanizeGap(0, 72 * 60 * MS)).toBe('~3 days');
  });
  it('never shows less than ~1 min', () => {
    expect(humanizeGap(0, 10_000)).toBe('~1 min');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- trackingHistory`
Expected: FAIL — `humanizeGap` not exported.

- [ ] **Step 3: Implement**

In `app/lib/trackingHistory.ts`, add at the end of the file:

```ts
/** A short, friendly label for a gap's duration: "~5 min", "~2 hr", "~3 days". */
export function humanizeGap(fromAt: number, toAt: number): string {
  const min = Math.max(1, Math.round((toAt - fromAt) / 60_000));
  if (min < 60) return `~${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `~${hr} hr`;
  const days = Math.round(hr / 24);
  return `~${days} day${days === 1 ? '' : 's'}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- trackingHistory`
Expected: PASS (10 cases total).

- [ ] **Step 5: Commit**

```bash
git add app/lib/trackingHistory.ts tests/trackingHistory.test.ts
git commit -m "feat: humanizeGap duration label"
```

---

## Task 5: localStorage wrappers — `loadTrackingHistory`, `noteConnect`, `heartbeat`, `recordTrack`

Thin DOM wrappers over the reducers. Not unit-tested (node has no localStorage;
this mirrors the untested `app/lib/session.ts`). Verified later in the preview.

**Files:**
- Modify: `app/lib/trackingHistory.ts`

- [ ] **Step 1: Implement the wrappers**

In `app/lib/trackingHistory.ts`, add at the end of the file:

```ts
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

/** Call when a new real track replaces `finishedTitle` (which just ended). */
export function recordTrack(stationId: string, finishedTitle: string): void {
  mutate(stationId, s => applyTrack(s, finishedTitle, Date.now()));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite (nothing regressed)**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add app/lib/trackingHistory.ts
git commit -m "feat: localStorage wrappers for tracking history"
```

---

## Task 6: Keep `radio:trackingHistory` out of SQLite sync

`persist.ts` `hydrateFromServer` pushes local-only `radio:*` keys up to the
server on first run, but skips the ephemeral `radio:sessions`. Add
`radio:trackingHistory` to that exclusion via a small testable predicate.

**Files:**
- Modify: `app/lib/persist.ts:78-82` (the first-run import loop)
- Test: `tests/persist.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/persist.test.ts`:

```ts
import { isEphemeralKey } from '../app/lib/persist';

describe('isEphemeralKey', () => {
  it('flags the localStorage-only caches that must never be synced up', () => {
    expect(isEphemeralKey('radio:sessions')).toBe(true);
    expect(isEphemeralKey('radio:trackingHistory')).toBe(true);
  });
  it('does not flag durable keys', () => {
    expect(isEphemeralKey('radio:favorites')).toBe(false);
    expect(isEphemeralKey('radio:savedSongs')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- persist`
Expected: FAIL — `isEphemeralKey` not exported.

- [ ] **Step 3: Implement the predicate and use it**

In `app/lib/persist.ts`, add this exported function just above `hydrateFromServer`
(after `localOnlyKeys`):

```ts
/** radio:* caches that live only in localStorage and must never be synced to
 *  the server (ephemeral now-playing cache + durable-but-local tracking history). */
export function isEphemeralKey(key: string): boolean {
  return key === 'radio:sessions' || key === 'radio:trackingHistory';
}
```

Then in `hydrateFromServer`, replace this line:

```ts
    if (key === 'radio:sessions') continue; // ephemeral now-playing cache, not synced
```

with:

```ts
    if (isEphemeralKey(key)) continue; // localStorage-only caches, not synced
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- persist`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/persist.ts tests/persist.test.ts
git commit -m "feat: exclude radio:trackingHistory from server sync"
```

---

## Task 7: Render gap dividers in `PlaylistHistory`

Widen the component to `HistoryItem[]` and render a gap as a centered "no
tracking" divider. (`HistoryEntry[]` is assignable to `HistoryItem[]`, so the
current caller in `page.tsx` keeps compiling until Task 8 widens it.)

**Files:**
- Modify: `app/components/PlaylistHistory.tsx`

- [ ] **Step 1: Replace the component**

Replace the contents of `app/components/PlaylistHistory.tsx` with:

```tsx
'use client';

import { splitArtistTitle } from '@/app/lib/track';
import { humanizeGap } from '@/app/lib/trackingHistory';
import { isGap } from '@/app/lib/nowPlayingTypes';
import type { HistoryItem } from '@/app/lib/nowPlayingTypes';

// Session playlist log, rendered below the player controls. Carries a solid
// background + soft feather so the pulse rings dissolve smoothly into it.
// Tracked stations may include "no tracking" gap markers between runs.
export function PlaylistHistory({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) return null;

  return (
    <div className="relative z-10 bg-[var(--color-bg)]">
      <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">
        ▾ Playlist history
      </div>
      {history.map((h, i) => {
        if (isGap(h)) {
          return (
            <div
              key={i}
              className="flex items-center gap-3 py-3 text-[10px] tracking-[1.4px] uppercase font-bold text-[var(--color-ink-4)]"
            >
              <span className="flex-1 h-px bg-[var(--color-line)]" aria-hidden="true" />
              <span className="shrink-0">⋯ no tracking · {humanizeGap(h.fromAt, h.toAt)} ⋯</span>
              <span className="flex-1 h-px bg-[var(--color-line)]" aria-hidden="true" />
            </div>
          );
        }
        const { artist, title } = splitArtistTitle(h.title);
        return (
          <div
            key={i}
            className="grid grid-cols-[64px_1fr] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none"
          >
            <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
            <div className="text-base text-[var(--color-ink-2)]">
              {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`page.tsx` still passes `HistoryEntry[]`, which is a valid `HistoryItem[]`.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/PlaylistHistory.tsx
git commit -m "feat: render no-tracking gap dividers in PlaylistHistory"
```

---

## Task 8: Widen `page.tsx` history state to `HistoryItem[]`

Done before `NowPlaying` so that when `NowPlaying` starts emitting gap-bearing
`HistoryItem[]`, the page's `setPlaylistHistory` already accepts it.

**Files:**
- Modify: `app/page.tsx:22` (import) and `app/page.tsx:31` (state type)

- [ ] **Step 1: Update the import**

In `app/page.tsx`, change:

```ts
import type { HistoryEntry } from './lib/nowPlayingTypes';
```

to:

```ts
import type { HistoryItem } from './lib/nowPlayingTypes';
```

- [ ] **Step 2: Update the state type**

In `app/page.tsx`, change:

```ts
  const [playlistHistory, setPlaylistHistory] = useState<HistoryEntry[]>([]);
```

to:

```ts
  const [playlistHistory, setPlaylistHistory] = useState<HistoryItem[]>([]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`NowPlaying`'s `onHistory` still emits `HistoryEntry[]`, assignable to the now-`HistoryItem[]` setter.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "refactor: widen page playlistHistory to HistoryItem[]"
```

---

## Task 9: Build history in `TrackedStationRow` (non-active tracked stations)

Wire the background SSE to record finished songs, heartbeat while open, and note
(re)connects for gap detection.

**Files:**
- Modify: `app/components/TrackingPanel.tsx`

- [ ] **Step 1: Add the imports**

In `app/components/TrackingPanel.tsx`, change the React import and add the store
import. Change:

```ts
import { useEffect, useState } from 'react';
```

to:

```ts
import { useEffect, useRef, useState } from 'react';
```

And add, below the existing `import { loadSession, saveSession } from '@/app/lib/session';` line:

```ts
import { noteConnect, heartbeat, recordTrack, HEARTBEAT_MS } from '@/app/lib/trackingHistory';
```

- [ ] **Step 2: Seed a previous-title ref**

In `TrackedStationRow`, immediately after the existing `const [status, setStatus] = useState<Status>(...)` block (right before the `useEffect`), add this ref. It mirrors `NowPlaying`: remember the last real title so that when a NEW one arrives we can log the one that just finished. The IIFE computes the seed once at mount from the session cache (the same source the status seed uses), so a song spanning a remount still logs:

```ts
  const prevTitleRef = useRef<string | null>(
    (() => {
      const s = loadSession(station.id);
      return s?.current && !isNonTrack(s.current.raw, station.name) ? s.current.raw : null;
    })(),
  );
```

- [ ] **Step 3: Rewrite the SSE effect to record history**

Replace the entire `useEffect(() => { ... }, [active, station.streamUrl, station.name, station.id]);` block with:

```ts
  useEffect(() => {
    // The active station is recognised by NowPlaying; don't open a second SSE.
    if (active) return;

    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);

    // Fires on first connect AND on EventSource auto-reconnect, so a network
    // drop longer than GAP_MS surfaces as a "no tracking" gap.
    es.onopen = () => noteConnect(station.id);

    // Keep lastActiveAt fresh while genuinely connected, so a long quiet song
    // isn't later mistaken for a gap. Gated on OPEN so a silent drop doesn't.
    const hb = setInterval(() => {
      if (es.readyState === EventSource.OPEN) heartbeat(station.id);
    }, HEARTBEAT_MS);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'track'; title: string; source?: TrackSource; cover?: string }
          | { type: 'no-metadata' }
          | { type: 'no-song' }
          | { type: 'recognizing' }
          | { type: 'error' };
        if (msg.type === 'track') {
          if (isNonTrack(msg.title, station.name)) {
            setStatus({ kind: 'idle' });
          } else {
            // Log the song that just finished when a NEW real title arrives.
            const prev = prevTitleRef.current;
            if (prev !== null && prev !== msg.title && !isNonTrack(prev, station.name)) {
              recordTrack(station.id, prev);
            }
            prevTitleRef.current = msg.title;
            setStatus({ kind: 'track', title: msg.title });
            // Seed the session cache so selecting this station shows the song
            // immediately (NowPlaying restores from the same store on mount).
            const prevSession = loadSession(station.id);
            saveSession(station.id, {
              current: { raw: msg.title, source: msg.source ?? 'metadata', cover: msg.cover ?? null },
              history: prevSession?.history ?? [],
              lastUpdate: nowHHMM(),
            });
          }
        } else if (msg.type === 'recognizing') {
          setStatus(prev => (prev.kind === 'track' ? prev : { kind: 'recognizing' }));
        } else if (msg.type === 'no-song' || msg.type === 'no-metadata') {
          setStatus(prev => (prev.kind === 'track' ? prev : { kind: 'idle' }));
        }
      } catch { /* ignore malformed frames */ }
    };
    return () => { es.close(); clearInterval(hb); };
  }, [active, station.streamUrl, station.name, station.id]);
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all green (no unit tests target this file; confirming nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add app/components/TrackingPanel.tsx
git commit -m "feat: build playlist history for tracked stations"
```

---

## Task 10: Feed + restore tracking history in `NowPlaying` (active station)

When the selected station is tracked, `NowPlaying` seeds its history from the
tracking store and records into it (the active station opens no row SSE, so this
keeps history growing while you listen). When not tracked, behavior is unchanged.

**Files:**
- Modify: `app/components/NowPlaying.tsx`

- [ ] **Step 1: Add imports**

In `app/components/NowPlaying.tsx`, add these imports alongside the existing ones:

```ts
import { useTracking } from '@/app/lib/tracking';
import { loadTrackingHistory, recordTrack, noteConnect, heartbeat, HEARTBEAT_MS } from '@/app/lib/trackingHistory';
import { isGap } from '@/app/lib/nowPlayingTypes';
import type { HistoryItem } from '@/app/lib/nowPlayingTypes';
```

(The file already imports `HistoryEntry` and `TrackSource` from `nowPlayingTypes`; keep those and add `HistoryItem`.)

- [ ] **Step 2: Compute `tracked` and keep a live ref**

In the `NowPlaying` function body, just after `const { isFavorite, toggle: toggleFavorite } = useFavorites();`, add:

```ts
  const { isTracked } = useTracking();
  const tracked = isTracked(station.id);
```

Then, just after the existing `const onTrackRef = useRef(onTrack); useEffect(() => { onTrackRef.current = onTrack; });` block, add a live ref so the SSE handler reads the current tracked state without re-subscribing:

```ts
  // Live tracked-state for the SSE handler (avoids re-opening the stream when
  // tracking toggles).
  const trackedRef = useRef(tracked);
  useEffect(() => { trackedRef.current = tracked; });
```

- [ ] **Step 3: Seed history from the tracking store when tracked**

Change the history state declaration. From:

```ts
  const [history, setHistory] = useState<HistoryEntry[]>(restored?.history ?? []);
```

to:

```ts
  // Tracked stations restore their durable, gap-aware history; everyone else
  // restores the (≤5-min) session history as before.
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    isTracked(station.id) ? loadTrackingHistory(station.id) : (restored?.history ?? []),
  );
```

- [ ] **Step 4: Update the `onHistory` prop type**

In the `Props` type, change:

```ts
  onHistory?: (history: HistoryEntry[]) => void;
```

to:

```ts
  onHistory?: (history: HistoryItem[]) => void;
```

- [ ] **Step 5: Persist session history only when NOT tracked**

Replace the session-persist effect. From:

```ts
  useEffect(() => {
    saveSession(station.id, {
      current: currentRaw ? { raw: currentRaw, source: currentSource, cover: currentCover } : null,
      history,
      lastUpdate,
    });
  }, [station.id, currentRaw, currentSource, currentCover, history, lastUpdate]);
```

to:

```ts
  useEffect(() => {
    saveSession(station.id, {
      current: currentRaw ? { raw: currentRaw, source: currentSource, cover: currentCover } : null,
      // Tracked stations persist history to the durable trackingHistory store
      // instead; keep the ephemeral session for `current` only (its quick-restore
      // seed). Gaps never occur for non-tracked stations, so the filter is a
      // type-narrowing no-op there.
      history: tracked ? [] : history.filter((h): h is HistoryEntry => !isGap(h)),
      lastUpdate,
    });
  }, [station.id, currentRaw, currentSource, currentCover, history, lastUpdate, tracked]);
```

- [ ] **Step 6: Record finished songs to the right store**

In the SSE `onmessage` handler, find the `msg.type === 'track'` branch and its
history-append lines:

```ts
          const prev = prevTitleRef.current;
          if (prev === msg.title) return;
          if (prev !== null && !isNonTrack(prev, station.name)) {
            setHistory(h => [{ time: nowHHMM(), title: prev }, ...h].slice(0, 50));
          }
          prevTitleRef.current = msg.title;
          setCurrentRaw(msg.title);
```

Replace those lines with:

```ts
          const prev = prevTitleRef.current;
          if (prev === msg.title) return;
          if (prev !== null && !isNonTrack(prev, station.name)) {
            if (trackedRef.current) {
              // Durable, gap-aware store; reflect it back into local state.
              recordTrack(station.id, prev);
              setHistory(loadTrackingHistory(station.id));
            } else {
              setHistory(h => [{ time: nowHHMM(), title: prev }, ...h].slice(0, 50));
            }
          }
          prevTitleRef.current = msg.title;
          setCurrentRaw(msg.title);
```

- [ ] **Step 7: Note connect + heartbeat on the NowPlaying SSE when tracked**

In the main SSE effect (the one that does `const es = new EventSource(...)` and
ends with `return () => es.close();`), add `onopen` + a heartbeat. Change the
opening of that effect from:

```ts
    onTrackRef.current?.(null); // reset the sidebar marquee for the new station
    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);
```

to:

```ts
    onTrackRef.current?.(null); // reset the sidebar marquee for the new station
    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);

    // When this station is tracked, the active player is its only watcher — so
    // keep its tracking history alive here too (gap on reconnect, heartbeat
    // while open).
    es.onopen = () => { if (trackedRef.current) noteConnect(station.id); };
    const hb = setInterval(() => {
      if (trackedRef.current && es.readyState === EventSource.OPEN) heartbeat(station.id);
    }, HEARTBEAT_MS);
```

And change that effect's cleanup from:

```ts
    return () => es.close();
```

to:

```ts
    return () => { es.close(); clearInterval(hb); };
```

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add app/components/NowPlaying.tsx
git commit -m "feat: feed and restore tracking history for the active station"
```

---

## Task 11: Manual verification in the preview

No unit tests cover the wired components; verify the end-to-end behavior in the
running app.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server / preview**

Start the app (`npm run dev`, or the preview tooling) and open it.

- [ ] **Step 2: Verify history accumulates for a tracked, non-selected station**

1. Track a station (one that broadcasts ICY titles updates fastest — e.g. a pop
   station) without selecting it, and select a *different* station.
2. Let two or more songs pass on the tracked station (watch its row subtitle
   change in the Tracking panel).
3. Select the tracked station. **Expected:** the Playlist history panel under the
   player is already populated with the songs that played while you were away.

- [ ] **Step 3: Verify the part-time gap divider**

1. With history accumulated for a station, untrack it.
2. Wait longer than ~2 minutes (`GAP_MS`).
3. Track it again and let at least one new song log.
4. Select it. **Expected:** old entries below, new entries above, separated by a
   centered `⋯ no tracking · ~N min ⋯` divider with a sensible duration.

- [ ] **Step 4: Verify persistence across reload**

Reload the app mid-tracking, then select the tracked station. **Expected:**
history persists (localStorage), no errors in the console.

- [ ] **Step 5: Verify no regression for a non-tracked station**

Select a station you are NOT tracking, let a song change, switch away and back
within 5 minutes. **Expected:** the existing session-restore behavior is
unchanged; no gap dividers ever appear for it.

- [ ] **Step 6: Final full check**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

---

## Self-review notes (already reconciled)

- **Spec coverage:** history-building for tracked rows (Task 9) and active
  station (Task 10); durable no-staleness store (Tasks 2–5); gap detection
  (Task 3) + divider UI (Task 7); localStorage-only / no sync (Tasks 5, 6);
  types (Task 1); page wiring (Task 8); manual verification (Task 11).
- **Type consistency:** `StationHistory`, `HistoryItem`, `HistoryGap`,
  `isGap`, `applyConnect/applyHeartbeat/applyTrack`, `loadTrackingHistory`,
  `noteConnect`, `heartbeat`, `recordTrack`, `humanizeGap`, `HEARTBEAT_MS`,
  `GAP_MS`, `CAP` are named identically across every task that uses them.
- **Compile-safety ordering:** `HistoryEntry[]` is assignable to `HistoryItem[]`,
  so widening `PlaylistHistory` (7) and `page.tsx` (8) before `NowPlaying` (10)
  keeps every intermediate commit compiling.
