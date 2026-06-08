'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  // Independent facets: a single country and any number of genre tags. Multiple
  // tags are ANDed (jazz + blues = tagged both); combined with a country too.
  // Neither set = the discovery landing.
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const { data: countries, loading: countriesLoading, error: countriesError } = useCountries();
  const { data: tagsData } = useTags();
  const { region } = useRegion();

  const tagCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tagsData) m.set(t.name, t.count);
    return m;
  }, [tagsData]);

  const country = useMemo(() => countries.find(c => c.code === countryCode) ?? null, [countries, countryCode]);
  const hasFilter = !!(countryCode || tags.length);

  return (
    <div className="p-10">
      {hasFilter ? (
        <>
          <button
            onClick={() => { setCountryCode(null); setTags([]); }}
            className="flex items-center gap-2 text-sm font-semibold text-[var(--color-brand-purple)] mb-5 cursor-pointer hover:opacity-75 transition-opacity"
          >
            ← Explore
          </button>
          <h1 className="text-[32px] font-bold tracking-tight mb-1">
            {tags.length > 0 && <span className="capitalize">{tags.join(' + ')}</span>}
            {tags.length > 0 && country ? ' in ' : ''}
            {country ? country.name : ''}
          </h1>

          <RegionLockBanner country={country} />

          <FilterBar
            countries={countries}
            countryCode={countryCode}
            tags={tags}
            tagCount={tagCount}
            onCountry={setCountryCode}
            onTags={setTags}
          />

          <Results countryCode={countryCode} tags={tags} onSelect={onSelect} />
        </>
      ) : (
        <>
          <div className="mb-8">
            <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-brand-purple)] mb-2">Explore</div>
            <h1 className="text-[36px] font-bold tracking-tight">Find your next station</h1>
            <p className="text-base text-[var(--color-ink-3)] mt-2">Browse by genre or country — combine them to narrow it down.</p>
          </div>

          <RegionLockBanner country={null} />

          <Landing
            countries={countries}
            loading={countriesLoading}
            error={countriesError}
            tagCount={tagCount}
            region={region}
            onPickCountry={(c) => setCountryCode(c.code)}
            onPickTag={(t) => setTags([t])}
          />
        </>
      )}
    </div>
  );
}

// ── Filter bar (results view): combine / change the facets ──────────────────

function FilterBar({ countries, countryCode, tags, tagCount, onCountry, onTags }: {
  countries: ExploreCountry[];
  countryCode: string | null;
  tags: string[];
  tagCount: Map<string, number>;
  onCountry: (code: string | null) => void;
  onTags: (tags: string[]) => void;
}) {
  // Alphabetical for findability (the landing grid stays count-sorted).
  const countryOptions = useMemo(
    () => [...countries].sort((a, b) => a.name.localeCompare(b.name)),
    [countries],
  );
  const selectedCountry = countries.find(c => c.code === countryCode) ?? null;
  const available = GENRES.filter(g => !tags.includes(g));

  return (
    <div className="flex flex-wrap items-center gap-2.5 mb-7">
      <span className="text-[11px] tracking-[1.2px] uppercase font-bold text-[var(--color-ink-3)] mr-0.5">Filter</span>

      <Combobox
        ariaLabel="Filter by country"
        searchPlaceholder="Search countries…"
        trigger={selectedCountry ? `${flagEmoji(selectedCountry.code)} ${selectedCountry.name}` : '🌍 All countries'}
        value={countryCode ?? ''}
        options={[
          { value: '', label: '🌍 All countries' },
          ...countryOptions.map(c => ({ value: c.code, label: `${flagEmoji(c.code)} ${c.name}` })),
        ]}
        onSelect={(v) => onCountry(v || null)}
      />

      {/* Selected genres become removable chips; the combobox adds more. */}
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 h-9 pl-3.5 pr-1.5 rounded-full bg-[rgba(168,85,247,0.12)] text-[var(--color-brand-purple)] text-sm font-semibold">
          {t}
          <button
            onClick={() => onTags(tags.filter(x => x !== t))}
            aria-label={`Remove ${t}`}
            className="w-5 h-5 flex items-center justify-center rounded-full text-base leading-none hover:bg-[rgba(168,85,247,0.22)] cursor-pointer"
          >
            ×
          </button>
        </span>
      ))}

      {available.length > 0 && (
        <Combobox
          ariaLabel={tags.length ? 'Add another genre' : 'Filter by genre'}
          searchPlaceholder="Search genres…"
          trigger={tags.length ? '+ Add genre' : 'All genres'}
          value=""
          options={available.map(g => ({ value: g, label: tagCount.get(g) ? `${g} · ${fmt(tagCount.get(g)!)}` : g }))}
          onSelect={(v) => { if (v) onTags([...tags, v]); }}
        />
      )}
    </div>
  );
}

// A searchable single-select dropdown (combobox): filter by typing, navigate
// with ↑/↓, pick with Enter/click, dismiss with Esc/click-away. Replaces a
// native <select> so a 200-country list is searchable — and so flags actually
// render in the list (native <option>s don't use the Twemoji font on Windows).
function Combobox({ trigger, value, options, onSelect, searchPlaceholder, ariaLabel }: {
  trigger: React.ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
  searchPlaceholder: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Focus the search when the menu opens (query/active are reset in `openMenu`,
  // keeping setState out of effects).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  const openMenu = () => { setQuery(''); setActive(0); setOpen(true); };

  // Dismiss on click-away.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(o: { value: string } | undefined) {
    if (!o) return;
    onSelect(o.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="relative flex items-center cursor-pointer rounded-full border border-[var(--color-line)] bg-white pl-4 pr-9 h-9 text-sm font-semibold text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] transition-colors max-w-[240px]"
      >
        <span className="truncate">{trigger}</span>
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-3)]">▾</span>
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-72 rounded-2xl border border-[var(--color-line)] bg-white shadow-[0_16px_48px_rgba(60,30,10,0.18)] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--color-line)]">
            <span className="text-[var(--color-ink-4)] text-sm" aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent outline-none text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)]"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1.5">
            {filtered.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-[var(--color-ink-3)]">No matches</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value || '__all'}
                  data-idx={i}
                  type="button"
                  onClick={() => choose(o)}
                  onMouseMove={() => setActive(i)}
                  className={[
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                    i === active ? 'bg-[rgba(168,85,247,0.10)]' : '',
                    o.value === value && value !== '' ? 'font-bold text-[var(--color-brand-purple)]' : 'text-[var(--color-ink-2)]',
                  ].join(' ')}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && value !== '' && <span aria-hidden="true" className="text-[var(--color-brand-purple)]">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Results: stations matching the active facet(s) ──────────────────────────

function Results({ countryCode, tags, onSelect }: { countryCode: string | null; tags: string[]; onSelect: (s: Station) => void }) {
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
    fetchStations({ country: countryCode, tags }, ctrl.signal)
      .then(list => { if (!cancelled) { setStations(list); setAtCap(list.length >= 100); } })
      .catch((e: Error) => { if (!cancelled && e.name !== 'AbortError') setError(true); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [countryCode, tags]);

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
