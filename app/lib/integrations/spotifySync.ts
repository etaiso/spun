'use client';

// Sync orchestration: resolve saved songs to Spotify tracks and append the
// matched ones to the "Spun" playlist. The bridge (network) and the store patch
// are injected, so the decision logic here is unit-tested against fakes.
//
// Non-destructive: nothing here ever removes a track from Spotify.

import { buildSearchQuery, pickBestMatch, type Candidate } from './spotifyMatch';
import type { SavedSong } from '../savedSongs';

export type SyncBridge = {
  search(query: string): Promise<Candidate[]>;
  ensurePlaylist(): Promise<{ id: string; url: string }>;
  playlistTrackIds(): Promise<string[]>;
  addTracks(uris: string[]): Promise<void>;
};

export type Patch = (id: string, patch: Partial<SavedSong>) => void;

/**
 * Songs still needing a sync attempt: no Spotify id yet and not user-skipped.
 * `not_found` is excluded by default (auto-sync doesn't retry it); "Sync now"
 * passes `includeNotFound` to re-attempt them.
 */
export function pendingSongs(list: SavedSong[], includeNotFound = false): SavedSong[] {
  return list.filter(s =>
    !s.spotifyTrackId &&
    s.syncState !== 'skipped' &&
    (includeNotFound || s.syncState !== 'not_found'));
}

/** spotify:track:<id> → <id>. */
function trackIdFromUri(uri: string): string {
  return uri.split(':').pop() || uri;
}

/**
 * Resolve each song, patch its sync state, and append newly-matched tracks
 * (deduped against what's already in the playlist). Returns counts. Throws only
 * if the playlist append itself fails fatally; per-song search errors mark that
 * song pending (left for a later run) and don't abort the batch.
 */
export async function syncSongs(songs: SavedSong[], bridge: SyncBridge, patch: Patch): Promise<{ synced: number; notFound: number }> {
  let synced = 0;
  let notFound = 0;
  const matchedUris: string[] = [];

  for (const s of songs) {
    let candidates: Candidate[];
    try {
      candidates = await bridge.search(buildSearchQuery(s));
    } catch {
      continue; // transient — leave the song pending for the next run
    }
    const match = pickBestMatch(s, candidates);
    if (match) {
      patch(s.id, { spotifyTrackId: match.id, spotifyUrl: match.url, syncState: 'synced' });
      matchedUris.push(match.uri);
      synced++;
    } else {
      patch(s.id, { syncState: 'not_found' });
      notFound++;
    }
  }

  if (matchedUris.length) {
    await bridge.ensurePlaylist();
    const existing = new Set(await bridge.playlistTrackIds());
    const toAdd = matchedUris.filter(uri => !existing.has(trackIdFromUri(uri)));
    for (let i = 0; i < toAdd.length; i += 100) {
      await bridge.addTracks(toAdd.slice(i, i + 100));
    }
  }

  return { synced, notFound };
}
