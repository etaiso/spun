'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useCountries, useTags, fetchStationsByCountry, fetchStationsByTag, GENRES } from '@/app/lib/explore';
import { useRegion } from '@/app/lib/region';
import { useFavorites } from '@/app/lib/favorites';
import { useHiddenFilter } from '@/app/lib/hidden';
import { flagEmoji } from '@/app/lib/flag';
import { StationRow } from './StationRow';
import { RegionLockBanner, type ExploreDrill } from './RegionLockBanner';

type Props = { onSelect: (s: Station) => void };

const nf = new Intl.NumberFormat();
const fmt = (n: number) => nf.format(n);

export function ExploreView({ onSelect }: Props) {
  const [drill, setDrill] = useState<ExploreDrill>(null);

  return (
    <div className="p-10">
      {drill ? (
        <DrillView drill={drill} onBack={() => setDrill(null)} onSelect={onSelect} />
      ) : (
        <Landing onDrill={setDrill} />
      )}
    </div>
  );
}

// ── Landing: genre chips + country grid ────────────────────────────────────

function Landing({ onDrill }: { onDrill: (d: ExploreDrill) => void }) {
  const { data: countries, loading, error } = useCountries();
  const { data: tags } = useTags();
  const { region } = useRegion();

  const tagCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tags) m.set(t.name, t.count);
    return m;
  }, [tags]);

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
      <div className="mb-8">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-brand-purple)] mb-2">Explore</div>
        <h1 className="text-[36px] font-bold tracking-tight">Find your next station</h1>
        <p className="text-base text-[var(--color-ink-3)] mt-2">Browse by genre or jump to a country.</p>
      </div>

      <RegionLockBanner drill={null} />

      {/* Genres */}
      <SectionHead>🏷 Genres</SectionHead>
      <div className="flex flex-wrap gap-2.5 mb-10">
        {GENRES.map(g => {
          const count = tagCount.get(g);
          return (
            <button
              key={g}
              onClick={() => onDrill({ kind: 'tag', label: g, count })}
              className="px-4 py-2 rounded-full text-sm font-semibold border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] hover:-translate-y-0.5 transition-all cursor-pointer"
            >
              {g}{count ? <span className="ml-1.5 text-[var(--color-ink-4)] font-medium">{fmt(count)}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Countries */}
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
              onClick={() => onDrill({ kind: 'country', label: c.name, code: c.code, count: c.count })}
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

// ── Drill: station results for a country or tag ─────────────────────────────

function DrillView({ drill, onBack, onSelect }: { drill: NonNullable<ExploreDrill>; onBack: () => void; onSelect: (s: Station) => void }) {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState(false);
  const filterHidden = useHiddenFilter();
  const { isFavorite, toggle } = useFavorites();

  // Re-fetch when the drill target changes. A string key keeps the dep stable.
  const key = `${drill.kind}:${drill.code ?? drill.label}`;
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStations(null); setError(false);
    const req = drill.kind === 'country'
      ? fetchStationsByCountry(drill.code ?? '', ctrl.signal)
      : fetchStationsByTag(drill.label, ctrl.signal);
    req
      .then(list => { if (!cancelled) setStations(list); })
      .catch((e: Error) => { if (!cancelled && e.name !== 'AbortError') setError(true); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [key, drill.kind, drill.code, drill.label]);

  const shown = stations ? filterHidden(stations) : [];

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-[var(--color-brand-purple)] mb-6 cursor-pointer hover:opacity-75 transition-opacity">
        ← Explore
      </button>

      <RegionLockBanner drill={drill} />

      <div className="flex items-center gap-3 mb-7">
        <span className="text-4xl leading-none">{drill.kind === 'country' && drill.code ? flagEmoji(drill.code) : '🏷'}</span>
        <div>
          <h1 className="text-[32px] font-bold tracking-tight">{drill.label}</h1>
          <div className="text-[var(--color-ink-3)]">
            {typeof drill.count === 'number' ? `${fmt(drill.count)} stations` : ' '}
          </div>
        </div>
      </div>

      {error ? (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">Couldn&apos;t load stations. Try again.</div>
      ) : stations === null ? (
        <ResultsSkeleton />
      ) : shown.length === 0 ? (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">No stations found.</div>
      ) : (
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
