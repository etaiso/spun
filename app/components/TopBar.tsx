'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useRegion, useRegionLock } from '@/app/lib/region';

type Props = {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenSaved: () => void;
  // Highlight the settings control while its modal is open.
  settingsActive: boolean;
};

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🌐';
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// Platform detection that's hydration-safe: the server (and the first client
// render, to match it) sees `false`, then React swaps to the real value. Using
// useSyncExternalStore avoids both the SSR/client mismatch ("Ctrl K" vs "⌘K")
// and a setState-in-effect cascade.
const noopSubscribe = () => () => {};
function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}

export function TopBar({ onOpenSearch, onOpenSettings, onOpenSaved, settingsActive }: Props) {
  const isMac = useIsMac();

  // Surface the active region alongside the settings cog (one merged control —
  // both open the same modal). Shown only while Region-only mode is on — when
  // it's off the region doesn't filter anything, so the cog stands alone.
  const { region } = useRegion();
  const { locked } = useRegionLock();
  const showRegion = !!region && locked;
  const regionName = useMemo(() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region; }
    catch { return region; }
  }, [region]);

  return (
    <header className="flex items-center gap-4 px-6 h-16 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] shrink-0">
      <div className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight text-[var(--color-ink)]">
        {/* App logo: concentric pulse rings, matching the desktop app icon. */}
        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-10 h-10">
          <defs>
            <linearGradient id="logoGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#6366F1" />
              <stop offset="0.55" stopColor="#A855F7" />
              <stop offset="1" stopColor="#EC4899" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width="23" height="23" rx="6" fill="url(#logoGradient)" />
          <g fill="none" stroke="#ffffff" strokeLinecap="round">
            <circle cx="12" cy="12" r="8" strokeWidth="1" strokeOpacity="0.4" />
            <circle cx="12" cy="12" r="5" strokeWidth="1.3" strokeOpacity="0.8" />
          </g>
          <circle cx="12" cy="12" r="2.2" fill="#ffffff" />
        </svg>
        {/* "spun" wordmark — lowercase, filled with the logo's gradient. */}
        <svg viewBox="0 0 57 31" className="h-[28px] w-auto" role="img" aria-label="Spun">
          <defs>
            <linearGradient id="wordmarkGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6366F1" />
              <stop offset="0.55" stopColor="#A855F7" />
              <stop offset="1" stopColor="#EC4899" />
            </linearGradient>
          </defs>
          <text x="0" y="25" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" fontSize="26" fontWeight="800" letterSpacing="-1.4" fill="url(#wordmarkGradient)">spun</text>
        </svg>
      </div>
      <button
        onClick={onOpenSearch}
        className="ml-auto md:ml-6 flex-1 max-w-md flex items-center gap-2.5 h-10 px-4 rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-3)] hover:border-[var(--color-brand-pink)] transition-colors cursor-pointer text-left shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
        aria-label="Search stations"
      >
        <span aria-hidden="true">🔍</span>
        <span className="text-sm flex-1">Search stations…</span>
        <kbd className="inline-flex items-center gap-1 text-[14px] font-semibold px-2 py-1 rounded border border-[var(--color-line)] bg-[var(--color-bg)] tracking-wide leading-none">
          {isMac ? (
            <>
              <span>⌘</span>
              <span>K</span>
            </>
          ) : (
            'Ctrl K'
          )}
        </kbd>
      </button>
      <button
        onClick={onOpenSaved}
        aria-label="Saved songs"
        title="Saved songs (S)"
        className="w-10 h-10 rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-3)] hover:text-[var(--color-ink)] hover:border-[var(--color-brand-pink)] transition-colors cursor-pointer flex items-center justify-center shrink-0"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </button>
      {/* Settings control. When Region-only mode is on, the locked region sits
          next to the cog in the same pill — both open the same modal, so they're
          one button. Highlighted only while the modal is open. */}
      <button
        onClick={onOpenSettings}
        aria-label={showRegion ? `Settings — region: ${regionName}` : 'Settings'}
        title={showRegion ? `Region · ${regionName} — open settings` : 'Settings'}
        className={[
          'flex items-center h-10 rounded-full border bg-white transition-colors cursor-pointer shrink-0',
          showRegion ? 'gap-2 pl-3 pr-2.5' : 'w-10 justify-center',
          settingsActive
            ? 'border-[var(--color-brand-pink)] text-[var(--color-ink)]'
            : 'border-[var(--color-line)] text-[var(--color-ink-3)] hover:text-[var(--color-ink)] hover:border-[var(--color-brand-pink)]',
        ].join(' ')}
      >
        {showRegion && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="text-[15px] leading-none" aria-hidden="true">{flagEmoji(region)}</span>
              <span className="text-[13px] font-semibold tracking-wide text-[var(--color-ink-2)]">{region}</span>
            </span>
            <span className="w-px self-stretch my-2 bg-[var(--color-line)]" aria-hidden="true" />
          </>
        )}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  );
}
