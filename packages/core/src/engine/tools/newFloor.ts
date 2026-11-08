// What a newly drawn floor takes from the Floor panel's defaults: its opacity, and an edge
// band when one was picked there (unset, the floor follows its layer's band).

import type { ShapeChild } from '../../store/types';
import { useStore } from '../../store/store';

export function newFloorLook(): Pick<ShapeChild, 'opacity' | 'edgeBand'> {
  const s = useStore.getState().tools.settings;
  const out: Pick<ShapeChild, 'opacity' | 'edgeBand'> = {};
  if (s.floorOpacity !== undefined && s.floorOpacity < 1) out.opacity = s.floorOpacity;
  if (s.floorEdgeBand !== undefined) out.edgeBand = s.floorEdgeBand;
  return out;
}
