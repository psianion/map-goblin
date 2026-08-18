// Open + migrate. Nothing here knows the domain — that is stores.ts.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Sqlite from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type { Database }

/** Opens (creating if needed) the database at `path` — `:memory:` in tests — and migrates it. */
export function openDb(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Sqlite(path)
  db.pragma('journal_mode = WAL') // survives an ungraceful kill; readers don't block the writer
  db.pragma('foreign_keys = ON') // SQLite defaults this OFF, per connection
  migrate(db)
  return db
}

/**
 * Applies every migration this build carries that the file has not seen. Idempotent —
 * re-running applies nothing and returns 0. Each migration commits together with its
 * version row, so a crash mid-migration leaves it unrecorded and it retries whole.
 *
 * @returns how many migrations were applied.
 */
export function migrate(db: Database): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const applied = new Set(
    db.prepare<[], { version: number }>('SELECT version FROM migrations').all().map((r) => r.version),
  )
  const record = db.prepare<[number, number]>(
    'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
  )

  let count = 0
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1
    if (applied.has(version)) return
    db.transaction(() => {
      db.exec(sql)
      record.run(version, Date.now())
    })()
    count += 1
  })
  return count
}
