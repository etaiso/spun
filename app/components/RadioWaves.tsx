'use client';

import { useEffect, useRef, useState } from 'react';
import { getEnergy } from '@/app/lib/audioBus';
import { useRingsEnabled } from '@/app/lib/visualizer';

// Decorative broadcast rings that radiate from the station avatar. Rendered as
// an absolute layer centred on its (relatively-positioned) parent; the rings
// scale to the live bass energy while audio plays, with a gentle timed pulse
// fallback when a stream can't be analysed. Can be turned off in Settings.
export function RadioWaves({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const { enabled } = useRingsEnabled();

  useEffect(() => {
    const el = ref.current;
    if (!playing || !enabled || !el) {
      el?.style.setProperty('--wave', '0');
      setFallback(false);
      return;
    }

    let raf = 0;
    let smooth = 0;
    let peak = 0;
    const startedAt = performance.now();

    const tick = () => {
      const raw = getEnergy(); // 0…1 (bass-weighted)
      peak = Math.max(peak, raw);
      const target = Math.min(1, Math.pow(raw, 0.7) * 1.4);
      const rate = target > smooth ? 0.5 : 0.12; // fast attack, slow release
      smooth += (target - smooth) * rate;
      el.style.setProperty('--wave', smooth.toFixed(3));

      if (!fallback && performance.now() - startedAt > 3500 && peak < 0.02) {
        setFallback(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, enabled, fallback]);

  if (!enabled) return null;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`radio-waves pointer-events-none absolute inset-0 z-0${fallback ? ' radio-waves--fallback' : ''}`}
    >
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
