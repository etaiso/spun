'use client';

import { useState } from 'react';
import { splitArtistTitle } from '@/app/lib/track';
import { humanizeGap } from '@/app/lib/trackingHistory';
import { isGap, historyRowKey } from '@/app/lib/nowPlayingTypes';
import type { HistoryItem } from '@/app/lib/nowPlayingTypes';
import { lookupITunesSong } from '@/app/lib/itunes';
import { usePreviewPlayer } from '@/app/lib/usePreviewPlayer';

// iTunes search term for a history title ("Artist - Title", or the raw string).
function termFor(raw: string): string {
  const { artist, title } = splitArtistTitle(raw);
  return ([artist, title].filter(Boolean).join(' ').trim()) || raw;
}

type PreviewState = 'idle' | 'resolving' | 'playing' | 'none';

// Session playlist log, rendered below the player controls. Carries a solid
// background + soft feather so the pulse rings dissolve smoothly into it.
// Tracked stations may include "no tracking" gap markers between runs. Each song
// row can play a ~30s iTunes preview (resolved on demand), which pauses and then
// auto-resumes the live radio.
export function PlaylistHistory({ history }: { history: HistoryItem[] }) {
  const { previewId, audioRef, onEnded, toggle, stop } = usePreviewPlayer({ resumeRadioOnStop: true });
  // iTunes term -> previewUrl, or null for a confirmed no-match. Resolved lazily
  // on click and kept for the session (history rows stay lean — nothing persisted).
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  if (history.length === 0) return null;

  const onPreview = (key: string, raw: string) => {
    if (previewId === key) { stop(); return; } // this row is playing → stop it
    const term = termFor(raw);
    const cached = resolved[term];
    if (cached !== undefined) { if (cached) toggle(key, cached); return; } // cached miss → no-op
    setResolvingKey(key);
    lookupITunesSong(term).then(m => {
      const url = m?.previewUrl || null;
      setResolved(r => ({ ...r, [term]: url }));
      setResolvingKey(k => (k === key ? null : k));
      if (url) toggle(key, url);
    });
  };

  return (
    <div className="relative z-10 bg-[var(--color-bg)]">
      <audio ref={audioRef} onEnded={onEnded} className="hidden" />
      <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">
        ▾ Playlist history
      </div>
      {history.map((h) => {
        const key = historyRowKey(h);
        if (isGap(h)) {
          return (
            <div
              key={key}
              className="flex items-center gap-3 py-3 text-[10px] tracking-[1.4px] uppercase font-bold text-[var(--color-ink-4)]"
            >
              <span className="flex-1 h-px bg-[var(--color-line)]" aria-hidden="true" />
              <span className="shrink-0">⋯ no tracking · {humanizeGap(h.fromAt, h.toAt)} ⋯</span>
              <span className="flex-1 h-px bg-[var(--color-line)]" aria-hidden="true" />
            </div>
          );
        }
        const { artist, title } = splitArtistTitle(h.title);
        const term = termFor(h.title);
        const state: PreviewState =
          previewId === key ? 'playing'
          : resolvingKey === key ? 'resolving'
          : resolved[term] === null ? 'none'
          : 'idle';
        return (
          <div
            key={key}
            className="group grid grid-cols-[64px_1fr_auto] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none"
          >
            <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
            <div className="text-base text-[var(--color-ink-2)]">
              {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
            </div>
            <PreviewButton state={state} onClick={() => onPreview(key, h.title)} />
          </div>
        );
      })}
    </div>
  );
}

function PreviewButton({ state, onClick }: { state: PreviewState; onClick: () => void }) {
  if (state === 'none') {
    return (
      <button
        type="button"
        disabled
        title="No preview available"
        aria-label="No preview available"
        className="self-center w-7 h-7 flex items-center justify-center rounded-full text-[11px] text-[var(--color-ink-4)] opacity-30 cursor-default"
      >
        ▶
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === 'playing' ? 'Pause preview' : state === 'resolving' ? 'Loading preview' : 'Play preview'}
      className={[
        'self-center w-7 h-7 flex items-center justify-center rounded-full text-[11px] cursor-pointer transition-colors border',
        state === 'playing'
          ? 'text-[var(--color-warm)] border-[var(--color-warm)]'
          : 'text-[var(--color-ink-3)] border-[var(--color-line)] opacity-70 group-hover:opacity-100 hover:text-[var(--color-warm)] hover:border-[var(--color-warm)]',
      ].join(' ')}
    >
      {state === 'resolving' ? <span className="spin-warm" /> : state === 'playing' ? '⏸' : '▶'}
    </button>
  );
}
