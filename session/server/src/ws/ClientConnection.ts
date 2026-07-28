// One connected socket: identity, the raw write, validated receive.
// Nothing above this file touches the raw `ws` socket.

import { WebSocket, type RawData } from 'ws'
import type { ClientMessage, Role } from '@dnd/core/src/shared/protocol'

/** Who is on the other end. In S1 this comes from the upgrade stub; A4 signs it. */
export interface Identity {
  identityId: string
  name: string
  role: Role
  sessionId: string
  campaignId: string
}

export class ClientConnection {
  /** Reset by every pong; SessionManager's heartbeat drops the socket at the limit. */
  missedPongs = 0

  constructor(
    private readonly socket: WebSocket,
    readonly identity: Identity,
  ) {
    socket.on('pong', () => {
      this.missedPongs = 0
    })
    // `ws` reports a protocol violation — a frame over `maxPayload`, a bad opcode — by
    // closing the socket and *then* emitting 'error'. An 'error' with no listener is one
    // Node throws, so without this line a single oversized frame is not a dropped client
    // but a dead server. `ws` has already started the close; there is nothing left to do.
    socket.on('error', () => {})
  }

  /**
   * The raw write. Takes a serialized frame, not a ServerMessage, so it cannot be used
   * without having gone through redaction first: Broadcaster is its only caller (D5).
   */
  deliver(payload: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(payload)
  }

  /**
   * Well-formed frames go to `handler`, garbage to `onInvalid` with a reason — this file
   * answers neither, because every outbound frame leaves through the Broadcaster (D5).
   */
  onMessage(handler: (msg: ClientMessage) => void, onInvalid: (reason: string) => void): void {
    this.socket.on('message', (raw: RawData) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        onInvalid('malformed JSON')
        return
      }
      const msg = asClientMessage(parsed)
      if (!msg) {
        onInvalid('unrecognized message')
        return
      }
      handler(msg)
    })
  }

  onClose(handler: () => void): void {
    this.socket.on('close', handler)
  }

  /** Counts as unanswered until a pong arrives. */
  ping(): void {
    this.missedPongs++
    this.socket.ping()
  }

  close(): void {
    this.socket.close()
  }

  terminate(): void {
    this.socket.terminate()
  }
}

/** Wire input is untrusted: every field a handler reads is checked here. */
function asClientMessage(value: unknown): ClientMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const msg = value as Record<string, unknown>
  switch (msg.type) {
    case 'join':
      return typeof msg.protocolVersion === 'number' ? (msg as unknown as ClientMessage) : null
    case 'command':
      return typeof msg.module === 'string' &&
        typeof msg.action === 'string' &&
        typeof msg.seq === 'number'
        ? (msg as unknown as ClientMessage)
        : null
    case 'ping':
      return typeof msg.t === 'number' ? (msg as unknown as ClientMessage) : null
    default:
      return null
  }
}
