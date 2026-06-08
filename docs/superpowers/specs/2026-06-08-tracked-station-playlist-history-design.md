# Tracked-Station Playlist History — Design

Maintain a persistent playlist history for **tracked** stations, the same way
the selected (now-playing) station already keeps one. Tracking runs in the
background while the app is open, so if you track a station for an hour and then
navigate to it, its playlist history is already populated. Tracking can also be
**part-time**: stop tracking (untrack, close the app, lose the network), then
track again later, and the history shows the old entries plus the new ones, with
a visible **gap marker** indicating the stretch where nothing was tracked.

## Goals

- Build playlist history for tracked stations from their background SSE — the
  same "record the previous song when a new one starts" logic the selected
  station already uses.
- History survives the full tracking duration (no 5-minute staleness) and across
  reloads / app restarts (localStorage, no expiry).
- Selecting a tracked station shows its accumulated history in the existing
  `PlaylistHistory` panel under the player.
- Part-time tracking: untrack → re-track shows old + new history separated by a
  gap indicator. Same for "app closed in between" and "network dropped".
- No regression to the existing selected-station session cache (`radio:sessions`)
  or its 5-minute "switch back" behavior for non-tracked stations.

## Non-goals

- Server-side / SQLite sync. Per the decision, tracking history is localStorage
  only (survives reloads and app restarts; lost only on clearing browser data).
  It is **not** pushed to `/api/state`.
- A server-side background tracker. History is only built while the app is open
  and the station is being tracked (the `TrackingPanel` is mounted whenever
  `tracked.length > 0`).
- Showing history inline inside the tracking-panel rows, or a "clear history"
  control. Out of scope (YAGNI). History is viewed by navigating to the station.

## Why a dedicated store (vs. overloading `radio:sessions`)

The existing `radio:sessions` cache is deliberately ephemeral: `loadSession`
discards anything older than 5 minutes and `saveSession` prunes stale entries on
every write. That's correct for the selected station ("radio metadata moves on")
but wrong for tracking, which must persist for hours and across gaps. Rather than
give one store two lifetimes (and couple `session.ts` to tracking state), we add
a **separate durable store** for tracking history. The session cache is left
untouched, so the selected-station UX cannot regress.

## Data model

**Types** (`app/lib/nowPlayingTypes.ts`):

```ts
export type HistoryEntry = { time: string; title: string; at?: number };
// at = epoch ms; needed for gap math + humanized durations. `time` (HH:MM)
// stays for display. Optional so existing session entries remain valid.

export type HistoryGap = { gap: true; fromAt: number; toAt: number };
// fromAt = last activity before the pause, toAt = when tracking resumed.

export type HistoryItem = HistoryEntry | HistoryGap;

export function isGap(i: HistoryItem): i is HistoryGap; // 'gap' in i
```

The displayed history array widens from `HistoryEntry[]` to `HistoryItem[]`
(through `page.tsx`'s `playlistHistory`, `NowPlaying`'s `onHistory`, and
`PlaylistHistory`). Non-tracked stations simply never contain gap items.

**Store** (`app/lib/trackingHistory.ts`, localStorage only, no expiry). Key:
`radio:trackingHistory`.

```ts
type StationHistory = {
  items: HistoryItem[];   // newest first, same ordering as session history
  lastActiveAt: number;   // last time the SSE was alive (heartbeat / track / connect)
  gapFromAt?: number;     // armed on reconnect-after-pause; consumed by next recordTrack
};
type Store = Record<string, StationHistory>;
```

Constants: `GAP_MS = 2 * 60_000` (a pause longer than this shows as a gap),
`CAP = 200` (per-station item cap), heartbeat interval `30_000`.

**Pure reducers** (no DOM — unit-testable), each takes and returns a
`StationHistory`:

- `applyConnect(s, at)` — if `s.items.length && at - s.lastActiveAt > GAP_MS`,
  arm a gap (`gapFromAt = s.lastActiveAt`). Always set `lastActiveAt = at`.
- `applyHeartbeat(s, at)` — `lastActiveAt = at`.
- `applyTrack(s, finishedTitle, at)` — record a finished song:
  - skip if `finishedTitle` equals the most-recent song item's title
    (consecutive-dupe guard);
  - if `gapFromAt` is set, unshift `{ gap: true, fromAt: gapFromAt, toAt: at }`
    and clear it, **then** unshift the song — yielding `[song, GAP, …older]`,
    so the gap sits between the resumed run and the old history;
  - unshift `{ time: hhmm(at), title: finishedTitle, at }`;
  - cap to `CAP` items; set `lastActiveAt = at`.

**Thin wrappers** over localStorage (try/catch → empty, like `session.ts`):
`loadTrackingHistory(id): HistoryItem[]`, and `noteConnect(id)`,
`heartbeat(id)`, `recordTrack(id, finishedTitle)` that read the entry, apply the
matching reducer with `Date.now()`, and write back. Plus a pure
`humanizeGap(fromAt, toAt): string` ("~5 min", "~2 hr", "~1 day").

## Who writes history (mutually exclusive — no double-recording)

A station being tracked is watched by exactly one place at a time:

- **Non-active tracked stations** — `TrackedStationRow` (in `TrackingPanel.tsx`)
  already opens the background SSE for these; today it only updates `current` and
  never appends. Add:
  - `es.onopen → noteConnect(station.id)` (fires on first connect *and* on
    EventSource auto-reconnect, so network-drop gaps are caught);
  - a `heartbeat(station.id)` interval (every 30s) that bumps `lastActiveAt`
    **only while `es.readyState === EventSource.OPEN`** — so a long song never
    reads as a false gap, but a genuine pause does;
  - a `prevTitleRef`; on a new real track, `recordTrack(station.id, prevTitle)`
    then advance the ref (mirroring `NowPlaying`). Keep writing `current` to the
    session cache as today (the row's instant-restore seed).

- **The active (selected) station** — `NowPlaying`. The active station opens no
  row-SSE (to avoid double recognition), so `NowPlaying` must feed the tracking
  store while you listen, *but only when `isTracked(station.id)`*. It wires the
  same `noteConnect` (on its EventSource open), `heartbeat`, and `recordTrack`
  calls. When the station is **not** tracked, `NowPlaying` behaves exactly as
  today (session cache only).

Because the active row in `TrackingPanel` deliberately opens no SSE, only one
writer is ever active per station; the handoff on select/deselect is a few
seconds, well under `GAP_MS`.

## Display

- `NowPlaying` seeds its `history` state from `loadTrackingHistory(id)` when the
  station is tracked, else from the restored session (`restored?.history ?? []`)
  as today. It keeps writing `session.current` always (so the tracking row's
  seed still works), but writes `session.history` **only when not tracked** —
  for tracked stations the dedicated store is the source of truth.
- `PlaylistHistory` accepts `HistoryItem[]` and renders a gap item as a subtle
  centered divider between rows, e.g. `⋯ no tracking · ~2h ⋯` (warm, uppercase,
  matching the existing section styling), with the duration from
  `humanizeGap(fromAt, toAt)`. Song rows render unchanged.

## Edge cases & error handling

- Malformed / absent localStorage → empty history (try/catch, like `session.ts`).
- EventSource auto-reconnect is handled by `onopen` re-firing `noteConnect`;
  the heartbeat is gated on `readyState === OPEN` so it doesn't paper over a
  silent drop.
- App restart: `lastActiveAt` persists; on reopen, the first `onopen` sees a
  large `now - lastActiveAt` and arms a gap, which the next recorded song
  realizes (so a gap won't dangle at the very top before any new song arrives).
- Select ↔ deselect of a tracked station hands writing between `TrackedStationRow`
  and `NowPlaying` against the same store, so history stays continuous.
- `persist.ts` `hydrateFromServer` skips `radio:trackingHistory` in the first-run
  local-only import (don't sync it up), mirroring the existing `radio:sessions`
  skip.
- Per-station `CAP` bounds growth; consecutive-dupe guard avoids re-logging a
  re-broadcast of the same title.

## Files

- `app/lib/nowPlayingTypes.ts` — `HistoryEntry.at`, `HistoryGap`, `HistoryItem`,
  `isGap` (edit)
- `app/lib/trackingHistory.ts` — store + pure reducers + `humanizeGap` (new)
- `app/components/TrackingPanel.tsx` — `prevTitleRef`, `onopen`/heartbeat/record
  wiring in `TrackedStationRow` (edit)
- `app/components/NowPlaying.tsx` — seed from tracking store + feed it when
  tracked; gate session.history write on not-tracked (edit)
- `app/components/PlaylistHistory.tsx` — render gap dividers; accept
  `HistoryItem[]` (edit)
- `app/page.tsx` — widen `playlistHistory` / `onHistory` to `HistoryItem[]` (edit)
- `app/lib/persist.ts` — skip `radio:trackingHistory` on first-run import (edit)

## Testing

- **Unit (Vitest, pure reducers):** history build (record previous on change);
  `CAP` enforcement; consecutive-dupe guard; gap armed when `> GAP_MS` and not
  when under; gap placement order (`[song, GAP, …older]`); heartbeat keeps
  `lastActiveAt` fresh so a long quiet stretch isn't a false gap; `humanizeGap`
  buckets.
- **Manual / preview:** track a station, let a couple of songs pass, select it →
  history populated in the panel; untrack, wait, re-track → old + new with a gap
  divider; reload mid-tracking → history persists; listening to a tracked
  station continues its history seamlessly; a non-tracked station's 5-minute
  session behavior is unchanged.
