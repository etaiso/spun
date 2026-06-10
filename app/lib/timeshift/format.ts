// Time formatting shared by the timeshift UI (LIVE pill, scrubber tooltip).

/** Behind-live offset, e.g. −03:24, or −1:02:24 past one hour. Rounds TOTAL
 *  seconds first — naive `round(sec % 60)` renders 119.6 as "−01:60". */
export function fmtBehind(sec: number): string {
  const total = Math.round(Math.max(0, sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ms = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `−${h}:${ms}` : `−${ms}`;
}

/** Broadcast wall-clock at an epoch ms, locale-formatted with seconds. */
export function fmtWallClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
