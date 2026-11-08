import { describe, expect, it } from 'vitest'
import { reaches } from './Broadcaster'
import { DRAW_TTL_MAX_MS, MARK_TTL_MS, markEvent, parseMark } from './marks'

describe('parseMark', () => {
  it('rebuilds a ping and drops unknown fields', () => {
    expect(parseMark({ kind: 'ping', x: 1, y: 2, extra: 'x' }, 'player')).toEqual({
      mark: { kind: 'ping', x: 1, y: 2 },
      ttlMs: MARK_TTL_MS.ping,
    })
  })

  it('keeps pull, templates and drawing for the DM', () => {
    expect(parseMark({ kind: 'ping', x: 1, y: 2, pull: true }, 'player')).toEqual({ error: 'only the DM may pull cameras' })
    expect(parseMark({ kind: 'ping', x: 1, y: 2, pull: true }, 'dm')).toMatchObject({ mark: { pull: true } })
    expect(parseMark({ kind: 'template', shape: 'circle', origin: { x: 0, y: 0 }, size: 4 }, 'player')).toHaveProperty('error')
    expect(parseMark({ kind: 'template', shape: 'circle', origin: { x: 0, y: 0 }, size: 4 }, 'dm')).toMatchObject({
      mark: { kind: 'template', shape: 'circle', size: 4 },
    })
    expect(parseMark({ kind: 'draw', points: [[0, 0], [1, 1]] }, 'player')).toHaveProperty('error')
  })

  it('a ruler is anyone’s', () => {
    expect(parseMark({ kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }, 'player')).toMatchObject({ ttlMs: MARK_TTL_MS.ruler })
  })

  it('refuses bad points, shapes, sizes and kinds', () => {
    expect(parseMark({ kind: 'ping', x: 'a', y: 2 }, 'dm')).toHaveProperty('error')
    expect(parseMark({ kind: 'ping', x: 1e9, y: 2 }, 'dm')).toHaveProperty('error')
    expect(parseMark({ kind: 'template', shape: 'star', origin: { x: 0, y: 0 }, size: 4 }, 'dm')).toHaveProperty('error')
    expect(parseMark({ kind: 'template', shape: 'cone', origin: { x: 0, y: 0 }, size: -1 }, 'dm')).toHaveProperty('error')
    expect(parseMark({ kind: 'draw', points: [[0, 0]] }, 'dm')).toHaveProperty('error')
    expect(parseMark({ kind: 'laser' }, 'dm')).toHaveProperty('error')
    expect(parseMark(null, 'dm')).toHaveProperty('error')
  })

  it('clamps a drawing’s lifetime', () => {
    const out = parseMark({ kind: 'draw', points: [[0, 0], [1, 1]], ttl: 10_000_000 }, 'dm')
    expect(out).toMatchObject({ ttlMs: DRAW_TTL_MAX_MS })
  })

  it('markEvent stamps who, when and where', () => {
    const event = markEvent({ kind: 'ping', x: 0, y: 0 }, 4000, 'p-1', 'scene-1')
    expect(event).toMatchObject({ from: 'p-1', sceneId: 'scene-1', ttlMs: 4000 })
    expect(typeof event.id).toBe('string')
  })
})

describe('reaches', () => {
  const dm = { role: 'dm' as const, identityId: 'dm' }
  const alice = { role: 'player' as const, identityId: 'alice' }
  const bob = { role: 'player' as const, identityId: 'bob' }

  it('a roll request nudge reaches the DM and the players it names', () => {
    const msg = { type: 'roll-requested' as const, request: { requestId: 'q', label: 'Save', targets: ['alice'] } }
    expect(reaches(msg, dm)).toBe(true)
    expect(reaches(msg, alice)).toBe(true)
    expect(reaches(msg, bob)).toBe(false)
    expect(reaches({ ...msg, request: { ...msg.request, targets: null } }, bob)).toBe(true)
  })

  it('effects-ended reaches DM seats only; other frames reach everyone', () => {
    const ended = { type: 'effects-ended' as const, sceneId: 's', ended: [] }
    expect(reaches(ended, dm)).toBe(true)
    expect(reaches(ended, alice)).toBe(false)
    expect(reaches({ type: 'pong', t: 1 }, alice)).toBe(true)
  })
})
