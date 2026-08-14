#!/usr/bin/env node
// One-terminal runner for the dev stack (docs/2026-08-15-dev-runner-ports-plan.md).
//
//   pnpm dev              server + canvas + table
//   pnpm dev --canvas     server + canvas (build & save map scenes)
//   pnpm dev --table      server + table (host a session, no editor)
//   pnpm dev docker       docker compose up --build (compose interleaves its own logs)
//
// Dev lane ports: server 5600, canvas 5601, table 5602 — shift the whole lane with
// DEV_PORT_BASE. Everything binds 127.0.0.1; docker is the LAN-facing lane.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const BASE = Number(process.env.DEV_PORT_BASE ?? 5600)
const [SERVER_PORT, CANVAS_PORT, TABLE_PORT] = [BASE, BASE + 1, BASE + 2]
const args = process.argv.slice(2)

if (args[0] === 'docker') {
  spawn('docker', ['compose', 'up', '--build', ...args.slice(1)], {
    stdio: 'inherit',
    shell: true,
  }).on('exit', (code) => process.exit(code ?? 0))
} else {
  const canvasOnly = args.includes('--canvas')
  const tableOnly = args.includes('--table')
  const procs = []
  const colors = { server: 33, canvas: 35, table: 36 }

  let dying = false
  const shutdown = (code, who) => {
    if (dying) return
    dying = true
    if (who) console.log(`[dev] ${who} exited (${code}), stopping the rest`)
    for (const p of procs) {
      // shell:true means each pid is a shell running pnpm running vite/tsx —
      // kill the tree, or the real process keeps the port (same move as
      // session/client/e2e/global-setup.ts).
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        p.kill('SIGINT')
      }
    }
    setTimeout(() => process.exit(code), 500)
  }
  process.on('SIGINT', () => shutdown(0))

  const run = (name, filter, extraEnv) => {
    const child = spawn(`pnpm --filter ${filter} dev`, {
      shell: true,
      // FORCE_COLOR keeps vite/tsx colorful through the pipe, unless the user said NO_COLOR.
      env: { ...process.env, ...(process.env.NO_COLOR ? {} : { FORCE_COLOR: '1' }), ...extraEnv },
    })
    const tag = `\x1b[${colors[name]}m[${name}]\x1b[0m`
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => console.log(`${tag} ${line}`))
    }
    child.on('exit', (code) => shutdown(code ?? 0, name))
    procs.push(child)
  }

  run('server', '@dnd/game-server', { PORT: String(SERVER_PORT), HOST: '127.0.0.1' })
  if (!tableOnly)
    run('canvas', 'map-builder', {
      CANVAS_PORT: String(CANVAS_PORT),
      VITE_API_PROXY: `http://localhost:${SERVER_PORT}`,
    })
  if (!canvasOnly)
    run('table', '@dnd/session-client', {
      E2E_DEV_PORT: String(TABLE_PORT),
      E2E_SERVER_PORT: String(SERVER_PORT),
    })

  console.log(
    `[dev] server :${SERVER_PORT}` +
      (tableOnly ? '' : `  canvas http://localhost:${CANVAS_PORT}`) +
      (canvasOnly ? '' : `  table http://localhost:${TABLE_PORT}`),
  )
}
