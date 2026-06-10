// Shared now-playing types, used by the NowPlaying component, the session
// cache (lib/session.ts), and the tracking-history store (lib/trackingHistory.ts).

export type TrackSource = 'metadata' | 'shazam';

// A logged song. `at` (epoch ms) is set for tracking-history entries — it drives
// gap math and humanized durations; it's the moment the NEXT song was announced,
// i.e. ≈ when this one ENDED. `startedAt` (epoch ms) is when it began airing
// (ICY announce time, or Shazam detection minus the match offset) — used by the
// timeshift jump-to-song affordance. `time` (HH:MM) is for display. Both epoch
// fields are optional so pre-existing entries remain valid.
export type HistoryEntry = { time: string; title: string; at?: number; startedAt?: number };

// A "tracking paused" marker between an older run and a newer one.
// fromAt = last activity before the pause; toAt = when tracking resumed.
export type HistoryGap = { gap: true; fromAt: number; toAt: number };

export type HistoryItem = HistoryEntry | HistoryGap;

export function isGap(i: HistoryItem): i is HistoryGap {
  return 'gap' in i;
}

/** A stable, content-based key for a history row — survives the list growing
 *  (new entries prepend), unlike an array index. Used as the React key and the
 *  active-preview id in PlaylistHistory. Note: two pre-`at` session entries with
 *  the same title at the same HH:MM minute would collide — harmless here (both
 *  rows resolve to the same preview), and tracking entries carry a unique `at`. */
export function historyRowKey(item: HistoryItem): string {
  return isGap(item)
    ? `gap::${item.fromAt}::${item.toAt}`
    : `${item.at ?? item.time}::${item.title}`;
}
