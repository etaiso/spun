// Render an ISO 3166 alpha-2 country code as its flag emoji (regional-indicator
// pair), e.g. "IL" → 🇮🇱. Returns a globe for anything that isn't a 2-letter
// code. The app ships a Twemoji flag font (see globals.css) so these render even
// on Windows, whose system emoji font has no flag glyphs.
export function flagEmoji(code: string): string {
  if (code.length !== 2) return '🌐';
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
