'use client';

import { useEffect, useRef, useState } from 'react';
import { useSavedSongs, searchSavedSongs } from '@/app/lib/savedSongs';
import { rangeFilter, groupByDate, formatPlayed, type DateRange } from '@/app/lib/savedDates';
import { lookupITunesSong } from '@/app/lib/itunes';
import { usePreviewPlayer } from '@/app/lib/usePreviewPlayer';
import { buildExport, type ExportFormat } from '@/app/lib/integrations/export';
import { StationLogo } from './StationLogo';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** Trigger a client-side file download (works in the browser and the Electron renderer). */
function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SavedSongsDialog({ open, onOpenChange }: Props) {
  const { saved, remove, update } = useSavedSongs();
  // Saved-Songs preview leaves the radio paused after a clip (resumeRadioOnStop:
  // false) — matching the long-standing behavior of this dialog.
  const { previewId, audioRef, onEnded, toggle, stop } = usePreviewPlayer({ resumeRadioOnStop: false });
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<DateRange>('all');
  // Date reference for grouping/labels. The component stays mounted app-long,
  // so refresh it each time the dialog opens (see effect below) rather than
  // capturing mount time.
  const [now, setNow] = useState(() => Date.now());
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  // Ids we've already tried to backfill a preview for this session (incl. ones
  // iTunes had no match for) so we don't re-query them on every open.
  const previewTried = useRef<Set<string>>(new Set());

  // Backfill missing previews from iTunes when the dialog opens. Songs saved
  // before previews were captured (or metadata tracks) have no previewUrl; the
  // same iTunes lookup that yielded their Apple Music link also has a ~30s
  // clip, so fetch it and persist so the ▶ appears (and sticks next time).
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    for (const s of saved) {
      if (s.previewUrl || previewTried.current.has(s.id)) continue;
      previewTried.current.add(s.id);
      const term = ([s.artist, s.title].filter(Boolean).join(' ').trim()) || s.raw;
      lookupITunesSong(term, ctrl.signal).then(m => {
        if (!ctrl.signal.aborted && m?.previewUrl) update(s.id, { previewUrl: m.previewUrl });
      });
    }
    return () => ctrl.abort();
    // Run per open; `saved`/`update` are read fresh but excluded so persisting
    // a found preview (which changes `saved`) doesn't restart the sweep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Stop any preview when the dialog closes.
  useEffect(() => {
    if (open) return;
    stop();
    /* eslint-disable react-hooks/set-state-in-effect */
    setExportOpen(false);
    setRange('all');
    setQuery('');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, stop]);

  // Dismiss the export menu on an outside click (without closing the dialog).
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  // Stamped on open. If the dialog is left open across midnight the date
  // buckets can go stale until the next open — acceptable for this UI.
  // Refresh the date reference whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [open]);

  const filtered = rangeFilter(searchSavedSongs(saved, query), range, now);
  const groups = groupByDate(filtered, now);

  // Export *all* saved songs (not just the current filter) — "everything by default".
  const exportSaved = (format: ExportFormat) => {
    const { filename, mime, content } = buildExport(saved, format);
    downloadText(filename, mime, content);
  };

  return (
    <>
      <audio ref={audioRef} onEnded={onEnded} className="hidden" />
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
                <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-brand-gradient">♥ Saved songs</h2>
                <div className="flex items-center gap-2">
                  {saved.length > 0 && (
                    <div className="relative" ref={exportRef}>
                      <button
                        onClick={() => setExportOpen(o => !o)}
                        aria-haspopup="menu"
                        aria-expanded={exportOpen}
                        title="Export your saved songs to import into Apple Music, Spotify, or YouTube Music"
                        className="flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-3 py-1 border border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] cursor-pointer"
                      >
                        Export <span aria-hidden="true" className="text-[7px] translate-y-px">▼</span>
                      </button>
                      {exportOpen && (
                        <div role="menu" className="absolute right-0 mt-1.5 z-10 min-w-[12rem] bg-white rounded-xl border border-[var(--color-line)] shadow-[0_12px_32px_rgba(0,0,0,0.16)] py-1.5">
                          <button role="menuitem" onClick={() => { exportSaved('csv'); setExportOpen(false); }} className="w-full text-left px-3.5 py-2 hover:bg-[var(--color-bg)] cursor-pointer">
                            <div className="text-sm font-semibold text-[var(--color-ink)]">CSV</div>
                            <div className="text-[11px] text-[var(--color-ink-4)]">For transfer tools (Soundiiz, TuneMyMusic)</div>
                          </button>
                          <button role="menuitem" onClick={() => { exportSaved('m3u8'); setExportOpen(false); }} className="w-full text-left px-3.5 py-2 hover:bg-[var(--color-bg)] cursor-pointer">
                            <div className="text-sm font-semibold text-[var(--color-ink)]">M3U8</div>
                            <div className="text-[11px] text-[var(--color-ink-4)]">Playlist file (Apple Music, media players)</div>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={() => onOpenChange(false)} aria-label="Close" className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer">✕</button>
                </div>
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
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    {([['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setRange(key)}
                        aria-pressed={range === key}
                        className={[
                          'text-[11px] font-bold rounded-full px-3 py-1 cursor-pointer border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-brand-pink)] focus-visible:outline-none',
                          range === key
                            ? 'bg-brand text-white border-transparent'
                            : 'text-[var(--color-ink-3)] border-[var(--color-line)] hover:border-[var(--color-brand-pink)]',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {filtered.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-3)]">No songs match.</p>
                  ) : (
                    groups.map(group => (
                      <div key={group.label}>
                        <div className="text-[10px] tracking-[1.2px] uppercase font-extrabold text-[var(--color-ink-4)] mt-4 mb-1">
                          {group.label}
                        </div>
                        <ul className="flex flex-col">
                          {group.songs.map(s => (
                            <li key={s.id} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-line)]">
                              <StationLogo name={s.artist || s.title} favicon={s.cover} />
                              <div className="flex-1 min-w-0">
                                <div className="text-[15px] leading-tight truncate">
                                  {s.artist ? <><b className="font-bold text-[var(--color-ink)]">{s.artist}</b> <span className="text-[var(--color-ink-2)]">— {s.title}</span></> : <span className="font-semibold">{s.title}</span>}
                                </div>
                                <div className="text-xs text-[var(--color-ink-3)] truncate mt-0.5">♫ {s.stationName} · {formatPlayed(s, now)}</div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {s.previewUrl && (
                                  <button
                                    onClick={() => toggle(s.id, s.previewUrl)}
                                    aria-label={previewId === s.id ? 'Pause preview' : 'Play preview'}
                                    className="w-8 h-8 rounded-full border border-[var(--color-line)] flex items-center justify-center text-[12px] text-[var(--color-brand-purple)] hover:border-[var(--color-brand-purple)] cursor-pointer"
                                  >
                                    {previewId === s.id ? '⏸' : '▶'}
                                  </button>
                                )}
                                {s.appleMusicUrl && (
                                  <a href={s.appleMusicUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-brand text-white">Apple Music</a>
                                )}
                                <button onClick={() => remove(s.id)} aria-label={`Remove ${s.title}`} title="Remove from saved" className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-ink-4)] hover:text-[var(--color-danger)] hover:bg-[rgba(192,57,43,0.08)] cursor-pointer transition-colors">
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
                      </div>
                    ))
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
