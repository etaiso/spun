import { describe, it, expect } from 'vitest';
import { gradientForName, initialLetter } from '../app/lib/colors';

describe('gradientForName', () => {
  it('returns the same gradient for the same name', () => {
    expect(gradientForName('KEXP')).toBe(gradientForName('KEXP'));
  });

  it('returns CSS linear-gradient strings', () => {
    const g = gradientForName('KEXP');
    expect(g).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  });

  it('handles empty string without crashing', () => {
    expect(typeof gradientForName('')).toBe('string');
  });

  // A legacy/partial favorite restored from localStorage can reach the UI
  // with a missing name (loadFromStorage doesn't normalize). The display
  // logo must never throw on it.
  it('handles a missing name without crashing', () => {
    expect(() => gradientForName(undefined as unknown as string)).not.toThrow();
    expect(gradientForName(undefined as unknown as string)).toMatch(/^linear-gradient/);
  });
});

describe('initialLetter', () => {
  it('returns the uppercased first letter, ignoring leading whitespace', () => {
    expect(initialLetter('Glglz')).toBe('G');
    expect(initialLetter('radio')).toBe('R');
    expect(initialLetter('  kexp')).toBe('K');
  });

  it("falls back to '?' for empty or whitespace-only names", () => {
    expect(initialLetter('')).toBe('?');
    expect(initialLetter('   ')).toBe('?');
  });

  it("falls back to '?' for a missing name without throwing", () => {
    expect(initialLetter(undefined as unknown as string)).toBe('?');
    expect(initialLetter(null as unknown as string)).toBe('?');
  });
});
