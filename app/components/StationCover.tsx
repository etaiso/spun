'use client';

import { useState } from 'react';
import { gradientForName } from '@/app/lib/colors';

type Props = {
  name: string;
  favicon: string;
  size: number;
  dim?: boolean;
  className?: string;
  // Track/album art (e.g. from Shazam). When present it's shown full-bleed as
  // real cover artwork; on load failure we fall back to the station favicon,
  // then to the station name.
  cover?: string;
};

/**
 * Large station artwork for the now-playing panel. Prefers track cover art
 * (`cover`, e.g. from Shazam) when available, otherwise radio-browser's
 * `favicon`. Either image is shown full-bleed (object-cover) so it fills the
 * square edge-to-edge with no border. When neither image is available — or both
 * fail to load — we fall back to the station NAME on the deterministic
 * gradient rather than a blank colored rectangle.
 */
export function StationCover({ name, favicon, size, dim = false, className = '', cover }: Props) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const coverOk = cover && !failed[cover];
  const faviconOk = favicon && !failed[favicon];
  const src = coverOk ? cover : faviconOk ? favicon : null;

  return (
    <div
      className={`relative rounded-2xl overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size, background: gradientForName(name), opacity: dim ? 0.55 : 1 }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          onError={() => setFailed(f => ({ ...f, [src]: true }))}
          className="absolute inset-0 w-full h-full object-cover"
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
