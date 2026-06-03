'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
      <div className="shimmer w-10 h-10 rounded-[10px]" />
      <div className="flex-1">
        <div className="shimmer h-3.5 w-3/5 mb-1.5" />
        <div className="shimmer h-2.5 w-2/5" />
      </div>
    </div>
  );
}

export function StationSearch({ selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const { isFavorite, toggle } = useFavorites();

  useEffect(() => {
    const q = query.trim();
    // Clear previous results when the query is empty. This is a legitimate
    // state-reset on prop change (no remount because the component is always
    // mounted while the sidebar is open).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q === '') { setResults([]); setLoading(false); return; }

    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) { if (!cancelled) setResults([]); return; }
        const data = (await res.json()) as unknown;
        if (!cancelled) setResults(Array.isArray(data) ? (data as Station[]) : []);
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'AbortError') setResults([]);
      } finally {
        // Only the most recent effect run drives the spinner; otherwise a
        // superseded run's finally would flip loading off mid-debounce.
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [query]);

  return (
    <div>
      <div className="text-[11px] tracking-[1.4px] text-[var(--color-warm)] font-extrabold uppercase mb-3.5">
        Browse
      </div>
      <div role="search" className="bg-white border-[1.5px] border-[var(--color-line)] rounded-full px-4 py-2.5 mb-4 flex items-center gap-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.03)] focus-within:border-[var(--color-warm)]">
        <span aria-hidden="true">🔍</span>
        <input
          type="search"
          aria-label="Search stations"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search stations…"
          className="flex-1 outline-none bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)]"
        />
        {loading && <span className="spin-warm" aria-label="Searching" />}
      </div>
      {loading && results.length === 0 && (
        <>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </>
      )}
      {!loading && query.trim() !== '' && results.length === 0 && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">No stations found.</div>
      )}
      {results.map(s => (
        <StationRow
          key={s.id}
          station={s}
          isActive={s.id === selectedId}
          isFavorite={isFavorite(s.id)}
          onSelect={() => onSelect(s)}
          onToggleFavorite={() => toggle(s)}
        />
      ))}
    </div>
  );
}
