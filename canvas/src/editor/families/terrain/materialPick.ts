// What the brush's Material tiles show as picked and what a click on one does: with a brush cave
// or a rock-rimmed piece picked, the Material entry shows and changes its rock too.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import type { BrushKind, MapBuilderStore } from '@/store/types';
import { editChildren } from '@/editor/families/design/cardWrites';
import { brushMaterial } from '@dnd/core/src/assets/materialKit';
import { isBandSet } from '@dnd/core/src/assets/packCatalog';

/** The picked pieces with rock of their own (a brush cave, a brush ground piece's rim), by id. */
export function pickedRockIds(s: MapBuilderStore): string[] {
  const out: string[] = [];
  for (const id of s.selection.selectedIds) {
    const c = selectLayerForChild(s, id)?.children.find((x) => x.id === id);
    if (c?.childType === 'shape' && c.edgeMaterial) out.push(id);
  }
  return out;
}

/** The tile shown as picked: with rock pieces picked, under the Material entry, the first one's rock. */
export function shownMaterial(s: MapBuilderStore, kind: BrushKind): string {
  if (kind === 'material') {
    const [first] = pickedRockIds(s);
    const c = first ? selectLayerForChild(s, first)?.children.find((x) => x.id === first) : undefined;
    if (c?.childType === 'shape' && c.edgeMaterial) return c.edgeMaterial;
  }
  return brushMaterial(s.tools.settings.material, kind);
}

/**
 * A tile clicked: the next stroke of that entry paints with it, and under the Material entry a
 * cave or cliff kit also becomes the rock of every picked piece that has rock, in one undo step.
 */
export function pickMaterial(kind: BrushKind, material: string): void {
  useStore.setState((s) => {
    if (kind === 'terrain') s.tools.settings.material.groundMaterial = material;
    else if (kind === 'water') s.tools.settings.material.waterMaterial = material;
    else s.tools.settings.material.material = material;
  });
  if (kind !== 'material' || !isBandSet(material)) return;
  const ids = pickedRockIds(useStore.getState() as MapBuilderStore);
  editChildren('Rock', ids, (c) => (c.childType === 'shape' && c.edgeMaterial ? { edgeMaterial: material } : null));
}
