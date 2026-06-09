'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// A searchable single-select dropdown (combobox): filter by typing, navigate
// with ↑/↓, pick with Enter/click, dismiss with Esc/click-away. Replaces a
// native <select> so a 200-country list is searchable — and so flags actually
// render in the list (native <option>s don't use the Twemoji font on Windows).
export function Combobox({ trigger, value, options, onSelect, searchPlaceholder, ariaLabel, keepOpen = false }: {
  trigger: React.ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
  searchPlaceholder: string;
  ariaLabel: string;
  // Stay open after a pick so several options can be added in one go
  // (genre multiselect); the picked option leaves the list. Single-select
  // (country) closes on pick.
  keepOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Focus the search when the menu opens (query/active are reset in `openMenu`,
  // keeping setState out of effects).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  const openMenu = () => { setQuery(''); setActive(0); setOpen(true); };

  // Dismiss on click-away.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(o: { value: string } | undefined) {
    if (!o) return;
    onSelect(o.value);
    if (keepOpen) {
      // Multiselect: keep the menu open and clear the search so the (now
      // shorter) list is ready for the next pick without reopening.
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    } else {
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="relative flex items-center cursor-pointer rounded-full border border-[var(--color-line)] bg-white pl-4 pr-9 h-9 text-sm font-semibold text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] transition-colors max-w-[240px]"
      >
        <span className="truncate">{trigger}</span>
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-3)]">▾</span>
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-72 rounded-2xl border border-[var(--color-line)] bg-white shadow-[0_16px_48px_rgba(60,30,10,0.18)] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--color-line)]">
            <span className="text-[var(--color-ink-4)] text-sm" aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent outline-none text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)]"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1.5">
            {filtered.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-[var(--color-ink-3)]">No matches</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value || '__all'}
                  data-idx={i}
                  type="button"
                  onClick={() => choose(o)}
                  onMouseMove={() => setActive(i)}
                  className={[
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                    i === active ? 'bg-[rgba(168,85,247,0.10)]' : '',
                    o.value === value && value !== '' ? 'font-bold text-[var(--color-brand-purple)]' : 'text-[var(--color-ink-2)]',
                  ].join(' ')}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && value !== '' && <span aria-hidden="true" className="text-[var(--color-brand-purple)]">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
