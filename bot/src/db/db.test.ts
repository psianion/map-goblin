import { describe, expect, it } from 'vitest'
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

  it('applies every migration exactly once on a fresh file', () => {
    const db = openDb(':memory:')
    db.exec('DROP TABLE migrations')
    expect(migrate(db)).toBe(MIGRATIONS.length)
    db.close()
  })
})
