import { useEffect } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';
import { mountDoorLayerWhenReady } from '../modules/doors/DoorRenderer';
import { mountTurnRingWhenReady } from '../modules/initiative/TurnRing';
import { mountOverheadLayerWhenReady } from '../modules/tokens/OverheadLayer';
import { mountTokenLayerWhenReady } from '../modules/tokens/TokenRenderer';
import { mountMarkInputWhenReady } from './marks/markInput';

/**
 * The map-side layers every seat draws whatever is open: tokens and the props over them, the
 * doors, whose turn it is, and the rail's mark tools. The DM's own overlays (fog editing,
 * light icons, the crossing picker) mount from their dock tabs' `onMap`.
 */
export function useMapLayers(role: Role | undefined): void {
  useEffect(() => {
    if (!role) return;
    const downs = [
      mountTokenLayerWhenReady(),
      mountOverheadLayerWhenReady(),
      mountDoorLayerWhenReady(),
      mountTurnRingWhenReady(),
      mountMarkInputWhenReady(),
    ];
    return () => downs.forEach((down) => down());
  }, [role]);
}
