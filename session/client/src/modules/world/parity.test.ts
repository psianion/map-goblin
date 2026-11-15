// The parity test between the Table's sky and the Editor's own preview, off one core function.
//
// The Table resolves its sky through `worldSkyOf` (packages/mechanics/src/triggers/types.ts,
// the call `worldSync.ts` and the referee both make). The Editor never builds a frame itself
// either: every frame its render loop draws goes through `worldFrame`
// (packages/core/src/engine/worldOverride.ts), which returns the installed table frame when one
// exists, else composes its own off the map at the preview time. Both end in `skyFrame`, so for
// every place and every time of day the two must give the same frame.

import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS, type Environment, type MapEnvironment } from '@dnd/core/src/shared/world';
import { TIMES, type TimeOfDay } from '@dnd/core/src/shared/prep';
import { worldFrame } from '@dnd/core/src/engine/worldOverride';
import { worldSkyOf, type TriggersState } from '@dnd/mechanics/triggers';

/** The matrix cell: a map authored this way. `naturalLight: true` so the sun vector is ever
 *  non-zero to compare — without it nothing casts on either side and `.sun` trivially matches. */
const mapAt = (environment: Environment): MapEnvironment => ({ environment, naturalLight: true });

/** The Table's own sky for a scene with no darkness slider set (Auto). */
function tableSky(map: MapEnvironment, time: TimeOfDay) {
  const state: TriggersState = {
    byScene: { s1: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, prompts: [], log: [] } },
    world: { time },
  };
  return worldSkyOf(state, map, 's1');
}

describe('the Table and the Editor draw the same sky for each time of day', () => {
  for (const environment of ENVIRONMENTS) {
    for (const time of TIMES) {
      it(`${environment}/${time}`, () => {
        const map = mapAt(environment);
        expect(worldFrame(map, time)).toEqual(tableSky(map, time));
      });
    }
  }
});
