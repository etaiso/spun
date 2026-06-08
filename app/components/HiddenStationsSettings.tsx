'use client';

import { useHidden, useHideConfirm } from '@/app/lib/hidden';
import { StationLogo } from './StationLogo';

// Settings section listing hidden stations with a one-click "unhide" so the
// user can undo a hide they regret. Also surfaces a way to re-enable the hide
// confirmation if the user previously chose "Don't ask again".
export function HiddenStationsSettings() {
  const { hidden, unhide } = useHidden();
  const { skipConfirm, setSkipConfirm } = useHideConfirm();

  return (
    <div className="flex flex-col gap-3">
      {skipConfirm && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2.5">
          <p className="text-xs text-[var(--color-ink-3)]">
            Stations now hide without asking for confirmation.
          </p>
          <button
            onClick={() => setSkipConfirm(false)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-brand-purple)] border border-[var(--color-line)] hover:border-[var(--color-brand-pink)] hover:bg-white cursor-pointer transition-colors"
          >
            Confirm again
          </button>
        </div>
      )}
      {hidden.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-3)]">
          No hidden stations. Right-click a station in the sidebar to hide it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
          {hidden.map(s => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2"
            >
              <StationLogo name={s.name} favicon={s.favicon} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate text-[var(--color-ink)]">{s.name}</div>
                <div className="text-xs text-[var(--color-ink-3)] truncate">
                  {[s.country, s.bitrate > 0 ? `${s.bitrate} kbps` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => unhide(s.id)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-brand-purple)] border border-[var(--color-line)] hover:border-[var(--color-brand-pink)] hover:bg-white cursor-pointer transition-colors"
              >
                Unhide
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
