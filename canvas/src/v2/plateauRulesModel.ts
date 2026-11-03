import type { Layer } from '@/store/types';
import { crossingIdOf } from '@dnd/core/src/shared/plateaus';

/** Crossing kind ids some edge or opening on the map names: those cannot be deleted. */
export function crossingIdsInUse(layers: readonly Layer[]): Set<string> {
  const used = new Set<string>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      // A plateau's edge or an opening with no kind of its own uses its default, which counts.
      if (c.childType === 'plateau') used.add(crossingIdOf(c));
      else if (c.childType === 'opening') used.add(c.crossingId ?? 'free');
    }
  }
  return used;
}
