import { describe, it, expect } from 'vitest';
import { localOnlyKeys, isEphemeralKey } from '../app/lib/persist';

describe('localOnlyKeys', () => {
  it('returns radio:* keys present locally but not on the server', () => {
    const server = ['radio:favorites'];
    const local = ['radio:favorites', 'radio:savedSongs', 'theme', 'radio:volume'];
    expect(localOnlyKeys(server, local)).toEqual(['radio:savedSongs', 'radio:volume']);
  });

  it('ignores non radio:* keys', () => {
    expect(localOnlyKeys([], ['foo', 'bar'])).toEqual([]);
  });
});

describe('isEphemeralKey', () => {
  it('flags the localStorage-only caches that must never be synced up', () => {
    expect(isEphemeralKey('radio:sessions')).toBe(true);
    expect(isEphemeralKey('radio:trackingHistory')).toBe(true);
  });
  it('does not flag durable keys', () => {
    expect(isEphemeralKey('radio:favorites')).toBe(false);
    expect(isEphemeralKey('radio:savedSongs')).toBe(false);
  });
});
