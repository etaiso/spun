'use client';

/**
 * Best-guess ISO 3166 alpha-2 region for the current user, derived from their
 * browser locale(s) — e.g. "he-IL" → "IL". Used to rank stations from the
 * user's country higher in search. Returns null if no region can be inferred.
 */
export function userRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const locale of locales) {
    if (!locale) continue;
    try {
      const region = new Intl.Locale(locale).region;
      if (region) return region.toUpperCase();
    } catch {
      // Fall back to parsing the subtag after "-" (e.g. "en-US" → "US").
      const part = locale.split('-')[1];
      if (part && part.length === 2) return part.toUpperCase();
    }
  }
  return null;
}
