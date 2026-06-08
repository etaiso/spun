'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useCountries, useTags, fetchStations, GENRES } from '@/app/lib/explore';
import { useRegion } from '@/app/lib/region';
import { useFavorites } from '@/app/lib/favorites';
import { useHiddenFilter } from '@/app/lib/hidden';
import { flagEmoji } from '@/app/lib/flag';
import type { ExploreCountry } from '@/app/lib/explorePaths';
import { StationRow } from './StationRow';
import { RegionLockBanner } from './RegionLockBanner';

type Props = { onSelect: (s: Station) => void };

const nf = new Intl.NumberFormat();
const fmt = (n: number) => nf.format(n);

export function ExploreView({ onSelect }: Props) {
  // Two independent facets. Either, both, or neither can be set; both set =
  // intersection (e.g. jazz in Germany). Neither = the discovery landing.
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const { data: countries, loading: countriesLoading, error: countriesError } = useCountries();
  const { data: tags } = useTags();
  const { region } = useRegion();

  const tagCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tags) m.set(t.name, t.count);
    return m;
  }, [tags]);

  const country = useMemo(() => countries.find(c => c.code === countryCode) ?? null, [countries, countryCode]);
  const hasFilter = !!(countryCode || tag);

  return (
    <div className="p-10">
      {hasFilter ? (
        <>
          <button
            onClick={() => { setCountryCode(null); setTag(null); }}
            className="flex items-center gap-2 text-sm font-semibold text-[var(--color-brand-purple)] mb-5 cursor-pointer hover:opacity-75 transition-opacity"
          >
            ← Explore
          </button>
          <h1 className="text-[32px] font-bold tracking-tight mb-1">
            {country && tag ? <><span className="capitalize">{tag}</span> in {country.name}</> : country ? country.name : <span className="capitalize">{tag}</span>}
          </h1>

          <RegionLockBanner country={country} />

          <FilterBar
            countries={countries}
            countryCode={countryCode}
            tag={tag}
            tagCount={tagCount}
            onCountry={setCountryCode}
            onTag={setTag}
          />

          <Results countryCode={countryCode} tag={tag} onSelect={onSelect} />
        </>
      ) : (
        <>
          <div className="mb-8">
            <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-brand-purple)] mb-2">Explore</div>
            <h1 className="text-[36px] font-bold tracking-tight">Find your next station</h1>
            <p className="text-base text-[var(--color-ink-3)] mt-2">Browse by genre or country — combine both to narrow it down.</p>
          </div>

          <RegionLockBanner country={null} />

          <Landing
            countries={countries}
            loading={countriesLoading}
            error={countriesError}
            tagCount={tagCount}
            region={region}
            onPickCountry={(c) => setCountryCode(c.code)}
            onPickTag={(t) => setTag(t)}
          />
        </>
      )}
    </div>
  );
}

// ── Filter bar (results view): combine / change the two facets ──────────────

function FilterBar({ countries, countryCode, tag, tagCount, onCountry, onTag }: {
  countries: ExploreCountry[];
  countryCode: string | null;
  tag: string | null;
  tagCount: Map<string, number>;
  onCountry: (code: string | null) => void;
  onTag: (tag: string | null) => void;
}) {
  // Alphabetical for findability in the dropdown (the grid stays count-sorted).
  const countryOptions = useMemo(
    () => [...countries].sort((a, b) => a.name.localeCompare(b.name)),
    [countries],
  );

  return (
    <div className="flex flex-wrap items-center gap-3 mb-7">
      <span className="text-[11px] tracking-[1.2px] uppercase font-bold text-[var(--color-ink-3)]">Filter</span>
      <FacetSelect
        ariaLabel="Filter by country"
        value={countryCode ?? ''}
        onChange={(v) => onCountry(v || null)}
        options={[
          { value: '', label: '🌍 All countries' },
          ...countryOptions.map(c => ({ value: c.code, label: `${flagEmoji(c.code)} ${c.name}` })),
        ]}
      />
      <FacetSelect
        ariaLabel="Filter by genre"
        value={tag ?? ''}
        onChange={(v) => onTag(v || null)}
        options={[
          { value: '', label: 'All genres' },
          ...GENRES.map(g => ({ value: g, label: tagCount.get(g) ? `${g} · ${fmt(tagCount.get(g)!)}` : g })),
        ]}
      />
    </div>
  );
}

function FacetSelect({ value, onChange, options, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none cursor-pointer rounded-full border border-[var(--color-line)] bg-white pl-4 pr-9 py-2 text-sm font-semibold text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] transition-colors max-w-[240px] truncate"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-3)]">▾</span>
    </div>
  );
}

// ── Results: stations matching the active facet(s) ──────────────────────────

function Results({ countryCode, tag, onSelect }: { countryCode: string | null; tag: string | null; onSelect: (s: Station) => void }) {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState(false);
  const [atCap, setAtCap] = useState(false);
  const filterHidden = useHiddenFilter();
  const { isFavorite, toggle } = useFavorites();

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStations(null); setError(false); setAtCap(false);
    fetchStations({ country: countryCode, tag }, ctrl.signal)
      .then(list => { if (!cancelled) { setStations(list); setAtCap(list.length >= 100); } })
      .catch((e: Error) => { if (!cancelled && e.name !== 'AbortError') setError(true); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [countryCode, tag]);

  const shown = stations ? filterHidden(stations) : [];

  if (error) return <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">Couldn&apos;t load stations. Try again.</div>;
  if (stations === null) return <ResultsSkeleton />;
  if (shown.length === 0) return <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">No stations match these filters.</div>;

  return (
    <>
      <div className="text-xs text-[var(--color-ink-3)] mb-3">{fmt(shown.length)}{atCap ? '+' : ''} stations</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5">
        {shown.map(s => (
          <StationRow
            key={s.id}
            station={s}
            isActive={false}
            isFavorite={isFavorite(s.id)}
            onSelect={() => onSelect(s)}
            onToggleFavorite={() => toggle(s)}
          />
        ))}
      </div>
    </>
  );
}

// ── Landing: genre chips + country grid (each sets a facet) ─────────────────

function Landing({ countries, loading, error, tagCount, region, onPickCountry, onPickTag }: {
  countries: ExploreCountry[];
  loading: boolean;
  error: boolean;
  tagCount: Map<string, number>;
  region: string;
  onPickCountry: (c: ExploreCountry) => void;
  onPickTag: (tag: string) => void;
}) {
  // Pin the user's region to the front of the grid so "my country" is first.
  const orderedCountries = useMemo(() => {
    if (!region) return countries;
    const i = countries.findIndex(c => c.code === region);
    if (i <= 0) return countries;
    const copy = countries.slice();
    const [mine] = copy.splice(i, 1);
    return [mine, ...copy];
  }, [countries, region]);

  return (
    <>
      <SectionHead>🏷 Genres</SectionHead>
      <div className="flex flex-wrap gap-2.5 mb-10">
        {GENRES.map(g => {
          const count = tagCount.get(g);
          return (
            <button
              key={g}
              onClick={() => onPickTag(g)}
              className="px-4 py-2 rounded-full text-sm font-semibold border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] hover:-translate-y-0.5 transition-all cursor-pointer"
            >
              {g}{count ? <span className="ml-1.5 text-[var(--color-ink-4)] font-medium">{fmt(count)}</span> : null}
            </button>
          );
        })}
      </div>

      <SectionHead>🌍 Countries</SectionHead>
      {error ? (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">Couldn&apos;t load countries.</div>
      ) : loading && countries.length === 0 ? (
        <CountryGridSkeleton />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {orderedCountries.map(c => (
            <button
              key={c.code}
              onClick={() => onPickCountry(c)}
              className="flex items-center gap-3 p-4 rounded-2xl border border-[var(--color-line)] bg-white hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all cursor-pointer text-left"
            >
              <span className="text-3xl leading-none">{flagEmoji(c.code)}</span>
              <div className="min-w-0">
                <div className="text-[15px] font-bold tracking-tight truncate">{c.name}</div>
                <div className="text-xs text-[var(--color-ink-3)]">{fmt(c.count)} stations</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-brand-purple)] mb-3.5">
      {children}
    </div>
  );
}

function CountryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-2xl border border-[var(--color-line)] bg-white">
          <div className="shimmer w-9 h-9 rounded-full" />
          <div className="flex-1">
            <div className="shimmer h-3.5 w-3/5 mb-1.5" />
            <div className="shimmer h-2.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 mb-1">
          <div className="shimmer w-10 h-10 rounded-[10px]" />
          <div className="flex-1">
            <div className="shimmer h-3.5 w-3/5 mb-1.5" />
            <div className="shimmer h-2.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
