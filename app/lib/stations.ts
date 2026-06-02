export type Station = {
  id: string;
  name: string;
  streamUrl: string;
  favicon: string;
  country: string;
  bitrate: number;
  codec: string;
};

type RawStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  favicon: string;
  country: string;
  bitrate: number;
  codec: string;
};

export function normalizeStation(raw: RawStation): Station {
  return {
    id: raw.stationuuid,
    name: raw.name.trim(),
    streamUrl: raw.url_resolved || raw.url,
    favicon: raw.favicon,
    country: raw.country,
    bitrate: raw.bitrate,
    codec: raw.codec,
  };
}
