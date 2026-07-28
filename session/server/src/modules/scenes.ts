// D6 — scene switching is a module, not a new message path. `activeSceneId` already lives
// in SessionState and `scene-changed` already exists on the wire; all that was missing was
// something allowed to move it. No module state of its own: the active scene is a column
// on `sessions`, which is what makes it survive a restart for free.

import type { GameModule } from '@dnd/mechanics/contract'
import type { Stores } from '../db/stores'

export function scenesModule(stores: Stores): GameModule {
  return {
    name: 'scenes',
    commands: { activate: ['dm'] },
    initialState: {},
    handler(_action, payload, ctx) {
      const { sceneId } = (payload ?? {}) as { sceneId?: unknown }
      if (typeof sceneId !== 'string') {
        return { code: 'invalid-command', message: 'scenes.activate needs a sceneId' }
      }
      // A scene id is a map id in this campaign — anything else is either a typo or a
      // client trying to point the table at somebody else's map.
      if (!stores.maps.listByCampaign(ctx.campaignId).some((map) => map.id === sceneId)) {
        return { code: 'invalid-command', message: `no scene '${sceneId}' in this campaign` }
      }
      stores.sessions.setActiveScene(ctx.sessionId, sceneId)
      ctx.broadcast({ type: 'scene-changed', sceneId })
    },
  }
}
