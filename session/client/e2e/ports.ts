/**
 * Where the E2E harness expects its two processes, and how to move them.
 *
 *   E2E_SERVER_PORT   the game server `global-setup.ts` spawns       (default 8787)
 *   E2E_CLIENT_PORT   `vite preview` — the production-build configs  (default 5175)
 *   E2E_DEV_PORT      `vite dev` — the flow spec only                (default 5174)
 *
 * Overridable because :8787 is not always free: on a box running Docker Desktop it is held
 * by `com.docker.backend`, and the alternative to an environment variable is a throwaway
 * config per machine, which is how a harness rots. Every default is the port the configs
 * have always used, so a run with nothing set is the run it always was.
 *
 * `vite.config.ts` reads the same two variables for the dev proxy — the dev server and the
 * flow spec have to agree on where the API is.
 */
const port = (name: string, fallback: number): number => Number(process.env[name] ?? fallback)

export const SERVER_PORT = port('E2E_SERVER_PORT', 8787)
export const CLIENT_PORT = port('E2E_CLIENT_PORT', 5175)
export const DEV_PORT = port('E2E_DEV_PORT', 5174)

export const GAME_SERVER = `http://localhost:${SERVER_PORT}`
export const CLIENT_URL = `http://localhost:${CLIENT_PORT}`
export const DEV_URL = `http://localhost:${DEV_PORT}`

/** What a `vite preview` config hands the bundle so it talks to the game server directly. */
export const viteApiEnv = (): Record<string, string> => ({
  VITE_HTTP_BASE: GAME_SERVER,
  VITE_WS_BASE: `${GAME_SERVER.replace(/^http/, 'ws')}/ws`,
})
