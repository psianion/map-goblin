// Read once at boot. `git` is absent inside the container, so the image passes BOT_COMMIT.
import { execSync } from 'node:child_process'

export const BOOT_AT = Date.now()

export const COMMIT: string = (() => {
  if (process.env.BOT_COMMIT) return process.env.BOT_COMMIT
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
})()
