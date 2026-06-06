// Provider-agnostic seam for exporting saved songs to an external music
// service's playlist. Spotify is the first implementation; Apple Music /
// YouTube Music can be added later by implementing this interface.
//
// This file is pure types + a constant — no auth, no network, no React — so it
// is safe to import from both server (API routes) and client code.

export type ProviderId = 'spotify' | 'appleMusic' | 'youtubeMusic';

/** What we know about a saved song when asking a provider to find it. */
export type TrackQuery = {
  artist: string;
  title: string;
  /** Exact cross-provider key, when available (e.g. from Shazam). Preferred over text search. */
  isrc?: string;
};

/** A provider's resolved track. `confidence` lets the caller flag weak matches as "not found". */
export type TrackMatch = {
  /** Provider-native track identifier (Spotify track id / URI, etc.). */
  providerTrackId: string;
  /** "Open in <provider>" link. */
  url: string;
  /** 0..1 — 1 means an exact (e.g. ISRC) hit. */
  confidence: number;
};

/** A playlist on the provider, created or selected as the export target. */
export type ProviderPlaylist = {
  id: string;
  url: string;
};

/**
 * Implemented per provider. Auth/token handling is the implementation's
 * concern (Spotify: PKCE + loopback redirect, token in Electron safeStorage).
 * Methods that hit the network reject on failure; callers decide retry/queue.
 */
export interface PlaylistProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** True when a usable (refreshable) token is stored. Cheap; no network. */
  isConnected(): boolean | Promise<boolean>;
  /** Run the OAuth flow (opens the system browser). Resolves once tokens are stored. */
  connect(): Promise<void>;
  /** Revoke locally: drop stored tokens. */
  disconnect(): Promise<void>;

  /** Resolve a saved song to a provider track, or null if no confident match. */
  findTrack(query: TrackQuery): Promise<TrackMatch | null>;
  /** Find the named playlist owned by the user, or create it. */
  ensurePlaylist(name: string): Promise<ProviderPlaylist>;
  /** Append tracks (caller has already de-duped against its own pushed-id map). */
  addTracks(playlistId: string, providerTrackIds: string[]): Promise<void>;
}

/** Default name of the auto-created export playlist. */
export const DEFAULT_PLAYLIST_NAME = 'Spun';
