import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../app/lib/db/sqlite';
import { getAllState, setState } from '../app/lib/db/state';
import { GET, PUT } from '../app/api/state/route';
import type { NextRequest } from 'next/server';

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

describe('/api/state handlers', () => {
  it('PUT upserts and GET returns it', async () => {
    process.env.APP_DB_PATH = ':memory:';
    const put = await PUT(new Request('http://x/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'radio:hidden', value: '[{"id":"z"}]' }),
    }) as unknown as NextRequest);
    expect(put.status).toBe(204);
    const res = await GET();
    const body = await res.json();
    expect(body['radio:hidden']).toBe('[{"id":"z"}]');
  });

  it('PUT rejects a missing key', async () => {
    const res = await PUT(new Request('http://x/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x' }),
    }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});
