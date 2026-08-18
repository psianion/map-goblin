// JSON lines to stdout, with redaction sitting *below* every sink: a secret cannot reach
// stdout, and cannot reach the Discord log channel either, because channel-log subscribes
// to the already-redacted event.

export type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
  ts: number
  level: Level
  msg: string
  data?: Record<string, unknown>
}

const SECRET_KEY = /TOKEN|SECRET|PASS|AUTH|KEY/i

/** Replaces the value of any secret-looking key, at any depth, with '[redacted]'. */
export function redact<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]' as T
  seen.add(value)
  if (Array.isArray(value)) return value.map((v) => redact(v, seen)) as T
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, seen)
  }
  return out as T
}

type Subscriber = (event: LogEvent) => void
const subscribers = new Set<Subscriber>()

/** Mirrors every emitted (already redacted) event. Returns an unsubscribe. */
export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

function emit(level: Level, msg: string, data?: Record<string, unknown>): void {
  const event: LogEvent = { ts: Date.now(), level, msg, ...(data ? { data: redact(data) } : {}) }
  process.stdout.write(`${JSON.stringify(event)}\n`)
  for (const fn of subscribers) fn(event)
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
}
