/**
 * §2.4.4 / D7 — the Beyond20 bridge. Beyond20 renders a roll on D&D Beyond and dispatches
 * it into whatever page is listening; we translate that into a `rolls:post` command and
 * send it. No dice are rolled here and none are checked: everything below is display data,
 * length-capped on the way out and capped again by the server, which trusts none of it.
 *
 * Attribution is the tab's own identity (D7) — the character name only rides along as a
 * label, so nothing here needs to know who you are.
 *
 * Shapes verified against Beyond20 source, not just the published API doc — see
 * docs/beyond20-vtt-capabilities.md for the full reference and the two divergences below.
 */

import type { InitiativeState } from '@dnd/mechanics/initiative'
import type { RollPost } from '@dnd/mechanics/rolls'
import { captureFromRoll } from '../../session/initiativeView'
import { useSessionStore } from '../../session/store'

/** Mirrors the server's caps (§2.2) so an overlong roll is trimmed, not rejected. */
const CAPS = {
  characterName: 60,
  title: 100,
  formula: 100,
  breakdown: 200,
  text: 200,
  description: 2000,
} as const

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** `total_damages` values are Roll JSON objects; `damage_rolls[n][1]` can be either a Roll
 *  object, a plain message string, or (defensively) a bare number — this reads a display
 *  total whichever shape shows up (§4/§5). */
const rollTotal = (value: unknown): string | undefined => {
  const asString = cap(value, 40)
  if (asString !== undefined) return asString
  const asNumber = num(value)
  if (asNumber !== undefined) return String(asNumber)
  const total = num(obj(value).total)
  return total !== undefined ? String(total) : undefined
}

/** advantage on the wire (§9): only these four values mark the roll, the rest add nothing. */
const ADVANTAGE_MARKERS: Record<number, string> = {
  3: ' (adv)',
  4: ' (dis)',
  6: ' (super adv)',
  7: ' (super dis)',
}

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
  const critMarker =
    kept?.['critical-success'] === true
      ? 'nat 20!'
      : kept?.['critical-failure'] === true
        ? 'nat 1'
        : undefined
  const damageFromTotals = Object.entries(obj(req.total_damages))
    .map(([label, total]) => [cap(label, 40), rollTotal(total)] as const)
    .filter(([, total]) => total)
    .map(([label, total]) => (label ? `${label} ${total}` : total))
    .join(', ')
  // total_damages only appears for ≥2 damages of a kind (§4) — a single damage roll (or a
  // `total_damages`-less display type) falls back to summarizing `damage_rolls` itself.
  const damageFromRolls = arr(req.damage_rolls)
    .map((entry) => arr(entry))
    .map(([label, roll]) => [cap(label, 40), rollTotal(roll)] as const)
    .filter(([, total]) => total)
    .map(([label, total]) => (label ? `${label} ${total}` : total))
    .join(', ')
  const damage = damageFromTotals || damageFromRolls || undefined
  const rollInfo =
    arr(req.roll_info)
      .map((pair) => arr(pair))
      .filter(([name, value]) => typeof name === 'string' && typeof value === 'string')
      .map(([name, value]) => `${name}: ${value}`)
      .join(', ') || undefined

  // Hide-names (whisper 3): `title` and the top-level `character` string are already the
  // censored replacement — but `hidden-monster-replacement` is free text and can be set to
  // "", which `cap()` treats as absent. Falling through to `request.name` / the
  // `request.character` object below would then publish the real name — those are never
  // censored (§6/§13). So when hidden, the top-level strings are the only source, empty
  // replacement included.
  const hideNames = req.whisper === 3
  const title =
    cap(req.title, CAPS.title) ?? (hideNames ? undefined : cap(obj(req.request).name, CAPS.title))
  const advantage = num(obj(req.request).advantage)
  const advantageMarker = advantage !== undefined ? (ADVANTAGE_MARKERS[advantage] ?? '') : ''
  const pickedFormula = cap(kept?.formula, CAPS.formula) ?? cap(damageRoll.formula, CAPS.formula)
  const formula = pickedFormula ? cap(pickedFormula + advantageMarker, CAPS.formula) : undefined
  // RollType DOUBLE (1) and THRICE (5) roll every d20 for real — 2 or 3 entries, none
  // `discarded` — so there is no single roll to call "the" total; `breakdown` already lists
  // every value via `dice` above.
  const noSingleTotal = rolls.length > 1 && rolls.every((r) => r.discarded !== true)
  const total = noSingleTotal ? undefined : (num(kept?.total) ?? num(damageRoll.total))
  // §13: `character` is a string on the wire (the name, pre-censored for hide-names), not
  // the object api.md documents — but accept the object shape too, and the raw request's
  // object as a last resort for a synthetic/malformed detail that skipped the string.
  const characterName = hideNames
    ? cap(req.character, CAPS.characterName)
    : (cap(req.character, CAPS.characterName) ??
      cap(obj(req.character).name, CAPS.characterName) ??
      cap(obj(obj(req.request).character).name, CAPS.characterName))
  // Item/spell/trait card text (§4) — source line, then attributes, then the description
  // itself. Beyond20 already nulls `description` on a hide-names whisper.
  const attributeLines = Object.entries(obj(req.attributes))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => `${key}: ${value}`)
  const description = [
    typeof req.source === 'string' && req.source ? req.source : undefined,
    ...attributeLines,
    typeof req.description === 'string' && req.description ? req.description : undefined,
  ].filter((part): part is string => Boolean(part))
  const descriptionText = description.length
    ? cap(description.join('\n'), CAPS.description)
    : undefined
  // Chat-message rolls (and the notes-to-vtt [[before]]/[[after]] blocks they carry, §4) put
  // their text in `request.message`, not `title` or a damage/attack roll.
  const text = cap(obj(req.request).message, CAPS.text)

  // Nothing displayable — an hp-update, a settings message, or malformed detail.
  if (!title && !formula && total === undefined && !text && !descriptionText) return null

  return {
    source: 'dndbeyond',
    characterName,
    title,
    formula,
    breakdown: cap([dice, critMarker, damage, rollInfo].filter(Boolean).join(' · '), CAPS.breakdown),
    description: descriptionText,
    total,
    text,
    // WhisperType: 0 no · 1 whisper · 2 query · 3 public-but-names-hidden. Only 1 is secret.
    visibility: req.whisper === 1 ? 'private' : 'public',
  }
}

const onRenderedRoll = (event: Event) => {
  const post = translateRenderedRoll((event as CustomEvent).detail)
  if (!post) return
  const store = useSessionStore.getState()
  store.sendCommand('rolls', 'post', post)
  // Auto-track: Beyond20 already titles the roll "Initiative", so a party rolling on D&D
  // Beyond fills the tracker without touching the table at all. Capture belongs at the
  // sender, not in the initiative module — and the rule for what counts is that module's.
  const set = captureFromRoll(
    store.session?.modules?.initiative as InitiativeState | undefined,
    store.you?.identityId,
    post,
  )
  if (set) store.sendCommand('initiative', 'set', set)
}

// Beyond20 dispatches a *non-bubbling* CustomEvent on `document`, so a default window
// listener would never see it — the capture phase runs regardless of `bubbles`, and still
// catches an event dispatched at `window` itself (e2e's synthetic roll). Module scope, so
// it is live for the tab's whole lifetime: rolls that arrive between renders still land.
window.addEventListener('Beyond20_RenderedRoll', onRenderedRoll, true)

// ponytail: no dedup — and do NOT dedup by dropping `rendered === 'fallback'`: on custom
// domains "fallback" is the ONLY render Beyond20 ever delivers (GenericDisplayer.postHTML
// hardcodes it), and Beyond20 already de-dupes upstream (forwardMessageToDOM bounces the
// fallback 500ms and cancels it when a real render lands). If the DDB gate ever shows
// doubled lines, dedup by request id/timestamp window instead.

// `Beyond20_UpdateHP` detail = `[request, name, hp, maxHp, tempHp]` (§2/§7). Whispered
// because it fires for monster stat blocks the DM has open too, same as a party member's —
// there is no per-token HP display yet to gate a public line on, so every HP line is a
// whisper (sender + DM) until that exists.
const onUpdateHP = (event: Event) => {
  const detail = arr((event as CustomEvent).detail)
  const name = cap(detail[1], CAPS.characterName)
  const hp = num(detail[2])
  if (!name || hp === undefined) return
  const maxHp = num(detail[3])
  const tempHp = num(detail[4])
  const text = `HP ${hp}${maxHp !== undefined ? `/${maxHp}` : ''}${
    tempHp !== undefined && tempHp > 0 ? ` (+${tempHp} temp)` : ''
  }`
  useSessionStore.getState().sendCommand('rolls', 'post', {
    source: 'dndbeyond',
    characterName: name,
    text: cap(text, CAPS.text),
    visibility: 'private',
  })
}
window.addEventListener('Beyond20_UpdateHP', onUpdateHP, true)

// `Beyond20_UpdateConditions` detail = `[request, name, conditions, exhaustion]` (§2/§7).
const onUpdateConditions = (event: Event) => {
  const detail = arr((event as CustomEvent).detail)
  const name = cap(detail[1], CAPS.characterName)
  if (!name) return
  const conditions = arr(detail[2]).filter((c): c is string => typeof c === 'string' && c !== '')
  const exhaustion = num(detail[3]) ?? 0
  // ponytail: this fires on every sheet load, so a cleared-to-none update (no conditions,
  // no exhaustion) is dropped rather than posting a "none" line nobody asked for. Remove
  // this guard if a "conditions cleared" line ever becomes worth showing.
  if (conditions.length === 0 && exhaustion === 0) return
  const text = `Conditions: ${conditions.join(', ') || 'none'}${
    exhaustion > 0 ? ` · exhaustion ${exhaustion}` : ''
  }`
  useSessionStore.getState().sendCommand('rolls', 'post', {
    source: 'dndbeyond',
    characterName: name,
    text: cap(text, CAPS.text),
    visibility: 'private',
  })
}
window.addEventListener('Beyond20_UpdateConditions', onUpdateConditions, true)
