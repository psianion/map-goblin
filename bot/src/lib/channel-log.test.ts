import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChannelLog, packLines } from './channel-log'
import type { LogEvent } from './log'

const event = (level: LogEvent['level'], msg: string, data?: Record<string, unknown>): LogEvent => ({
  ts: 0,
  level,
  msg,
  ...(data ? { data } : {}),
})

describe('packLines', () => {
  it('batches up to the cap and truncates an oversized line', () => {
    expect(packLines(['aaa', 'bbb', 'ccc'], 7)).toEqual(['aaa\nbbb', 'ccc'])
    expect(packLines(['x'.repeat(20)], 10)).toEqual([`${'x'.repeat(9)}…`])
  })
})

describe('createChannelLog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('batches audit lines into one message after the debounce', async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => {})
    const log = createChannelLog({ send, debounceMs: 1000 })
    log.audit('✅ /ping by @a — 0.1s')
    log.audit('❌ /ping by @b — 0.2s')
    expect(send).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe('✅ /ping by @a — 0.1s\n❌ /ping by @b — 0.2s')
  })

  it('flushes errors on the short window', async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => {})
    const log = createChannelLog({ send, debounceMs: 5000, errorDebounceMs: 100 })
    log.mirror(event('error', 'boom', { where: 'router' }))
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toContain('🔴 boom')
  })

  it('drops debug and info', async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => {})
    const log = createChannelLog({ send, debounceMs: 100 })
    log.mirror(event('info', 'ready'))
    log.mirror(event('debug', 'noise'))
    await vi.advanceTimersByTimeAsync(500)
    expect(send).not.toHaveBeenCalled()
  })

  it('splits a batch over the char cap into several messages', async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => {})
    const log = createChannelLog({ send, debounceMs: 10, maxChars: 20 })
    log.audit('a'.repeat(15))
    log.audit('b'.repeat(15))
    await vi.advanceTimersByTimeAsync(10)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('never re-logs its own send failure', async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => {
      throw new Error('discord down')
    })
    const log = createChannelLog({ send, debounceMs: 10 })
    log.audit('line')
    await vi.advanceTimersByTimeAsync(10)
    log.audit('another')
    await vi.advanceTimersByTimeAsync(10)
    expect(send).toHaveBeenCalledTimes(2) // one per batch, no failure feedback loop
  })

  it('flush() posts pending lines immediately', async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => {})
    const log = createChannelLog({ send, debounceMs: 60_000 })
    log.audit('pending')
    await log.flush()
    expect(send).toHaveBeenCalledWith('pending')
  })
})
