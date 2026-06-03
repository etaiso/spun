'use client';

// Decorative broadcast rings behind the now-playing canvas. Purely visual;
// gently pulses while audio is playing.
export function RadioWaves({ playing }: { playing: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className={`radio-waves absolute inset-0${playing ? ' radio-waves--playing' : ''}`}>
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
