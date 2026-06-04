'use client';

import { useMemo } from 'react';
import { useRegion, useRegionLock } from '@/app/lib/region';

// A practical spread of countries for the picker. The user's detected region
// is always included even if it's not in this list.
const CODES = [
  'IL', 'US', 'GB', 'CA', 'AU', 'IE', 'DE', 'FR', 'NL', 'BE', 'CH', 'AT',
  'ES', 'IT', 'PT', 'GR', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'RO',
  'RU', 'UA', 'TR', 'BR', 'MX', 'AR', 'CL', 'CO', 'JP', 'KR', 'CN', 'IN',
  'ID', 'TH', 'VN', 'PH', 'ZA', 'EG', 'MA', 'NG', 'KE', 'AE', 'SA',
];

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🌐';
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

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

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="region-select" className="text-[11px] tracking-[1.2px] uppercase font-bold text-[var(--color-ink-3)]">
        Search region
      </label>
      <div className="relative">
        <select
          id="region-select"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="appearance-none cursor-pointer w-full rounded-full border border-[var(--color-line)] bg-white pl-3 pr-8 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-warm)] transition-colors"
        >
          <option value="">🌐 Global (no preference)</option>
          {options.map(o => (
            <option key={o.code} value={o.code}>{o.label}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-3)]">▾</span>
      </div>
      <span className="text-xs text-[var(--color-ink-4)]">
        Stations from your region rank higher in search.
      </span>

      <label
        className={[
          'mt-2 flex items-center justify-between gap-3 select-none',
          region ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed',
        ].join(' ')}
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium text-[var(--color-ink)]">Region-only mode</span>
          <span className="text-xs text-[var(--color-ink-4)]">
            {region
              ? 'Show only stations from this region everywhere — search, favorites, popular and recent.'
              : 'Pick a region above to enable this.'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={locked && !!region}
          disabled={!region}
          onClick={() => setLocked(!locked)}
          className={[
            'shrink-0 relative h-5 w-9 rounded-full transition-colors',
            locked && region ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
            region ? 'cursor-pointer' : 'cursor-not-allowed',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
              locked && region ? 'left-[18px]' : 'left-0.5',
            ].join(' ')}
          />
        </button>
      </label>
    </div>
  );
}
