// What the prop card reads: the picked props and their shared box.

import { useStore } from '@/store/store';
import type { AssetChild, MapBuilderStore } from '@/store/types';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { isMixed, propBoxModel, radToDeg } from '@/editor/models/selectionModel';

export interface BoxValue {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, 0 to 360. */
  angle: number;
}

/** The picked props, in the order they were picked. */
export function pickedProps(s: MapBuilderStore = useStore.getState()): AssetChild[] {
  return resolveSelection(s, s.selection.selectedIds)
    .children.map(({ child }) => child)
    .filter((c): c is AssetChild => c.childType === 'asset');
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One prop's own box, or the box round several: centre, size in cells, angle. */
export function boxOf(props: readonly AssetChild[]): BoxValue {
  if (props.length === 0) return { x: 0, y: 0, w: 0, h: 0, angle: 0 };
  const b = propBoxModel(props);
  return { x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), angle: isMixed(b.angle) ? 0 : Math.round(radToDeg(b.angle)) };
}
