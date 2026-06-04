// app/lib/db/sqlite.ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type DB = Database.Database;

const MIGRATIONS: { version: number; up: (db: DB) => void }[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_meta (version) VALUES (0)').run();
  let current = row?.version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.transaction(() => {
        m.up(db);
        db.prepare('UPDATE schema_meta SET version = ?').run(m.version);
      })();
      current = m.version;
    }
  }
}

function dbPath(): string {
  return process.env.APP_DB_PATH || path.join(process.cwd(), 'data', 'app_state.db');
}

const g = globalThis as unknown as { __APP_DB__?: DB };

export function getDb(): DB {
  if (g.__APP_DB__) return g.__APP_DB__;
  const p = dbPath();
  if (p !== ':memory:') fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  g.__APP_DB__ = db;
  return db;
}
