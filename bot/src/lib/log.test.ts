import { describe, expect, it, vi } from 'vitest'
import { log, redact, subscribe, type LogEvent } from './log'

describe('redact', () => {
  it('replaces secret-looking keys at any depth', () => {
    const out = redact({
      DISCORD_BOT_TOKEN: 'abc',
      nested: { goblinAdminPass: 'hunter2', apiKey: 'k', safe: 'ok' },
      list: [{ authorization: 'Bearer x' }],
    })
    expect(out).toEqual({
      DISCORD_BOT_TOKEN: '[redacted]',
      nested: { goblinAdminPass: '[redacted]', apiKey: '[redacted]', safe: 'ok' },
      list: [{ authorization: '[redacted]' }],
    })
  })

  it('leaves non-objects alone and survives cycles', () => {
    expect(redact('plain')).toBe('plain')
    const cyclic: Record<string, unknown> = { name: 'x' }
    cyclic.self = cyclic
    expect(redact(cyclic)).toEqual({ name: 'x', self: '[circular]' })
  })
})

describe('log', () => {
  it('emits redacted events to subscribers', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const seen: LogEvent[] = []
    const off = subscribe((e) => seen.push(e))
    log.warn('boom', { token: 'secret-value', ok: 1 })
    off()
    write.mockRestore()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ level: 'warn', msg: 'boom', data: { token: '[redacted]', ok: 1 } })
  })
})
