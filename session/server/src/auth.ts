// D6 — three token kinds, one gate.
//   admin pass    — printed once on first run, only the hash is stored (campaign_id null)
//   invite code   — 6 unambiguous characters, resolves to the one active session that owns it
//   session token — HMAC-signed {identityId, campaignId, role, exp}; the only thing the
//                   WS upgrade accepts, and what every token-authenticated route reads.
// Discord OAuth later becomes another issuer of the same token — nothing here changes.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { Role } from '@dnd/core/src/shared/protocol'
import type { PassStore, SessionRow, SessionStore } from './db/stores'

export interface TokenClaims {
  identityId: string
  campaignId: string
  role: Role
  /**
   * The one session this token may open, when it was minted for a session at all.
   *
   * Player tokens always carry it: a player is invited to *a table*, so when that table
   * ends — or the DM starts a fresh one under a new invite code — their token stops
   * opening anything, instead of silently following the campaign into the next session.
   *
   * DM tokens are minted at campaign creation, before any session exists, and are left
   * unbound on purpose: the DM owns every table their campaign will ever run.
   */
  sessionId?: string
  /** Expiry, epoch ms. */
  exp: number
}

/** Long enough that a weekly game does not re-issue mid-campaign, short enough to matter. */
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** `base64url(claims).base64url(hmac)` — a JWT without the header nobody reads. */
export function signToken(secret: string, claims: TokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(secret, payload)}`
}

export function issueToken(
  secret: string,
  identityId: string,
  campaignId: string,
  role: Role,
  sessionId?: string,
): string {
  return signToken(secret, {
    identityId,
    campaignId,
    role,
    ...(sessionId === undefined ? {} : { sessionId }),
    exp: Date.now() + TOKEN_TTL_MS,
  })
}

/** Returns the claims only for a token this server signed and that has not expired. */
export function verifyToken(secret: string, token: string | null | undefined): TokenClaims | null {
  const parts = (token ?? '').split('.')
  if (parts.length !== 2) return null
  const [payload, signature] = parts
  if (!payload || !signature || !constantTimeEqual(signature, sign(secret, payload))) return null

  // The signature already proves we wrote this, but the shape is still checked: a token
  // signed by an older build could carry a payload this one cannot read.
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims !== 'object' || claims === null) return null
  const { identityId, campaignId, role, sessionId, exp } = claims as Record<string, unknown>
  if (typeof identityId !== 'string' || typeof campaignId !== 'string') return null
  if (role !== 'dm' && role !== 'player') return null
  if (sessionId !== undefined && typeof sessionId !== 'string') return null
  if (typeof exp !== 'number' || exp <= Date.now()) return null
  return { identityId, campaignId, role, ...(sessionId === undefined ? {} : { sessionId }), exp }
}

const sign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url')

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  // timingSafeEqual throws on a length mismatch, and the length of an HMAC digest is
  // public anyway — only the equal-length comparison has to be constant time.
  return left.length === right.length && timingSafeEqual(left, right)
}

// ─── Admin pass ───────────────────────────────────────────

/**
 * ponytail: sha256, not scrypt/bcrypt. Those exist to make *human* passwords expensive to
 * guess; this pass is 72 bits straight out of the CSPRNG, so a KDF buys nothing an
 * attacker could ever exhaust.
 */
const hashPass = (pass: string): string => createHash('sha256').update(pass).digest('hex')

/** Generates, stores the hash, and returns the plaintext — the only time it exists. */
export function createAdminPass(passes: PassStore): string {
  const pass = randomBytes(9).toString('base64url')
  passes.create(hashPass(pass), null, null)
  return pass
}

/** First run: mint the server admin pass and announce it. Every run after: nothing. */
export function ensureAdminPass(passes: PassStore): void {
  if (passes.hasServerAdmin()) return
  console.log(
    `\n  admin pass (first run): ${createAdminPass(passes)}\n` +
      '  Write it down — only its hash is stored, so it cannot be shown again.\n',
  )
}

/** True only for the server admin pass (campaign_id null, D6), and only while it is valid. */
export function isAdminPass(passes: PassStore, presented: string | null | undefined): boolean {
  if (!presented) return false
  return passes.findValidByHash(hashPass(presented))?.campaign_id === null
}

// ─── Invite codes ─────────────────────────────────────────

/** No 0/O/1/I/L: these get read aloud across a table and typed back in by hand. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const INVITE_CODE_LENGTH = 6

export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/**
 * The whole of "RoomManager" (D6): a code names the one active session that owns it.
 * Ended sessions keep their code row but stop resolving, so a stale link 404s.
 */
export function resolveInviteCode(sessions: SessionStore, code: string): SessionRow | undefined {
  return sessions.getByInviteCode(code.trim().toUpperCase())
}

/**
 * Starts a session under a fresh code. `invite_code` is UNIQUE across every session ever
 * created, so a collision is possible (~1 in 887M) and retried rather than 500'd — the
 * failed INSERT rolls back its transaction, leaving the previous session untouched.
 */
export function startSession(sessions: SessionStore, campaignId: string): SessionRow {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return sessions.createSession(campaignId, generateInviteCode())
    } catch (error) {
      if ((error as { code?: string }).code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error
    }
  }
  throw new Error('could not allocate an unused invite code')
}
