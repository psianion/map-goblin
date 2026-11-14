// An older map's brush paint, converted where the renderer can do it: the pack catalog is
// at hand here to name a band set's fill and the water texture, and Clipper to trace the
// water mask. The load migration has already converted the patches that need neither
// (shared/legacyPaint.ts); this takes what it had to leave, the first time the layer is
// drawn with what it needs, and writes the layer back. Not an undo step: the map reads the
// same before and after, like the other shims at the read boundary.

import type { DungeonLayer } from '../store/types';
import { useStore } from '../store/store';
import { isClipperReady } from '../geometry/Clipper2Engine';
import { defaultWaterId, materialFillId, pieceNameOf } from '../assets/materialKit';
import { patchesToPieces, waterToPieces } from '../shared/legacyPaint';
import { wallPatchesToFloors } from '../shared/caveFloor';
import { assetsBooted, onAssetsBooted } from './boot';

/** Layers left with paint to convert before the catalog was in: each is baked again when the asset boot ends. */
const waitingForBoot = new Set<string>();

/** `layer` with its patches and water mask as pieces, written to the store; `layer` itself when it has none or none can convert yet. */
export function healLegacyPaint(layer: DungeonLayer): DungeonLayer {
  if (!layer.materials?.length && !layer.water) return layer;
  // In the load's order: a 3.10 cave patch becomes floors first, then the other patches go
  // round them. Before the asset boot the catalog names nothing, so the layer's patches
  // wait together and land in one pass, in the order they were painted.
  let next = patchesToPieces(wallPatchesToFloors([layer], materialFillId), {
    fillOf: materialFillId,
    nameOf: pieceNameOf,
    whole: !assetsBooted(),
  })[0];
  const waterId = next.water && isClipperReady() ? defaultWaterId() : undefined;
  if (next.water && waterId) {
    const pieces = waterToPieces(next.water, waterId, next.children);
    // Over every floor and patch, as the mask was drawn.
    const last = next.children.reduce((at, c, i) => (c.childType === 'shape' ? i : at), -1);
    const children = [...next.children];
    children.splice(last + 1, 0, ...pieces);
    next = { ...next, children, water: undefined };
  }
  // Left waiting for the catalog: bake the layer again once the boot has it. Nothing else
  // would, since a layer no edit touches is never rebuilt.
  if ((next.materials?.length || next.water) && !assetsBooted() && !waitingForBoot.has(layer.id)) {
    waitingForBoot.add(layer.id);
    onAssetsBooted(() => {
      waitingForBoot.delete(layer.id);
      useStore.getState().bumpFloorTextureEpoch(layer.id);
    });
  }
  if (next === layer) return layer;
  const { children, materials, water } = next;
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === layer.id);
    if (!l || l.type !== 'dungeon') return;
    l.children = children;
    if (materials) l.materials = materials;
    else delete l.materials;
    if (!water) delete l.water;
  });
  return next;
}
