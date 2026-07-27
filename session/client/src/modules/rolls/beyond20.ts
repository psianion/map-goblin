/**
 * §2.4.4 / D7 — the Beyond20 bridge. Beyond20 renders a roll on D&D Beyond and dispatches
 * it into whatever page is listening; we translate that into a `rolls:post` command and
 * send it. No dice are rolled here and none are checked: everything below is display data,
 * length-capped on the way out and capped again by the server, which trusts none of it.
 *
 * Attribution is the tab's own identity (D7) — the character name only rides along as a
 * label, so nothing here needs to know who you are.
 */

import type { RollPost } from '@dnd/mechanics/rolls'
import { useSessionStore } from '../../session/store'

/** Mirrors the server's caps (§2.2) so an overlong roll is trimmed, not rejected. */
const CAPS = { characterName: 60, title: 100, formula: 100, breakdown: 200 } as const

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * `detail` is the `[request]` array Beyond20 puts on the event (a bare request is accepted
 * too, in case that ever changes). Returns `null` for anything that carries no roll —
 * other Beyond20 messages on the same bus, or junk. Unknown fields are ignored by design:
 * the extension's payload grows, and a roll that arrives title-less still lands.
 */
export function translateRenderedRoll(detail: unknown): RollPost | null {
  const req = obj(Array.isArray(detail) ? detail[0] : detail)

  // Advantage/disadvantage sends both d20s with the loser flagged `discarded` — taking the
  // kept one is the difference between "27" and "12" on the table.
  const rolls = arr(req.attack_rolls).map(obj)
  const kept =
    rolls.find((r) => r.discarded !== true && num(r.total) !== undefined) ??
    rolls.find((r) => num(r.total) !== undefined)
  // `damage_rolls` entries are `[type, Roll, flags]`; damage-only rolls have no attack roll.
  const damageRoll = obj(arr(arr(req.damage_rolls)[0])[1])

  const dice =
    rolls.length > 1
      ? rolls
          .map((r) => `${num(r.total) ?? '?'}${r.discarded === true ? ' ✗' : ''}`)
          .join(' / ')
      : undefined
  const damage = Object.entries(obj(req.total_damages))
    .map(([label, total]) => [cap(label, 40), cap(total, 40)])
    .filter(([, total]) => total)
    .map(([label, total]) => (label ? `${label} ${total}` : total))
    .join(', ')

  const title = cap(req.title, CAPS.title) ?? cap(obj(req.request).name, CAPS.title)
  const formula = cap(kept?.formula, CAPS.formula) ?? cap(damageRoll.formula, CAPS.formula)
  const total = num(kept?.total) ?? num(damageRoll.total)

  // Nothing displayable — an hp-update, a settings message, or malformed detail.
  if (!title && !formula && total === undefined) return null

  return {
    source: 'dndbeyond',
    characterName: cap(obj(req.character).name, CAPS.characterName),
    title,
    formula,
    breakdown: cap([dice, damage].filter(Boolean).join(' · '), CAPS.breakdown),
    total,
    // WhisperType: 0 no · 1 whisper · 2 query · 3 public-but-names-hidden. Only 1 is secret.
    visibility: req.whisper === 1 ? 'private' : 'public',
  }
}

const onRenderedRoll = (event: Event) => {
  const post = translateRenderedRoll((event as CustomEvent).detail)
  if (post) useSessionStore.getState().sendCommand('rolls', 'post', post)
}

// Beyond20 dispatches a *non-bubbling* CustomEvent on `document`, so a default window
// listener would never see it — the capture phase runs regardless of `bubbles`, and still
// catches an event dispatched at `window` itself (e2e's synthetic roll). Module scope, so
// it is live for the tab's whole lifetime: rolls that arrive between renders still land.
window.addEventListener('Beyond20_RenderedRoll', onRenderedRoll, true)

// ponytail: no dedup. Beyond20 can pre-render a "fallback" copy of a roll (`rendered:
// 'fallback'`) alongside the digital-dice result; if the DDB gate shows doubled lines,
// drop events whose `rendered === 'fallback'` — one condition, in `onRenderedRoll`.
