import { describe, expect, it } from 'vitest'
import Sqlite from 'better-sqlite3'
import { migrate, openDb } from './db'
import { MIGRATIONS } from './migrations'

describe('openDb', () => {
  it('opens with the pragmas set and the schema applied', () => {
    const db = openDb(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    const versions = db.prepare<[], { version: number }>('SELECT version FROM migrations').all()
    expect(versions).toHaveLength(MIGRATIONS.length)
    db.close()
  })

  it('migrates idempotently', () => {
    const db = openDb(':memory:')
    expect(migrate(db)).toBe(0) // openDb already applied them
    expect(migrate(db)).toBe(0)
    db.close()
  })

  // A genuinely empty database, not one whose migrations table was dropped out from under a
  // schema that is still there: an ALTER TABLE migration is only re-runnable when the table
  // it alters has not already been altered.
  it('applies every migration exactly once on a fresh file', () => {
    const db = new Sqlite(':memory:')
    expect(migrate(db)).toBe(MIGRATIONS.length)
    expect(migrate(db)).toBe(0)
    db.close()
  })
})
