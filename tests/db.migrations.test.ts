// tests/db.migrations.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../app/lib/db/sqlite';

describe('runMigrations', () => {
  it('creates app_state and records version 1', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const meta = db.prepare('SELECT version FROM schema_meta').get() as { version: number };
    expect(meta.version).toBe(1);
    const cols = db.prepare("PRAGMA table_info(app_state)").all().map((c) => (c as { name: string }).name);
    expect(cols).toEqual(expect.arrayContaining(['key', 'value', 'updated_at']));
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const meta = db.prepare('SELECT version FROM schema_meta').get() as { version: number };
    expect(meta.version).toBe(1);
  });
});
