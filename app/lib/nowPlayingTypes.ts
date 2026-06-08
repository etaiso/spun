// Shared now-playing types, used by the NowPlaying component and the session
// cache (lib/session.ts).

export type TrackSource = 'metadata' | 'shazam';

export type HistoryEntry = { time: string; title: string; at?: number };
