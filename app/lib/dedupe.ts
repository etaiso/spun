import type { Station } from './stations';

// Radio Browser is crowd-sourced: the same real station is often submitted
// multiple times as separate records (distinct stationuuids) with slightly
// different names, casing, language, or stream URLs. Deduping by uuid alone
// (which the routes already do) can't catch those. This collapses obvious
// duplicates with two conservative passes, keeping the FIRST occurrence —
// callers pass stations in popularity/priority order, so first = best.

function urlKey(u: string): string {
  // Same resolved stream → same station. Normalize trivial differences.
  return u.trim().toLowerCase().replace(/\/+$/, '');
}

function nameKey(name: string, countrycode: string): string {
  // Extract just the Latin alphanumerics — this is what makes bilingual
  // "<native> - <Latin>" names (common for Israeli stations) collapse onto
  // their Latin form: "גלגלצ - Glglz" → "glglz", "אקו eco 99fm" → "eco99fm".
  // Scoped by country so two unrelated same-named stations in different
  // countries (e.g. a UK vs US "Jazz FM") are never merged. Names with too
  // little Latin text (mostly-native, ambiguous) are left un-keyed so they're
  // never collapsed by name.
  const latin = (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join('');
  return latin.length >= 3 ? `${countrycode}|${latin}` : '';
}

/**
 * Collapse duplicate records pointing at the same station. Preserves input
 * order and keeps the first record of each group. The dropped records' names
 * are merged into the survivor's `aliases` so the station stays findable by any
 * of its submitted names (e.g. a deduped "Glglz" still matches "גלגלצ").
 */
export function dedupeStations(stations: Station[]): Station[] {
  const urlOwner = new Map<string, Station>();
  const nameOwner = new Map<string, Station>();
  const out: Station[] = [];

  const addAlias = (owner: Station, name: string) => {
    const n = name.trim();
    if (!n || n === owner.name) return;
    if (!owner.aliases) owner.aliases = [];
    if (!owner.aliases.includes(n)) owner.aliases.push(n);
  };

  const mergeTags = (owner: Station, tags: string[] | undefined) => {
    if (!tags || tags.length === 0) return;
    const set = new Set(owner.tags ?? []);
    for (const t of tags) set.add(t);
    owner.tags = [...set];
  };

  for (const s of stations) {
    const u = urlKey(s.streamUrl);
    const nk = nameKey(s.name, s.countrycode);

    // Already have a record for this stream URL or normalized name? Fold this
    // duplicate into it instead of emitting a second row.
    const owner = (u && urlOwner.get(u)) || (nk && nameOwner.get(nk)) || null;
    if (owner) {
      addAlias(owner, s.name);
      for (const a of s.aliases ?? []) addAlias(owner, a);
      mergeTags(owner, s.tags);
      // Point both keys at the owner so future dupes matching either collapse too.
      if (u && !urlOwner.has(u)) urlOwner.set(u, owner);
      if (nk && !nameOwner.has(nk)) nameOwner.set(nk, owner);
      continue;
    }

    out.push(s);
    if (u) urlOwner.set(u, s);
    if (nk) nameOwner.set(nk, s);
  }

  return out;
}
