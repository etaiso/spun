'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useHidden } from '@/app/lib/hidden';
import { StationLogo } from './StationLogo';

type Props = {
  station: Station;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
};

export function StationRow({ station, isActive, isFavorite, onSelect, onToggleFavorite }: Props) {
  const { hide } = useHidden();
  // Position of the open right-click menu (viewport coords), or null when closed.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Close the context menu on Escape or any scroll/resize.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'true' : undefined}
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={[
          'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors mb-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-warm)]',
          isActive
            ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-[var(--color-line)]'
            : 'hover:bg-[rgba(210,105,30,0.12)]',
        ].join(' ')}
      >
        <StationLogo name={station.name} favicon={station.favicon} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold tracking-tight truncate">{station.name}</div>
          <div className="text-xs text-[var(--color-ink-3)] truncate">
            {[station.country, station.bitrate > 0 ? `${station.bitrate} kbps` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={[
            'shrink-0 w-8 h-8 flex items-center justify-center text-xl leading-none',
            'cursor-pointer transition-transform hover:scale-125',
            isFavorite ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]',
          ].join(' ')}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </div>

      {/* Right-click context menu */}
      {menu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            role="menu"
            className="fixed z-50 min-w-[180px] rounded-xl border border-[var(--color-line)] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.22)] py-1.5"
            style={{ top: menu.y, left: menu.x }}
          >
            <button
              role="menuitem"
              onClick={() => { setMenu(null); setConfirmOpen(true); }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-bg)] cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[var(--color-ink-3)]">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
              Hide station
            </button>
          </div>
        </>
      )}

      {/* Confirmation modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Hide station"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-sm w-full p-6"
          >
            <h2 className="text-[15px] font-bold text-[var(--color-ink)]">Hide “{station.name}”?</h2>
            <p className="text-sm text-[var(--color-ink-3)] mt-2 leading-relaxed">
              It will stop appearing in search, favorites, popular and recently played. To bring it back,
              go to <span className="font-semibold text-[var(--color-ink-2)]">Settings → Hidden stations</span>.
            </p>
            <div className="flex justify-end gap-2.5 mt-5">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-3.5 py-1.5 rounded-full text-sm font-semibold text-[var(--color-ink-2)] border border-[var(--color-line)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { hide(station); setConfirmOpen(false); }}
                className="px-3.5 py-1.5 rounded-full text-sm font-semibold text-white bg-[var(--color-accent)] hover:opacity-90 cursor-pointer transition-opacity"
              >
                Hide station
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
