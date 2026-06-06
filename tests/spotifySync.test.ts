import { describe, it, expect } from 'vitest';
import { pendingSongs, syncSongs, type SyncBridge } from '../app/lib/integrations/spotifySync';
import type { SavedSong } from '../app/lib/savedSongs';
import type { Candidate } from '../app/lib/integrations/spotifyMatch';

const mk = (over: Partial<SavedSong>): SavedSong => ({
  id: 'x', title: 'T', artist: 'A', raw: '', cover: '',
  shazamUrl: '', appleMusicUrl: '', previewUrl: '', stationName: '', savedAt: 0, ...over,
});

describe('pendingSongs', () => {
  const list = [
    mk({ id: 'fresh' }),
    mk({ id: 'done', spotifyTrackId: 'sp1', syncState: 'synced' }),
    mk({ id: 'skip', syncState: 'skipped' }),
    mk({ id: 'miss', syncState: 'not_found' }),
  ];
  it('selects un-synced, non-skipped songs and excludes not_found by default', () => {
    expect(pendingSongs(list).map(s => s.id)).toEqual(['fresh']);
  });
  it('includes not_found when asked (manual Sync now)', () => {
    expect(pendingSongs(list, true).map(s => s.id)).toEqual(['fresh', 'miss']);
  });
});

function fakeBridge(existing: string[] = []): SyncBridge & { added: string[][] } {
  const playlist = new Set(existing);
  const added: string[][] = [];
  const exact: Candidate = {
    id: 'A', uri: 'spotify:track:A', url: 'https://open.spotify.com/track/A',
    name: 'Fast Car', artists: ['Tracy Chapman'],
  };
  return {
    added,
    async search(q) { return q.includes('Fast Car') ? [exact] : []; },
    async ensurePlaylist() { return { id: 'pl', url: 'https://open.spotify.com/playlist/pl' }; },
    async playlistTrackIds() { return [...playlist]; },
    async addTracks(uris) { added.push(uris); uris.forEach(u => playlist.add(u.split(':').pop()!)); },
  };
}

describe('syncSongs', () => {
  const fastCar = mk({ id: 'fc', title: 'Fast Car', artist: 'Tracy Chapman' });
  const obscure = mk({ id: 'ob', title: 'Obscure', artist: 'Nobody' });

  it('matches, patches state, and appends matched tracks', async () => {
    const bridge = fakeBridge();
    const patches: Record<string, Partial<SavedSong>> = {};
    const patch = (id: string, p: Partial<SavedSong>) => { patches[id] = { ...patches[id], ...p }; };

    const counts = await syncSongs([fastCar, obscure], bridge, patch);

    expect(counts).toEqual({ synced: 1, notFound: 1 });
    expect(patches.fc).toMatchObject({ spotifyTrackId: 'A', syncState: 'synced' });
    expect(patches.fc.spotifyUrl).toContain('open.spotify.com/track/A');
    expect(patches.ob).toEqual({ syncState: 'not_found' });
    expect(bridge.added).toEqual([['spotify:track:A']]);
  });

  it('does not re-add a track already in the playlist', async () => {
    const bridge = fakeBridge(['A']); // already present
    const counts = await syncSongs([fastCar], bridge, () => {});
    expect(counts.synced).toBe(1);     // still resolved/patched as synced
    expect(bridge.added).toEqual([]);  // but nothing appended
  });
});
