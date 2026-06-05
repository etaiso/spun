export type Station = {
  id: string;
  name: string;
  streamUrl: string;
  favicon: string;
  country: string;
  countrycode: string; // ISO 3166 alpha-2, e.g. "IL" — used for region ranking
  bitrate: number;
  codec: string;
  // Alternate names from duplicate records that were merged into this one
  // (e.g. a Hebrew "גלגלצ - Glglz" folded into "Glglz"). Kept so the station
  // stays searchable by any of its submitted names. See lib/dedupe.ts.
  aliases?: string[];
};

type RawStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  favicon: string;
  country: string;
  countrycode: string;
  bitrate: number;
  codec: string;
};

// A persisted station is only usable if it has the fields the UI and player
// depend on. localStorage is JSON.parsed untyped, so legacy/partial records or
// stray test entries can slip in — drop them on read rather than letting a
// nameless, unplayable "?" station surface in Favorites / Recently played.
// Mirrors the `streamUrl && name` guard the search/popular API routes apply to
// fresh results.
export function isValidStation(s: unknown): s is Station {
  if (typeof s !== 'object' || s === null) return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.id === 'string' && v.id !== '' &&
    typeof v.name === 'string' && v.name.trim() !== '' &&
    typeof v.streamUrl === 'string' && v.streamUrl !== ''
  );
}

// Parse a localStorage value into a clean Station[] — tolerant of null, bad
// JSON, non-array payloads, and malformed members. Used by the favorites /
// recent / tracking stores so junk never reaches the UI.
export function parseStoredStations(raw: string | null): Station[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isValidStation) : [];
  } catch {
    return [];
  }
}

export function normalizeStation(raw: RawStation): Station {
  return {
    id: raw.stationuuid,
    name: (raw.name ?? '').trim(),
    streamUrl: raw.url_resolved || raw.url,
    favicon: raw.favicon,
    country: raw.country,
    countrycode: (raw.countrycode ?? '').toUpperCase(),
    bitrate: raw.bitrate,
    codec: raw.codec,
  };
}
