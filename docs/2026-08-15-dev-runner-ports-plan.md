# One-command dev runner + port architecture

Status: IMPLEMENTED 2026-08-15 (uncommitted). Verified: typecheck+lint+test green on
server/canvas (client lint blocked by a pre-existing JoinSession.tsx warning; client tests
329 green), full-stack boot + proxies probed, --canvas subset probed, E2E flow spec green
with no env vars while `pnpm dev` was running, `docker compose config` substitution checked
(live docker run pending — daemon was down).

## Goal

One command runs the stack — dev processes or docker — with all logs interleaved
in one terminal. Flags pick the slice:

```
pnpm dev              # server + canvas + table (DM syncing: publish → host)
pnpm dev --canvas     # server + canvas editor (build & save map scenes)
pnpm dev --table      # server + table client (run a session, no editor)
pnpm dev docker       # docker compose up --build (compose interleaves logs itself)
```

Server always rides along: canvas publishes to its library, table hosts from it.
Because both frontends reach it through their `/api` proxies, maps published in a
`--canvas` run are in SQLite for a later `--table` run — no sync step.

## Port architecture

Rule: **port = 5600 + lane×10 + app**. 56xx is free of common daemons and clear
of browser-blocked "unsafe ports". Dev and E2E bind 127.0.0.1 only; docker is
the LAN-facing sharing lane.

App digits (same in every lane): 0 = game-server, 1 = canvas/editor,
2 = table/session-client, 3 = site (future), 4 = bot (future), 5 = forge
(future), 6–9 = free / per-lane variants.

| Lane          | Block | server | canvas | table | table-preview | Binding |
|---------------|-------|--------|--------|-------|---------------|---------|
| Dev           | 560x  | 5600   | 5601   | 5602  | —             | 127.0.0.1 |
| E2E           | 561x  | 5610   | (5611 reserved) | 5612 | 5616   | 127.0.0.1 |
| Docker (host) | 562x  | 5620   | 5621   | 5622  | —             | LAN by design |

Container-internal ports (8787, nginx 80) do not move — Dockerfiles, nginx.conf,
and the compose service wiring stay untouched; only host mappings change.

All three lanes are disjoint: dev, an E2E run, and the docker stack can run
simultaneously.

## Key design point: lanes stop sharing defaults

Today `session/client/vite.config.ts` and `e2e/ports.ts` agree on ports by
having *identical defaults* (5174/8787). Splitting the lanes breaks that pact,
so Playwright must pass its ports explicitly via `webServer.env` — then vite's
defaults become the dev lane, and E2E always states its own.

## Changes

### 1. `scripts/dev.mjs` (new, ~70 lines, zero deps)

```js
#!/usr/bin/env node
// One-terminal dev runner. `pnpm dev [--canvas|--table]` or `pnpm dev docker`.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const BASE = Number(process.env.DEV_PORT_BASE ?? 5600)
const [SERVER_PORT, CANVAS_PORT, TABLE_PORT] = [BASE, BASE + 1, BASE + 2]
const args = process.argv.slice(2)

if (args[0] === 'docker') {
  // Compose already merges logs; just hand it the terminal.
  spawn('docker', ['compose', 'up', '--build', ...args.slice(1)], {
    stdio: 'inherit', shell: true,
  }).on('exit', (code) => process.exit(code ?? 0))
} else {
  const canvasOnly = args.includes('--canvas')
  const tableOnly = args.includes('--table')
  const procs = []
  const colors = { server: 33, canvas: 35, table: 36 } // yellow, magenta, cyan

  const run = (name, cmd, extraEnv) => {
    const child = spawn(cmd, {
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
    })
    const tag = `\x1b[${colors[name]}m[${name}]\x1b[0m`
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (l) => console.log(`${tag} ${l}`))
    }
    child.on('exit', (code) => shutdown(code ?? 0, name))
    procs.push(child)
  }

  let dying = false
  const shutdown = (code, who) => {
    if (dying) return
    dying = true
    if (who) console.log(`[dev] ${who} exited (${code}), stopping the rest`)
    for (const p of procs) {
      // shell:true means pnpm→vite/tsx trees; kill the whole tree on Windows.
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        p.kill('SIGINT')
      }
    }
    setTimeout(() => process.exit(code), 500)
  }
  process.on('SIGINT', () => shutdown(0))

  run('server', 'pnpm --filter @dnd/game-server dev', {
    PORT: String(SERVER_PORT),
    HOST: '127.0.0.1',
  })
  if (!tableOnly)
    run('canvas', 'pnpm --filter map-builder dev', {
      CANVAS_PORT: String(CANVAS_PORT),
      VITE_API_PROXY: `http://localhost:${SERVER_PORT}`,
    })
  if (!canvasOnly)
    run('table', 'pnpm --filter @dnd/session-client dev', {
      E2E_DEV_PORT: String(TABLE_PORT),      // vite.config's existing knobs
      E2E_SERVER_PORT: String(SERVER_PORT),
    })
  console.log(
    `[dev] server :${SERVER_PORT}` +
    (tableOnly ? '' : `  canvas http://localhost:${CANVAS_PORT}`) +
    (canvasOnly ? '' : `  table http://localhost:${TABLE_PORT}`),
  )
}
```

Root `package.json` gains `"dev": "node scripts/dev.mjs"`. pnpm forwards flags
(`pnpm dev --canvas`; `pnpm dev -- --canvas` also works).

### 2. `canvas/vite.config.ts`

- Add `server.port: Number(process.env.CANVAS_PORT ?? 5601)` and
  `strictPort: true` (a silently bumped port would break nothing today, but the
  whole point of the scheme is that ports mean things).
- Proxy default `http://localhost:8787` → `http://localhost:5600`.

### 3. `session/client/vite.config.ts`

- Port default 5174 → **5602**, proxy default 8787 → **5600**, `strictPort: true`.
- Comment updated: defaults are the dev lane; E2E passes its own via
  `webServer.env`.

### 4. `session/client/e2e/ports.ts`

- Defaults: `E2E_SERVER_PORT` 8787 → **5610**, `E2E_CLIENT_PORT` 5175 → **5616**,
  `E2E_DEV_PORT` 5174 → **5612**.
- Header comment rewritten: lanes are disjoint by default now; the env vars
  remain as escape hatches. The `E2E_SERVER_PORT=8790 E2E_CLIENT_PORT=5178`
  incantation dies.

### 5. `session/client/playwright.config.ts` (+ `playwright.metrics.config.ts`)

- `webServer` gets `env: { E2E_DEV_PORT: String(DEV_PORT), E2E_SERVER_PORT:
  String(SERVER_PORT) }` (and the metrics config the same for its preview
  server / `CLIENT_PORT`). `global-setup.ts` imports `ports.ts` directly, so
  the spawned game server follows automatically — verify it passes `PORT`
  through when spawning.

### 6. Server localhost binding (`session/server/src/config.ts`, `index.ts`)

- `config.host = process.env.HOST ?? ''`; `http.listen(port, host || undefined)`.
- dev.mjs and E2E set `HOST=127.0.0.1`; docker sets nothing → all interfaces,
  as the container needs.

### 7. `docker-compose.yml` host ports

```yaml
map-goblin:      "${DOCKER_EDITOR_PORT:-5621}:80"
game-server:     "${DOCKER_SERVER_PORT:-5620}:8787"
session-client:  "${DOCKER_TABLE_PORT:-5622}:80"
```

### 8. DM-facing copy follows the docker port

`HostSetup.tsx` and `session/auth.ts` error hints say "try
`http://localhost:8787`" — that's the address a DM types, i.e. the docker
*host* port. Update hints to **5620**; update the matching tests
(`HostSetup.test.tsx`, `auth.test.ts` use it as a sample URL — sample values
can stay, only user-visible hint strings must change, but keeping them aligned
costs nothing).

## Not doing

- No `concurrently`/`npm-run-all` dependency — 20 lines of `spawn` cover it.
- No log files / tee — the terminal is the deliverable.
- No changes to Dockerfiles, nginx.conf, or container-internal ports.
- No canvas E2E wiring (none exists); 5611 is reserved on paper only.

## Verification

1. `pnpm dev` → three prefixed log streams; canvas on 5601 saves+publishes a
   map; table on 5602 hosts it; server reachable only on 127.0.0.1.
2. `pnpm dev --canvas` / `--table` → correct subsets.
3. Ctrl+C → no orphaned `node`/`tsx`/`vite` in `tasklist`.
4. `pnpm --filter @dnd/session-client e2e` green with **no env vars set**,
   *while* `pnpm dev` is running (proves the lanes are disjoint).
5. `pnpm dev docker` → editor :5621, table :5622, server :5620; DM flow via
   HostSetup with the new hint copy.
6. `pnpm -r check` green.

## Follow-ups after ship

- Memory/docs referencing `E2E_SERVER_PORT=8790 E2E_CLIENT_PORT=5178` and dev
  ports 5174/8787 become stale — update the e2e-port-overrides memory note.
- Future apps take their reserved digit: site=3, bot=4, forge=5.
