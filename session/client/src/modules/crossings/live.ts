// The crossing rules as this seat holds them right now: the loaded map's raised edges and
// kinds (the core store) with the DM's live overrides (the crossings module slice), for the
// active scene and this seat's role. One function the drag calls per hop.

import { useStore } from '@dnd/core/src/store/store';
import { sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings';
import { useSessionStore } from '../../session/store';
import { judgeHop, type HopVerdict } from './crossings';

export function judgeDragHop(
  levelId: string | undefined,
  from: readonly [number, number],
  to: readonly [number, number],
  elevation?: number,
): HopVerdict {
  const map = useStore.getState();
  const session = useSessionStore.getState();
  const live = sceneCrossings(
    session.session?.modules.crossings as CrossingsState | undefined,
    session.session?.activeSceneId ?? null,
  );
  return judgeHop(map, levelId, from, to, live, session.you?.role, elevation);
}
