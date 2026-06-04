import { describe, it, expect } from 'vitest';
import { localOnlyKeys } from '../app/lib/persist';

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
