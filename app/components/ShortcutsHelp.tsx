'use client';

type Shortcut = { keys: string[]; label: string };

const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘', 'K'], label: 'Search stations' },
  { keys: ['Space'], label: 'Play / pause' },
  { keys: ['M'], label: 'Mute / unmute' },
  { keys: ['↑', '↓'], label: 'Volume up / down' },
  { keys: ['←', '→'], label: 'Previous / next favorite' },
  { keys: ['?'], label: 'Show this help' },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortcutsHelp({ open, onOpenChange }: Props) {
  return (
    <>
      <button
        onClick={() => onOpenChange(true)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full bg-white border border-[var(--color-line)] shadow-[0_4px_14px_rgba(0,0,0,0.12)] flex items-center justify-center text-base text-[var(--color-ink-3)] hover:text-[var(--color-ink)] hover:border-[var(--color-warm)] cursor-pointer transition-colors"
      >
        <span aria-hidden="true">⌨</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
          onClick={() => onOpenChange(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-md w-full p-7"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
                Keyboard shortcuts
              </h2>
              <button
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-4">
                  <span className="text-[15px] text-[var(--color-ink-2)]">{s.label}</span>
                  <span className="flex gap-1.5">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="min-w-7 px-2 py-1 rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] text-[13px] font-semibold text-[var(--color-ink)] text-center"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--color-ink-4)] mt-5">
              Shortcuts pause while you&apos;re typing in the search box. Press{' '}
              <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-line)] bg-[var(--color-bg)] text-[11px] font-semibold">Esc</kbd>{' '}
              to close.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
