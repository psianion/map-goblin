// The Discord log channel sink: an audit line per command plus a debounced batched mirror
// of warn/error app logs. `send` is injected, so tests never touch Discord.
//
// Two rules it must not break: it never logs its own send failures (that is the loop that
// takes a bot down), and it flushes before the process dies.

import type { LogEvent } from './log'

export interface ChannelLogOptions {
  /** Posts one message to the log channel. Rejections are swallowed on purpose. */
  send: (text: string) => Promise<void>
  /** Quiet window for warn lines. */
  debounceMs?: number
  /** Shorter window for errors — an error is worth a nearly-immediate post. */
  errorDebounceMs?: number
  /** Message char cap; Discord's is 2000 and the batch needs headroom. */
  maxChars?: number
}

export interface ChannelLog {
  /** `✅ /map by @user — 1.2s` */
  audit: (line: string) => void
  /** Subscribe this to the logger; debug/info are dropped. */
  mirror: (event: LogEvent) => void
  flush: () => Promise<void>
  stop: () => void
}

/** Splits lines into messages no longer than `maxChars`, truncating any single huge line. */
export function packLines(lines: string[], maxChars: number): string[] {
  const messages: string[] = []
  let current = ''
  for (const raw of lines) {
    const line = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw
    if (current && current.length + 1 + line.length > maxChars) {
      messages.push(current)
      current = line
    } else {
      current = current ? `${current}\n${line}` : line
    }
  }
  if (current) messages.push(current)
  return messages
}

export function createChannelLog(options: ChannelLogOptions): ChannelLog {
  const { send, debounceMs = 2000, errorDebounceMs = 250, maxChars = 1900 } = options
  let queue: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> = Promise.resolve()

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    const batch = queue
    queue = []
    if (batch.length === 0) return inFlight
    inFlight = inFlight.then(async () => {
      for (const message of packLines(batch, maxChars)) {
        // Swallowed: a failed log post must never produce another log line to post.
        await send(message).catch(() => {})
      }
    })
    return inFlight
  }

  const schedule = (delay: number): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), delay)
    timer.unref?.()
  }

  const push = (line: string, delay: number): void => {
    queue.push(line)
    schedule(delay)
  }

  return {
    audit: (line) => push(line, debounceMs),
    mirror: (event) => {
      if (event.level !== 'warn' && event.level !== 'error') return
      const icon = event.level === 'error' ? '🔴' : '🟡'
      const data = event.data ? ` ${JSON.stringify(event.data)}` : ''
      push(`${icon} ${event.msg}${data}`, event.level === 'error' ? errorDebounceMs : debounceMs)
    },
    flush,
    stop: () => {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}

/** Last-gasp flush. Called from index.ts — this module stays side-effect free on import. */
export function installExitFlush(channelLog: ChannelLog): void {
  const drain = () => {
    void channelLog.flush().finally(() => process.exit(0))
  }
  process.once('SIGTERM', drain)
  process.once('SIGINT', drain)
  process.once('uncaughtException', drain)
}
