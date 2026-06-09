import { describe, it, expect, beforeEach } from 'vitest';
import { timeshiftEnabled, TIMESHIFT_KEY } from '../app/lib/timeshiftSetting';

// vitest environment is node — emulate the storage shape we read.
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      store: {} as Record<string, string>,
      getItem(k: string) { return (this.store as Record<string, string>)[k] ?? null; },
      setItem(k: string, v: string) { (this.store as Record<string, string>)[k] = v; },
    },
  };
});

describe('timeshiftEnabled', () => {
  it('defaults to true', () => {
    expect(timeshiftEnabled()).toBe(true);
  });
  it('respects a stored false', () => {
    (window as unknown as { localStorage: Storage }).localStorage.setItem(TIMESHIFT_KEY, 'false');
    expect(timeshiftEnabled()).toBe(false);
  });
});
