'use client';

import { useState } from 'react';
import { gradientForName } from '@/app/lib/colors';

type Props = { name: string; favicon: string; size?: number };

export function StationLogo({ name, favicon, size = 40 }: Props) {
  // Track which URL failed instead of a boolean, so a new favicon prop
  // automatically un-fails without needing useEffect to reset.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === favicon;
  const letter = (name.trim()[0] ?? '?').toUpperCase();

  if (!favicon || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-[10px] text-white font-extrabold shadow-[0_3px_8px_rgba(0,0,0,0.15)] shrink-0"
        style={{ width: size, height: size, background: gradientForName(name), fontSize: size * 0.42 }}
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={favicon}
      alt=""
      loading="lazy"
      onError={() => setFailedFor(favicon)}
      width={size}
      height={size}
      className="rounded-[10px] object-cover shrink-0 bg-[var(--color-line)]"
      style={{ width: size, height: size }}
    />
  );
}
