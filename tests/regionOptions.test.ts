import { describe, it, expect } from 'vitest';
import { buildCountryOptions } from '../app/lib/region';

const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'FR', name: 'France' },
  { code: 'IL', name: 'Israel' },
];

describe('buildCountryOptions', () => {
  it('returns one option per country, sorted by display name', () => {
    const opts = buildCountryOptions(COUNTRIES, '');
    expect(opts.map(o => o.value)).toEqual(['FR', 'IL', 'US']);
    // Label is "<flag> <name>" — assert the name is present after the flag.
    expect(opts.find(o => o.value === 'FR')!.label).toContain('France');
  });

  it('includes the current region even when it is absent from the live list', () => {
    const opts = buildCountryOptions(COUNTRIES, 'JP');
    const jp = opts.find(o => o.value === 'JP');
    expect(jp).toBeDefined();
    expect(jp!.label).toContain('Japan');
  });

  it('does not duplicate the region when it is already in the list', () => {
    const opts = buildCountryOptions(COUNTRIES, 'US');
    expect(opts.filter(o => o.value === 'US')).toHaveLength(1);
  });

  it('returns just the region when the live list is empty', () => {
    const opts = buildCountryOptions([], 'IL');
    expect(opts.map(o => o.value)).toEqual(['IL']);
  });

  it('returns an empty list when there are no countries and no region', () => {
    expect(buildCountryOptions([], '')).toEqual([]);
  });
});
