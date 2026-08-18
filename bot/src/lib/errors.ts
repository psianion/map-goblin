// One error type with a code and a user-facing message. Command bodies throw; the router
// is the only place that catches (interaction-router.ts) and the only place that maps.
//
// ponytail: one class + factories, not five subclasses — nothing dispatches on the type.

export type BotErrorCode = 'not_authorized' | 'wrong_channel' | 'not_found' | 'user_input' | 'internal'

export class BotError extends Error {
  constructor(
    readonly code: BotErrorCode,
    /** Shown verbatim to the user. Must never contain internals or secrets. */
    readonly userMessage: string,
  ) {
    super(`${code}: ${userMessage}`)
    this.name = 'BotError'
  }
}

export const notAuthorized = (msg = "You can't use that one.") => new BotError('not_authorized', msg)
export const wrongChannel = (msg = "That command doesn't work in this channel.") =>
  new BotError('wrong_channel', msg)
export const notFound = (msg = "I couldn't find that.") => new BotError('not_found', msg)
export const userInput = (msg: string) => new BotError('user_input', msg)
export const internal = (msg = 'Something went wrong on my end. It has been logged.') =>
  new BotError('internal', msg)

/** The single error → reply mapping. Unknown errors never leak their message to the user. */
export function toUserReply(err: unknown): string {
  return err instanceof BotError ? err.userMessage : internal().userMessage
}
