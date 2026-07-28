import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GAME_SERVER, SERVER_PORT } from './ports'

/**
 * Boots a real `@dnd/game-server` on a clean data directory and captures the admin pass it
 * prints on first run — the E2E cannot know it otherwise, and a test-only env override
 * would put a credential back door in production code for the sake of a fixture.
 *
 * Not a Playwright `webServer` entry: those swallow stdout, and stdout is the only place
 * that pass ever exists.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const dataDir = mkdtempSync(join(tmpdir(), 'map-goblin-e2e-'))
  const server = spawn('pnpm', ['--filter', '@dnd/game-server', 'start'], {
    cwd: join(import.meta.dirname, '../../..'),
    env: { ...process.env, GAME_SERVER_DATA: dataDir, PORT: String(SERVER_PORT) },
    shell: true,
  })

  const adminPass = await new Promise<string>((resolve, reject) => {
    let log = ''
    const timer = setTimeout(
      () => reject(new Error(`game-server did not start in 60s. Output:\n${log}`)),
      60_000,
    )
    const read = (chunk: Buffer) => {
      log += chunk.toString()
      const pass = /admin pass \(first run\): (\S+)/.exec(log)
      // Both, in order: the pass is printed before the listen callback fires.
      if (pass && /listening on/.test(log)) {
        clearTimeout(timer)
        resolve(pass[1])
      }
    }
    server.stdout.on('data', read)
    server.stderr.on('data', read)
    server.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`game-server exited with ${code} before it was ready. Output:\n${log}`))
    })
  })

  process.env.E2E_ADMIN_PASS = adminPass
  process.env.E2E_SERVER_URL = GAME_SERVER

  return async () => {
    // `pnpm` spawns `tsx` spawns node: killing the shell leaves the server holding the port,
    // which breaks the *next* run rather than this one. Kill the tree.
    if (server.pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(-server.pid, 'SIGTERM')
      }
    }
    await new Promise((done) => setTimeout(done, 500))
    rmSync(dataDir, { recursive: true, force: true })
  }
}
