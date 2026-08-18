// The sole reader of process.env. Everything else takes an Env (or the field it needs)
// as an argument, so nothing can quietly grow a second config source.
//
// Boot fails naming the bad field and never printing its value — a token that shows up in
// a boot error shows up in the log channel, which is the one place it must never be.

import { z } from 'zod'

/** Discord snowflake. Loose on length; strict enough to catch a pasted username. */
const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord id (17-20 digits)')

/**
 * https anywhere, http only to the loopback host. The bot's bearer token rides this URL;
 * plaintext http off-box would put it on the wire.
 */
const goblinUrl = z.string().refine((raw) => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
}, 'must be an https url, or http on localhost only')

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_APP_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  DISCORD_OWNER_ID: snowflake,
  LOG_CHANNEL_ID: snowflake,
  LFG_CHANNEL_ID: snowflake,
  GOBLIN_SERVER_URL: goblinUrl,
  GOBLIN_ADMIN_PASS: z.string().min(1),
  PUBLIC_TABLE_URL: z.string().url(),
  BOT_DATA: z.string().min(1),
  // Comma-separated command names; a dev-only command syncs only when listed here.
  DEV_FEATURES: z
    .string()
    .optional()
    .transform((raw) => new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))),
})

export type Env = z.infer<typeof schema>

/** Parses and validates config. Throws naming every bad field — never their values. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source)
  if (result.success) return result.data
  const fields = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  throw new Error(`Invalid environment:\n  ${fields.join('\n  ')}`)
}
