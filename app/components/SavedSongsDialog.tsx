'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSavedSongs, searchSavedSongs } from '@/app/lib/savedSongs';
import { pauseRadio } from '@/app/lib/playbackBus';
import { readStoredVolume } from '@/app/lib/volume';
import { StationLogo } from './StationLogo';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function SavedSongsDialog({ open, onOpenChange }: Props) {
  const { saved, remove } = useSavedSongs();
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  // The preview <audio> stays mounted regardless of `open` so this ref is always
  // valid — letting us explicitly stop the preview when the dialog closes
  // (rather than relying on the element being unmounted).
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Stop any preview when the dialog closes.
  useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewId(null);
  }, [open]);

  const shown = useMemo(() => searchSavedSongs(saved, query), [saved, query]);

  const togglePreview = (id: string, url: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (previewId === id) { a.pause(); setPreviewId(null); return; }
    pauseRadio();           // never overlap the live stream
    a.volume = readStoredVolume(); // match the player's volume setting
    a.src = url;
    a.play().catch(() => {});
    setPreviewId(id);
  };

  return (
    <>
      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
      {/* Modal anchored near the top (not vertically centered) so the header +
          search bar stay put as the filtered list grows/shrinks below them. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-6 pt-[12vh] pb-6" onClick={() => onOpenChange(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Saved songs"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="overflow-y-auto p-7">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">★ Saved songs</h2>
                <button onClick={() => onOpenChange(false)} aria-label="Close" className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer">✕</button>
              </div>

              {saved.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-3)]">
                  No saved songs yet — tap the ♡ on a recognized song to save it here.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 border border-[var(--color-line)] rounded-full px-3.5 py-2 mb-4 bg-[var(--color-bg)]">
                    <span aria-hidden="true" className="text-[var(--color-ink-4)]">🔍</span>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search saved songs…"
                      className="flex-1 bg-transparent outline-none text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)]"
                    />
                  </div>

                  {shown.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-3)]">No matches.</p>
                  ) : (
                    <ul className="flex flex-col">
                      {shown.map(s => (
                        <li key={s.id} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-line)] last:border-none">
                          <StationLogo name={s.artist || s.title} favicon={s.cover} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[15px] leading-tight truncate">
                              {s.artist ? <><b className="font-bold text-[var(--color-ink)]">{s.artist}</b> <span className="text-[var(--color-ink-2)]">— {s.title}</span></> : <span className="font-semibold">{s.title}</span>}
                            </div>
                            <div className="text-xs text-[var(--color-ink-3)] truncate mt-0.5">♫ {s.stationName} · {hhmm(s.savedAt)}</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {s.previewUrl && (
                              <button
                                onClick={() => togglePreview(s.id, s.previewUrl)}
                                aria-label={previewId === s.id ? 'Pause preview' : 'Play preview'}
                                className="w-8 h-8 rounded-full border border-[var(--color-line)] flex items-center justify-center text-[12px] text-[var(--color-ink-2)] hover:border-[var(--color-warm)] cursor-pointer"
                              >
                                {previewId === s.id ? '⏸' : '▶'}
                              </button>
                            )}
                            {s.appleMusicUrl && (
                              <a href={s.appleMusicUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[var(--color-ink)] text-white">Apple Music</a>
                            )}
                            <button onClick={() => remove(s.id)} aria-label={`Remove ${s.title}`} title="Remove from saved" className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-ink-4)] hover:text-[var(--color-accent)] hover:bg-[rgba(192,57,43,0.08)] cursor-pointer transition-colors">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
