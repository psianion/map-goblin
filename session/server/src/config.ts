// Config surface for @dnd/game-server.
// This file owns where things live; auth.ts owns what they mean. The admin pass is not
// here: it never touches disk in plaintext — auth.ts mints it on first run, prints it once
// and stores only its hash (see `ensureAdminPass`).

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type * as Protocol from '@dnd/core/src/shared/protocol'

/**
 * D3 forbids value imports from @dnd/core, so the server keeps its own copy of the
 * wire version. The annotation pins it to core's literal type: bump `PROTOCOL_VERSION`
 * in core and this line stops compiling, so the two cannot silently drift.
 */
export const PROTOCOL_VERSION: typeof Protocol.PROTOCOL_VERSION = 2

export interface Secrets {
  /** Signs session tokens (D6). Rotating it invalidates every token ever issued. */
  hmacSecret: string
}

export interface Config {
  port: number
  dbPath: string
  secretsPath: string
  secrets: Secrets
}

export function loadConfig(): Config {
  const dataDir = resolve(process.env.GAME_SERVER_DATA ?? './data')
  const secretsPath = resolve(dataDir, 'secrets.json')
  return {
    port: Number(process.env.PORT ?? 8787),
    dbPath: resolve(dataDir, 'game.db'),
    secretsPath,
    secrets: loadSecrets(secretsPath),
  }
}

/** Reads the persisted secrets, generating them on first run. */
function loadSecrets(path: string): Secrets {
  // A corrupt/unreadable file must throw rather than silently mint a new secret —
  // regenerating would invalidate every token this server has ever issued.
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Secrets

  const secrets: Secrets = { hmacSecret: randomBytes(32).toString('hex') }
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 })
  return secrets
}
