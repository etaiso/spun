import { describe, it, expect } from 'vitest';
import { gradientForName } from '../app/lib/colors';

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
});
