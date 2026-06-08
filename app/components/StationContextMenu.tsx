'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useHidden, useHideConfirm } from '@/app/lib/hidden';
import { useTracking } from '@/app/lib/tracking';

type Props = {
  station: Station;
  // Viewport coordinates to anchor the menu at (the right-click point).
  position: { x: number; y: number };
  onClose: () => void;
};

// Right-click menu for a station (Track / Hide), with a hide-confirmation step.
// Controlled by the parent: mount it with a station + position to open, and it
// calls onClose when dismissed or an action is taken. Reused by the sidebar
// rows and the command palette.
export function StationContextMenu({ station, position, onClose }: Props) {
  const { hide } = useHidden();
  const { skipConfirm, setSkipConfirm } = useHideConfirm();
  const { isTracked, track, untrack } = useTracking();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // "Don't ask again" checkbox state for the confirm dialog.
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape / scroll / resize / click outside. Clicks that land on the
  // full-screen overlay are handled by its own onClick (which also blocks
  // click-through). The document-level pointerdown below is a fallback that
  // catches clicks on anything that escapes the overlay's stacking context
  // (e.g. when this menu is reused inside the command palette's own fixed
  // backdrop), so dismissal stays reliable. Skipped while the confirm dialog is
  // up — that step has its own backdrop.
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (confirmOpen) setConfirmOpen(false); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    const onPointerDown = (e: PointerEvent) => {
      if (confirmOpen) return;
      const target = e.target as Node;
      // Overlay clicks and in-menu clicks are handled elsewhere; only act on
      // targets that slipped above the overlay.
      if (target === overlayRef.current) return;
      if (menuRef.current && !menuRef.current.contains(target)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose, confirmOpen]);

  if (confirmOpen) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6"
        onClick={onClose}
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
          <label className="flex items-center gap-2 mt-4 text-sm text-[var(--color-ink-3)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-line)] accent-[var(--color-brand-purple)] cursor-pointer"
            />
            Don’t ask again
          </label>
          <div className="flex justify-end gap-2.5 mt-4">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-full text-sm font-semibold text-[var(--color-ink-2)] border border-[var(--color-line)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { if (dontAskAgain) setSkipConfirm(true); hide(station); onClose(); }}
              className="px-3.5 py-1.5 rounded-full text-sm font-semibold text-white bg-[var(--color-danger)] hover:opacity-90 cursor-pointer transition-opacity"
            >
              Hide station
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Transparent layer to block click-through to the app behind the menu.
          stopPropagation keeps an outside click from also closing a surrounding
          surface (e.g. the command palette). Actual dismissal is handled by the
          document pointerdown listener above. */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[60]"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      />
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-[60] min-w-[190px] rounded-xl border border-[var(--color-line)] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.22)] py-1.5"
        style={{ top: position.y, left: position.x }}
      >
        <button
          role="menuitem"
          onClick={() => { if (isTracked(station.id)) untrack(station.id); else track(station); onClose(); }}
          className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-bg)] cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 text-[var(--color-ink-3)]">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" />
          </svg>
          {isTracked(station.id) ? 'Stop tracking' : 'Track station'}
        </button>
        <button
          role="menuitem"
          onClick={() => { if (skipConfirm) { hide(station); onClose(); } else setConfirmOpen(true); }}
          className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-bg)] cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 text-[var(--color-ink-3)]">
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
          Hide station
        </button>
      </div>
    </>
  );
}
