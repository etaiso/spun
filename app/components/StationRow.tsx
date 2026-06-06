'use client';

import { useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useTracking } from '@/app/lib/tracking';
import { StationLogo } from './StationLogo';
import { StationContextMenu } from './StationContextMenu';

type Props = {
  station: Station;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
};

export function StationRow({ station, isActive, isFavorite, onSelect, onToggleFavorite }: Props) {
  // Right-click menu anchor (viewport coords), or null when closed.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { isTracked, track, untrack } = useTracking();
  const tracked = isTracked(station.id);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'true' : undefined}
        onClick={onSelect}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        // Keep the hover highlight while this row's right-click menu is open
        // (the cursor has moved off the row onto the menu). Inline so it wins
        // over the hover utility regardless of pointer position.
        style={menu && !isActive ? { backgroundColor: 'rgba(210, 105, 30, 0.12)' } : undefined}
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
          onClick={(e) => { e.stopPropagation(); if (tracked) untrack(station.id); else track(station); }}
          aria-label={tracked ? 'Stop tracking' : 'Track station'}
          title={tracked ? 'Stop tracking' : 'Track station'}
          className={[
            'shrink-0 w-8 h-8 flex items-center justify-center',
            'cursor-pointer transition-transform hover:scale-125',
            tracked ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]',
          ].join(' ')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" />
          </svg>
        </button>
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

      {menu && (
        <StationContextMenu station={station} position={menu} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
