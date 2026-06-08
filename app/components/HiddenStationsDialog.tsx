'use client';

import { useEffect } from 'react';
import { HiddenStationsSettings } from './HiddenStationsSettings';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Dedicated modal for unhiding stations, opened from Settings. Kept separate so
// the (potentially long) hidden list doesn't take up space in the Settings
// dialog. Layered above Settings (z-[60]); its own backdrop/Esc close just this.
export function HiddenStationsDialog({ open, onOpenChange }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hidden stations"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="overflow-y-auto p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-brand-purple)]">
              Hidden stations
            </h2>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer"
            >
              ✕
            </button>
          </div>
          <HiddenStationsSettings />
        </div>
      </div>
    </div>
  );
}
