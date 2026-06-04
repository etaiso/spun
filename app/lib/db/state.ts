import { getDb, type DB } from './sqlite';

/** All persisted key→value rows as opaque strings (verbatim localStorage values). */
export function getAllState(db: DB = getDb()): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_state').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Upsert one key with the raw string value the client wrote. */
export function setState(key: string, value: string, db: DB = getDb()): void {
  db.prepare(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}
