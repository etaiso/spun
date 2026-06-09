'use client';

import { useMemo } from 'react';
import { useRegion, useRegionLock, userRegion, buildCountryOptions } from '@/app/lib/region';
import { useCountries } from '@/app/lib/explore';
import { flagEmoji } from '@/app/lib/flag';
import { Combobox } from './Combobox';

export function RegionPicker() {
  const { region, setRegion } = useRegion();
  const { locked, setLocked } = useRegionLock();
  // The live ~200-country list (countries that actually have stations), shared
  // with Explore and cached app-wide. The current region is always folded in by
  // buildCountryOptions even if it isn't in the list, so the picker is never
  // empty while locked.
  const { data: countries } = useCountries();

  const options = useMemo(() => buildCountryOptions(countries, region), [countries, region]);

  // The trigger shows the selected country (flag + name). Fall back to the raw
  // code with a flag while the live list is still loading, then to a prompt.
  const trigger = useMemo(() => {
    const current = options.find(o => o.value === region);
    if (current) return current.label;
    return region ? `${flagEmoji(region)} ${region}` : 'Select a country';
  }, [options, region]);

  // "Show only" needs a region; enabling it defaults to the detected home
  // region (or the first option) when none is set yet.
  function toggle() {
    if (locked) { setLocked(false); return; }
    if (!region) setRegion(userRegion() ?? options[0]?.value ?? '');
    setLocked(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Single coupled control: the region only matters while "show only" is
          on. Off = fully global (no hidden prioritization), so the picker is
          hidden too. */}
      <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-[var(--color-ink)]">Filter by country</span>
          <span className="text-xs text-[var(--color-ink-4)]">
            Limit search and Popular to a single country. Favorites, Recently played and Explore are never limited.
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
          <span className="text-[11px] tracking-[1.2px] uppercase font-bold text-[var(--color-ink-3)]">
            Country
          </span>
          <Combobox
            ariaLabel="Country"
            searchPlaceholder="Search countries…"
            trigger={trigger}
            value={region}
            options={options}
            onSelect={(v) => setRegion(v)}
          />
        </div>
      )}
    </div>
  );
}
