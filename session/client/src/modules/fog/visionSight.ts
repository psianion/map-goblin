// The lights the fog's torch glow is drawn from. The party's sight is the referee's business
// alone now: it sweeps, and the seat draws the cleared record it is sent.

import type { LightChild } from '@dnd/core/src/shared/types';
import type { DungeonLayer, Layer } from '@dnd/core/src/store/types';
import type { PlacedLight } from '@dnd/mechanics/fog';
import { isTokenLight } from '../triggers/lightSync';

/**
 * Every authored light this tab holds, for the shared light rule.
 *
 * Off core's layers, the same light children `LightManager` renders from, so the glow the cloud
 * takes and the pool the map shows cannot be two different circles.
 *
 * *Placed* is the operative word: `lightSync` also writes a pseudo-light child per carried torch
 * onto these same layers so the renderer draws its pool, and the token behind it is already a
 * source in its own right (`lightSources`). Reading both would count one torch twice.
 */
export const placedLights = (layers: readonly Layer[]): PlacedLight[] =>
  layers
    .filter((layer): layer is DungeonLayer => layer.type === 'dungeon')
    .flatMap((layer) =>
      layer.children
        .filter((child): child is LightChild => child.childType === 'light' && !isTokenLight(child.id))
        .map((light) => ({
          id: light.id,
          x: light.position.x,
          y: light.position.y,
          radius: light.radius,
          visible: light.visible,
          ...(light.cone ? { cone: light.cone } : {}),
          ...(light.throughWalls ? { throughWalls: true } : {}),
          ...(light.nightOnly ? { nightOnly: light.nightOnly } : {}),
          ...(light.darkness ? { darkness: true } : {}),
          ...(light.darkvisionSees ? { darkvisionSees: true } : {}),
        })),
    );
