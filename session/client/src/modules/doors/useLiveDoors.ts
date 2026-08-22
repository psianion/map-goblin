import { useMemo } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorsState } from '@dnd/mechanics/doors';
import { useModuleState, useSessionStore } from '../../session/store';
import { liveDoors, type LiveDoor } from './doors';

/** Reactive version of `liveSceneDoors` — shared by the panel, its footer, and `DoorMenu` so
 *  none of them repeats the store-reading wiring. */
export function useLiveDoors(): LiveDoor[] {
  const doorsState = useModuleState<DoorsState>('doors');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const layers = useStore((s) => s.layers);
  return useMemo(() => liveDoors(layers, doorsState, sceneId), [layers, doorsState, sceneId]);
}
