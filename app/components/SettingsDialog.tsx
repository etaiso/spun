'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import type { PlayState } from './Player';
import { RegionPicker } from './RegionPicker';
import { HiddenStationsSettings } from './HiddenStationsSettings';
import { DebugPanel } from './DebugPanel';
import { useRingsEnabled } from '@/app/lib/visualizer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station: Station | null;
  playState: PlayState;
  currentTrack: string | null;
};

const DEBUG_KEY = 'radio:showDebug';

export function SettingsDialog({ open, onOpenChange, station, playState, currentTrack }: Props) {
  // Audio-reactive rings toggle (persisted, on by default).
  const { enabled: ringsOn, toggle: toggleRings } = useRingsEnabled();

  // Whether to show the debug readout (dev only). Persisted, default off.
  const [showDebug, setShowDebug] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; }
  });

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const isDev = process.env.NODE_ENV === 'development';

  const toggleDebug = () => {
    setShowDebug(v => {
      const next = !v;
      try { window.localStorage.setItem(DEBUG_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* Inner scroll container so the rounded corners are never clipped by
            the scrollbar. */}
        <div className="overflow-y-auto p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
              Settings
            </h2>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer"
            >
              ✕
            </button>
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[var(--color-ink)]">Localization</h3>
            <RegionPicker />
          </section>

          <section className="mt-7 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">Pulse rings</h3>
                <p className="text-xs text-[var(--color-ink-3)] mt-0.5">Audio-reactive rings behind the cover.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ringsOn}
                aria-label="Pulse rings"
                onClick={toggleRings}
                className={[
                  'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                  ringsOn ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                    ringsOn ? 'left-[18px]' : 'left-0.5',
                  ].join(' ')}
                />
              </button>
            </div>
          </section>

          <section className="mt-7 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[var(--color-ink)]">Hidden stations</h3>
            <HiddenStationsSettings />
          </section>

          {isDev && (
            <section className="mt-7 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--color-ink)]">
                  Debug <span className="text-[var(--color-ink-4)] font-normal">· dev only</span>
                </h3>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showDebug}
                  aria-label="Show debug panel"
                  onClick={toggleDebug}
                  className={[
                    'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                    showDebug ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                      showDebug ? 'left-[18px]' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>
              {showDebug && (
                <DebugPanel
                  station={station}
                  playState={playState}
                  currentTrack={currentTrack}
                  active={open && showDebug}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
