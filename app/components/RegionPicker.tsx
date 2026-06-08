'use client';

import { useMemo } from 'react';
import { useRegion, useRegionLock, userRegion } from '@/app/lib/region';
import { flagEmoji } from '@/app/lib/flag';

// A practical spread of countries for the picker. The user's detected region
// is always included even if it's not in this list.
const CODES = [
  'IL', 'US', 'GB', 'CA', 'AU', 'IE', 'DE', 'FR', 'NL', 'BE', 'CH', 'AT',
  'ES', 'IT', 'PT', 'GR', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'RO',
  'RU', 'UA', 'TR', 'BR', 'MX', 'AR', 'CL', 'CO', 'JP', 'KR', 'CN', 'IN',
  'ID', 'TH', 'VN', 'PH', 'ZA', 'EG', 'MA', 'NG', 'KE', 'AE', 'SA',
];

export function RegionPicker() {
  const { region, setRegion } = useRegion();
  const { locked, setLocked } = useRegionLock();

  const options = useMemo(() => {
    const codes = Array.from(new Set([region, ...CODES].filter(Boolean)));
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }
    return codes
      .map(code => ({ code, label: `${flagEmoji(code)} ${names?.of(code) ?? code}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [region]);

  // "Show only" needs a region; enabling it defaults to the detected home
  // region (or the first option) when none is set yet.
  function toggle() {
    if (locked) { setLocked(false); return; }
    if (!region) setRegion(userRegion() ?? options[0]?.code ?? '');
    setLocked(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Single coupled control: the region only matters while "show only" is
          on. Off = fully global (no hidden prioritization), so the picker is
          hidden too. */}
      <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-[var(--color-ink)]">Show only one region</span>
          <span className="text-xs text-[var(--color-ink-4)]">
            Limit search and Popular to a single region. Favorites, Recently played and Explore are never limited.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={locked}
          onClick={toggle}
          className={[
            'shrink-0 relative h-5 w-9 rounded-full transition-colors cursor-pointer',
            locked ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
              locked ? 'left-[18px]' : 'left-0.5',
            ].join(' ')}
          />
        </button>
      </label>

      {locked && (
        <div className="flex flex-col gap-2">
          <label htmlFor="region-select" className="text-[11px] tracking-[1.2px] uppercase font-bold text-[var(--color-ink-3)]">
            Region
          </label>
          <div className="relative">
            <select
              id="region-select"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="appearance-none cursor-pointer w-full rounded-full border border-[var(--color-line)] bg-white pl-3 pr-8 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-brand-pink)] transition-colors"
            >
              {options.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-3)]">▾</span>
          </div>
        </div>
      )}
    </div>
  );
}
