'use client';

type Props = {
  onOpenSearch: () => void;
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function TopBar({ onOpenSearch }: Props) {
  return (
    <header className="flex items-center gap-4 px-6 h-16 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] shrink-0">
      <div className="text-[15px] font-extrabold tracking-tight text-[var(--color-ink)]">
        <span className="text-[var(--color-warm)]">◈</span> Radio
      </div>
      <button
        onClick={onOpenSearch}
        className="ml-auto md:ml-6 flex-1 max-w-md flex items-center gap-2.5 h-10 px-4 rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-3)] hover:border-[var(--color-warm)] transition-colors cursor-pointer text-left shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
        aria-label="Search stations"
      >
        <span aria-hidden="true">🔍</span>
        <span className="text-sm flex-1">Search stations…</span>
        <kbd className="text-[11px] font-semibold px-1.5 py-0.5 rounded border border-[var(--color-line)] bg-[var(--color-bg)] tracking-wide">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
    </header>
  );
}
