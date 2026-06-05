const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#c0392b', '#7a1f15'],
  ['#2c5aa0', '#1a3866'],
  ['#d35400', '#8e3500'],
  ['#d2691e', '#8b3a0f'],
  ['#6b3410', '#3d1d09'],
  ['#1e6650', '#0e3a2c'],
  ['#7a3a8c', '#48214f'],
  ['#a85a2c', '#5f3217'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function gradientForName(name: string): string {
  const [a, b] = PALETTE[hash(name ?? '') % PALETTE.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// First letter of a station name for the logo fallback chip, uppercased.
// Coerces a missing/empty name to '?' — persisted favorites are JSON.parsed
// from localStorage without normalization, so a legacy/partial entry can
// reach the UI with no name, and the chip must render rather than throw.
export function initialLetter(name: string): string {
  return ((name ?? '').trim()[0] ?? '?').toUpperCase();
}
