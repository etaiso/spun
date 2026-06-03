'use client';

import { useEffect, useRef, useState } from 'react';
import { getEnergy } from '@/app/lib/audioBus';

// Decorative broadcast rings behind the now-playing canvas. While audio plays
// they scale to the live bass energy read from the Web Audio analyser. If no
// signal is available (e.g. the analyser couldn't be wired), they fall back to
// a gentle timed pulse instead.
export function RadioWaves({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!playing || !el) {
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
      // Gain + curve so normal-level energy produces visible motion.
      const target = Math.min(1, Math.pow(raw, 0.7) * 1.7);
      // Fast attack on beats, slower release — gives the rings a punch.
      const rate = target > smooth ? 0.55 : 0.12;
      smooth += (target - smooth) * rate;
      el.style.setProperty('--wave', smooth.toFixed(3));

      // If a few seconds in we've seen no real signal, the stream isn't
      // analysable — switch to the timed-pulse fallback.
      if (!fallback && performance.now() - startedAt > 3500 && peak < 0.02) {
        setFallback(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fallback]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div ref={ref} className={`radio-waves absolute inset-0${fallback ? ' radio-waves--fallback' : ''}`}>
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
