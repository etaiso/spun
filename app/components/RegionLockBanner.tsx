'use client';

import { useMemo } from 'react';
import { useRegion, useRegionLock } from '@/app/lib/region';
import { flagEmoji } from '@/app/lib/flag';
import type { ExploreCountry } from '@/app/lib/explorePaths';

type Props = {
  // The country facet currently active in Explore, or null (landing / genre-only).
  country: ExploreCountry | null;
};

// Shown inside Explore when Region-only mode is on. Explore deliberately ignores
// the lock (browsing is explicit intent), so this surfaces that state and offers
// one-tap escape hatches instead of silently contradicting the setting:
//  • a different country is filtered → "Make X my region" or "Turn off"
//  • no country filter (landing / genre only) → informational + "Turn off"
//  • the filtered country IS your locked region → no banner (nothing to reconcile)
export function RegionLockBanner({ country }: Props) {
  const { region, setRegion } = useRegion();
  const { locked, setLocked } = useRegionLock();

  const regionName = useMemo(() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region; }
    catch { return region; }
  }, [region]);

  // Only relevant while the lock is actually active.
  if (!locked || !region) return null;
  // Filtering on your own locked region — consistent, no banner.
  if (country && country.code === region) return null;

  const mismatch = !!country && country.code !== region;

  return (
    <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-[rgba(168,85,247,0.28)] bg-[rgba(168,85,247,0.07)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0 text-[var(--color-brand-purple)]" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <div className="flex-1 min-w-0 text-[13px] text-[var(--color-ink-2)]">
        <span className="font-semibold">Region-only mode is on ({regionName}).</span>{' '}
        {mismatch ? (
          <>You&apos;re exploring <b>{flagEmoji(country!.code)} {country!.name}</b> — playing a station here won&apos;t change your filter.</>
        ) : (
          <>Explore reaches every region. Your search, favorites &amp; popular stay focused on {regionName}.</>
        )}
      </div>
      {mismatch && (
        <button
          onClick={() => setRegion(country!.code)}
          className="shrink-0 px-3 h-8 rounded-full text-[13px] font-semibold bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
        >
          Make {country!.name} my region
        </button>
      )}
      <button
        onClick={() => setLocked(false)}
        className="shrink-0 px-3 h-8 rounded-full text-[13px] font-semibold border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] cursor-pointer transition-colors"
      >
        Turn off
      </button>
    </div>
  );
}
