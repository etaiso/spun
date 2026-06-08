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

/** A stable, content-based key for a history row — survives the list growing
 *  (new entries prepend), unlike an array index. Used as the React key and the
 *  active-preview id in PlaylistHistory. */
export function historyRowKey(item: HistoryItem): string {
  return isGap(item)
    ? `gap::${item.fromAt}::${item.toAt}`
    : `${item.at ?? item.time}::${item.title}`;
}
