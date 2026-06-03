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
