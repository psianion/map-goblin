// Proof module (§2.5): closes the client → router → registry → broadcast loop
// end-to-end so the plumbing is tested before there is a real module to put in it.

import { ANY_ROLE, type GameModule } from './registry'

export const pingModule: GameModule = {
  name: 'ping',
  commands: { echo: ANY_ROLE },
  initialState: {},
  handler(_action, payload, ctx) {
    const { t } = (payload ?? {}) as { t?: unknown }
    if (typeof t !== 'number') {
      return { code: 'invalid-command', message: 'ping.echo needs a numeric t' }
    }
    ctx.broadcast({
      type: 'state-update',
      module: 'ping',
      state: { lastEcho: { t, from: ctx.sender.identityId } },
    })
  },
}
