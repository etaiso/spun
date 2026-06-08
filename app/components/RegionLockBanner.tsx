'use client';

import { useMemo } from 'react';
import { useRegion, useRegionLock } from '@/app/lib/region';
import { flagEmoji } from '@/app/lib/flag';

// What the user is currently looking at in Explore. `null` = the landing.
export type ExploreDrill = { kind: 'country' | 'tag'; label: string; code?: string; count?: number } | null;

type Props = { drill: ExploreDrill };

// Shown inside Explore when Region-only mode is on. Explore deliberately ignores
// the lock (browsing is explicit intent), so this surfaces that state and offers
// one-tap escape hatches instead of silently contradicting the setting:
//  • country mismatch → "Make X my region" (adopt it) or "Turn off"
//  • tag / landing    → informational + "Turn off"
//  • own locked region → no banner (nothing to reconcile)
export function RegionLockBanner({ drill }: Props) {
  const { region, setRegion } = useRegion();
  const { locked, setLocked } = useRegionLock();

  const regionName = useMemo(() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region; }
    catch { return region; }
  }, [region]);

  // Only relevant while the lock is actually active.
  if (!locked || !region) return null;
  // Browsing your own locked region — consistent, no banner.
  if (drill?.kind === 'country' && drill.code === region) return null;

  const mismatch = drill?.kind === 'country' && drill.code && drill.code !== region;

  let message: React.ReactNode;
  if (mismatch) {
    message = <>You&apos;re exploring <b>{drill!.code ? `${flagEmoji(drill!.code)} ` : ''}{drill!.label}</b> — playing a station here won&apos;t change your filter.</>;
  } else if (drill?.kind === 'tag') {
    message = <>Exploring <b>{drill.label}</b> across all regions.</>;
  } else {
    message = <>Explore reaches every region. Your search, favorites &amp; popular stay focused on {regionName}.</>;
  }

  return (
    <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-[rgba(168,85,247,0.28)] bg-[rgba(168,85,247,0.07)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0 text-[var(--color-brand-purple)]" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <div className="flex-1 min-w-0 text-[13px] text-[var(--color-ink-2)]">
        <span className="font-semibold">Region-only mode is on ({regionName}).</span> {message}
      </div>
      {mismatch && drill?.code && (
        <button
          onClick={() => setRegion(drill.code!)}
          className="shrink-0 px-3 h-8 rounded-full text-[13px] font-semibold bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
        >
          Make {drill.label} my region
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
