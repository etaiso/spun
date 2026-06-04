'use client';

// Keyless, CORS-enabled iTunes Search lookup. Used to enrich tracks that came
// from broadcast metadata (no Shazam payload) with cover art, a direct Apple
// Music link, and a ~30s preview clip.

export type ITunesMatch = { cover: string; appleUrl: string; previewUrl: string };

/**
 * Look up the top song match for a free-text term (e.g. "Artist Title").
 * Returns null on no match / network error / abort.
 */
export async function lookupITunesSong(term: string, signal?: AbortSignal): Promise<ITunesMatch | null> {
  const t = term.trim();
  if (!t) return null;
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(t)}&media=music&entity=song&limit=1`,
      { signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { artworkUrl100?: string; trackViewUrl?: string; previewUrl?: string }[];
    };
    const r = data.results?.[0];
    if (!r) return null;
    return {
      // Bump the thumbnail to a usable size.
      cover: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : '',
      appleUrl: r.trackViewUrl ?? '',
      previewUrl: r.previewUrl ?? '',
    };
  } catch {
    return null;
  }
}
