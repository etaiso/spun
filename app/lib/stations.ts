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
  // Genre/format tags from radio-browser (e.g. ["pop","rock","news"]),
  // lowercased + deduped. Used to personalize the Popular section. Optional —
  // absent on legacy stored stations and on records radio-browser tagged with
  // nothing. See lib/taste.ts.
  tags?: string[];
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
  tags?: string; // comma-separated from radio-browser, e.g. "pop,rock,news"
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

// radio-browser returns tags as a single comma-separated string. Normalize to a
// clean, lowercased, deduped array, capped so a station spamming 30 tags can't
// dominate the genre profile.
export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const t = part.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return [...seen].slice(0, 8);
}

export function normalizeStation(raw: RawStation): Station {
  const tags = parseTags(raw.tags);
  return {
    id: raw.stationuuid,
    name: (raw.name ?? '').trim(),
    streamUrl: raw.url_resolved || raw.url,
    favicon: raw.favicon,
    country: raw.country,
    countrycode: (raw.countrycode ?? '').toUpperCase(),
    bitrate: raw.bitrate,
    codec: raw.codec,
    ...(tags.length ? { tags } : {}),
  };
}
