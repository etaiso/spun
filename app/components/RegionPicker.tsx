'use client';

import { useMemo } from 'react';
import { useRegion } from '@/app/lib/region';

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

  const options = useMemo(() => {
    const codes = Array.from(new Set([region, ...CODES].filter(Boolean)));
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }
    return codes
      .map(code => ({ code, label: `${flagEmoji(code)} ${names?.of(code) ?? code}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [region]);

  return (
    <footer className="flex items-center gap-3 px-6 h-12 border-t border-[var(--color-line)] bg-[var(--color-bg-2)] shrink-0 text-[var(--color-ink-3)]">
      <label htmlFor="region-select" className="text-[11px] tracking-[1.2px] uppercase font-bold">
        Search region
      </label>
      <div className="relative">
        <select
          id="region-select"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="appearance-none cursor-pointer rounded-full border border-[var(--color-line)] bg-white pl-3 pr-8 py-1.5 text-sm text-[var(--color-ink)] hover:border-[var(--color-warm)] transition-colors"
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
    </footer>
  );
}
