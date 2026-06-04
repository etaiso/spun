'use client';

import { useEffect, useRef } from 'react';
import { getEnergy } from '@/app/lib/audioBus';

// Broadcast "sonar" rings that emanate from the station avatar: rings spawn at
// the cover edge and expand outward while fading, like a transmission ping.
// Drawn on a <canvas> (one rAF loop, no per-frame React renders) centred on the
// cover, so the rings radiate past it across the player area.
//
// The audio drives *intensity*, not existence: spawn cadence, ring speed, and
// brightness all scale with the live energy — but a baseline cadence keeps rings
// emanating even when energy is zero (silent passage, or the analyser never
// wired up), so the visual is never frozen. The energy is auto-gained (a
// decaying peak tracker) so quiet/compressed streams still normalise to a
// visibly moving signal instead of sitting near zero.

const WARM = '210, 105, 30'; // var(--color-warm), rgb channels
const SIZE = 560; // canvas css px (square), centred on the cover
const START_R = 92; // rings appear just outside the ~190px cover

type Ring = { born: number; speed: number; strength: number };

export function RadioWaves({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const maxR = SIZE / 2 - 2;

    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!playing) return;

    // Respect reduced-motion: draw faint static rings, no animation.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      [120, 175, 235].forEach((r, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${WARM}, ${0.16 - i * 0.045})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      });
      return;
    }

    const rings: Ring[] = [];
    let raf = 0;
    let lastSpawn = 0;
    let gain = 0.15; // adaptive energy ceiling (auto-gain)
    let smooth = 0; // smoothed, normalised energy

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      // --- auto-gained energy -------------------------------------------------
      const raw = getEnergy(); // 0…1, bass-weighted (0 if not analysable)
      // Ceiling rises instantly to new peaks, decays slowly so a quiet stretch
      // re-normalises upward instead of flatlining.
      gain = Math.max(raw, gain * 0.995);
      const norm = raw / Math.max(gain, 0.04); // 0…1 relative to recent peak
      smooth += (norm - smooth) * (norm > smooth ? 0.5 : 0.12); // fast attack
      // Baseline floor → never fully static, even with no signal.
      const e = Math.max(0.14, Math.min(1, smooth));

      ctx.clearRect(0, 0, SIZE, SIZE);

      // Spawn cadence tightens with energy: ~850ms when quiet → ~260ms when loud.
      const interval = 850 - e * 590;
      if (now - lastSpawn > interval) {
        lastSpawn = now;
        rings.push({ born: now, speed: 70 + e * 150, strength: 0.3 + e * 0.7 });
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const radius = START_R + ((now - r.born) / 1000) * r.speed;
        if (radius > maxR) {
          rings.splice(i, 1);
          continue;
        }
        const life = (radius - START_R) / (maxR - START_R); // 0 at cover → 1 at edge
        const alpha = (1 - life) * 0.55 * r.strength;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${WARM}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1 + r.strength * 2;
        ctx.stroke();
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ width: SIZE, height: SIZE }}
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-0"
    />
  );
}
