'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { useRecent } from '@/app/lib/recent';
import { userRegion } from '@/app/lib/region';
import { rankStations } from '@/app/lib/rank';
import { StationLogo } from './StationLogo';

type Props = {
  onClose: () => void;
  onSelect: (s: Station) => void;
};

// Mounted fresh each time the palette opens (parent renders it conditionally),
// so state starts clean with no reset effect.
export function CommandPalette({ onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [raw, setRaw] = useState<Station[]>([]); // candidate pool from the API
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { favorites, isFavorite, toggle } = useFavorites();
  const { recent } = useRecent();

  const region = useMemo(() => userRegion(), []);

  // Rank the candidate pool by region + recently-played + favorite + fuzzy
  // relevance + popularity. Recomputes when results or the user's lists change.
  const results = useMemo(() => {
    const recentIds = new Set(recent.map(s => s.id));
    const favoriteIds = new Set(favorites.map(s => s.id));
    return rankStations(raw, { query, region, recentIds, favoriteIds });
  }, [raw, query, region, recent, favorites]);

  // Focus the input on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  // Debounced search → fills the candidate pool (ranking happens above).
  useEffect(() => {
    const q = query.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q === '') { setRaw([]); setLoading(false); return; }

    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ q });
    if (region) params.set('region', region);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${params.toString()}`, { signal: ctrl.signal });
        if (!res.ok) { if (!cancelled) setRaw([]); return; }
        const data = (await res.json()) as unknown;
        if (!cancelled) {
          setRaw(Array.isArray(data) ? (data as Station[]) : []);
          setActive(0);
        }
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'AbortError') setRaw([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [query, region]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(s: Station | undefined) {
    if (!s) return;
    onSelect(s);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] bg-black/25 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search stations"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl rounded-2xl border border-white/60 bg-[rgba(251,247,243,0.82)] backdrop-blur-2xl shadow-[0_24px_80px_rgba(60,30,10,0.28)] overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-[var(--color-line)]">
          <span className="text-[var(--color-ink-3)]" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stations…"
            className="flex-1 bg-transparent outline-none text-[17px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)]"
          />
          {loading && <span className="spin-warm" aria-label="Searching" />}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {query.trim() === '' && (
            <div className="px-5 py-10 text-center text-base text-[var(--color-ink-3)]">
              Type to search thousands of stations.
            </div>
          )}
          {query.trim() !== '' && !loading && results.length === 0 && (
            <div className="px-5 py-10 text-center text-base text-[var(--color-ink-3)]">
              No stations found.
            </div>
          )}
          {results.map((s, i) => (
            <div
              key={s.id}
              data-idx={i}
              onClick={() => choose(s)}
              onMouseMove={() => setActive(i)}
              className={[
                'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl cursor-pointer',
                i === active ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : '',
              ].join(' ')}
            >
              <StationLogo name={s.name} favicon={s.favicon} />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold tracking-tight truncate">{s.name}</div>
                <div className="text-xs text-[var(--color-ink-3)] truncate">
                  {[s.country, s.bitrate > 0 ? `${s.bitrate} kbps` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); toggle(s); }}
                aria-label={isFavorite(s.id) ? 'Unfavorite' : 'Favorite'}
                className={[
                  'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none',
                  'cursor-pointer border border-transparent transition-colors',
                  'hover:border-[var(--color-warm)] hover:bg-[rgba(210,105,30,0.08)] hover:text-[var(--color-warm)]',
                  isFavorite(s.id) ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)]',
                ].join(' ')}
              >
                {isFavorite(s.id) ? '★' : '☆'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer hint (Raycast-style) */}
        <div className="flex items-center gap-5 px-5 h-12 border-t border-[var(--color-line)] text-[13px] text-[var(--color-ink-3)]">
          <span className="flex items-center gap-1.5"><kbd className="min-w-6 px-1.5 py-1 rounded-md border border-[var(--color-line)] bg-white text-center font-semibold text-[12px]">↵</kbd> play</span>
          <span className="flex items-center gap-1.5"><kbd className="min-w-6 px-1.5 py-1 rounded-md border border-[var(--color-line)] bg-white text-center font-semibold text-[12px]">↑</kbd><kbd className="min-w-6 px-1.5 py-1 rounded-md border border-[var(--color-line)] bg-white text-center font-semibold text-[12px]">↓</kbd> navigate</span>
          <span className="ml-auto flex items-center gap-1.5"><kbd className="px-1.5 py-1 rounded-md border border-[var(--color-line)] bg-white font-semibold text-[12px]">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
