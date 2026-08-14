/**
 * Where the E2E harness expects its processes, and how to move them.
 *
 *   E2E_SERVER_PORT   the game server `global-setup.ts` spawns       (default 5610)
 *   E2E_CLIENT_PORT   `vite preview` — the production-build configs  (default 5616)
 *   E2E_DEV_PORT      `vite dev` — the flow spec only                (default 5612)
 *
 * Defaults are the E2E lane of the 56xx port scheme (docs/2026-08-15-dev-runner-ports-plan.md):
 * dev is 560x, E2E is 561x, docker host ports are 562x. The lanes are disjoint by default,
 * so a suite runs with nothing set even while `pnpm dev` and the docker stack are up. The
 * env vars remain as escape hatches for a box where a 561x port is somehow spoken for.
 *
 * `vite.config.ts` defaults to the *dev* lane; the flow spec's dev server gets these ports
 * through `webServer.env` in playwright.config.ts instead — that config is where the two
 * processes agree.
 */
const port = (name: string, fallback: number): number => Number(process.env[name] ?? fallback)

export const SERVER_PORT = port('E2E_SERVER_PORT', 5610)
export const CLIENT_PORT = port('E2E_CLIENT_PORT', 5616)
export const DEV_PORT = port('E2E_DEV_PORT', 5612)

export const GAME_SERVER = `http://localhost:${SERVER_PORT}`
export const CLIENT_URL = `http://localhost:${CLIENT_PORT}`
export const DEV_URL = `http://localhost:${DEV_PORT}`

/** What a `vite preview` config hands the bundle so it talks to the game server directly. */
export const viteApiEnv = (): Record<string, string> => ({
  VITE_HTTP_BASE: GAME_SERVER,
  VITE_WS_BASE: `${GAME_SERVER.replace(/^http/, 'ws')}/ws`,
})
