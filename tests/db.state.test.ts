import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../app/lib/db/sqlite';
import { getAllState, setState } from '../app/lib/db/state';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('state queries', () => {
  it('round-trips opaque string values', () => {
    const db = freshDb();
    setState('radio:favorites', '[{"id":"a"}]', db);
    setState('radio:region', 'IL', db);
    const all = getAllState(db);
    expect(all['radio:favorites']).toBe('[{"id":"a"}]');
    expect(all['radio:region']).toBe('IL');
  });

  it('upserts (last write wins)', () => {
    const db = freshDb();
    setState('radio:volume', '0.5', db);
    setState('radio:volume', '0.8', db);
    expect(getAllState(db)['radio:volume']).toBe('0.8');
  });
});
