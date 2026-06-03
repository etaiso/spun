'use client';

import { useState } from 'react';
import { gradientForName } from '@/app/lib/colors';

type Props = {
  name: string;
  favicon: string;
  size: number;
  dim?: boolean;
  className?: string;
};

/**
 * Large station artwork for the now-playing panel. radio-browser's only
 * image field is `favicon`, so that's our "cover". It's shown object-contain
 * on the station's deterministic gradient (handles logos of any size without
 * stretching). When there's no favicon — or it fails to load — we fall back
 * to the station NAME on the gradient rather than a blank colored rectangle.
 */
export function StationCover({ name, favicon, size, dim = false, className = '' }: Props) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showImage = favicon && favicon !== failedFor;

  return (
    <div
      className={`relative rounded-2xl overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size, background: gradientForName(name), opacity: dim ? 0.55 : 1 }}
    >
      {showImage ? (
        <img
          src={favicon}
          alt=""
          onError={() => setFailedFor(favicon)}
          className="absolute inset-0 w-full h-full object-contain p-[14%] drop-shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-5 text-center">
          <span
            className="text-white font-extrabold leading-[1.1] tracking-tight line-clamp-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
            style={{ fontSize: Math.max(15, Math.round(size * 0.13)) }}
          >
            {name}
          </span>
        </div>
      )}
    </div>
  );
}
