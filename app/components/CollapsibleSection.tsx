'use client';

import { useState } from 'react';

type Props = {
  title: string;
  defaultCollapsed?: boolean;
  count?: number;
  children: React.ReactNode;
};

export function CollapsibleSection({ title, defaultCollapsed = false, count, children }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div>
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 mb-3.5 text-[11px] tracking-[1.4px] text-[var(--color-brand-purple)] font-extrabold uppercase cursor-pointer hover:opacity-75 transition-opacity"
      >
        <span
          className="text-[9px] transition-transform duration-150 inline-block"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}
          aria-hidden="true"
        >
          ▾
        </span>
        <span>{title}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[var(--color-ink-4)] font-bold">{count}</span>
        )}
      </button>
      {!collapsed && children}
    </div>
  );
}
