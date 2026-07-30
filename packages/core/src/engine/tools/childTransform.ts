// Applying a gizmo drag to the children it is drawn around.
//
// The gizmo computed a delta and fired callbacks that nothing was ever
// subscribed to, so dragging a handle drew feedback and changed nothing. This
// is the missing half.

import type { AnyChild, ShapeChild } from '../../store/types';
import type { HandleType } from './TransformGizmo';

/** A similarity transform in world units, about a point that stays fixed. */
export interface WorldTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export interface WorldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The point a resize or rotation pivots about: the opposite corner or edge, so
 * the side you are not dragging stays put. Rotation pivots about the centre.
 */
export function anchorForHandle(handle: HandleType, box: WorldBox): { x: number; y: number } {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  if (handle === 'rotate' || handle === 'move') return { x: cx, y: cy };

  const x = handle.includes('w') ? right : handle.includes('e') ? left : cx;
  const y = handle.includes('n') ? bottom : handle.includes('s') ? top : cy;
  return { x, y };
}

function mapPoint(x: number, y: number, t: WorldTransform): [number, number] {
  const px = (x - t.anchorX) * t.scaleX;
  const py = (y - t.anchorY) * t.scaleY;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return [
    t.anchorX + px * cos - py * sin + t.translateX,
    t.anchorY + px * sin + py * cos + t.translateY,
  ];
}

/** Bake a shape's optional transform down into its rings. */
function effectiveContours(shape: ShapeChild): [number, number][][] {
  const t = shape.transform;
  if (!t) return shape.contours.map((ring) => ring.map(([x, y]): [number, number] => [x, y]));
  const cos = Math.cos(t.rotate);
  const sin = Math.sin(t.rotate);
  return shape.contours.map((ring) =>
    ring.map(([px, py]): [number, number] => {
      const sx = px * t.scale[0];
      const sy = py * t.scale[1];
      return [cos * sx - sin * sy + t.translate[0], sin * sx + cos * sy + t.translate[1]];
    }),
  );
}

/**
 * What a child looked like before the drag. Held for the whole gesture and
 * re-transformed from scratch each frame, so dragging never compounds rounding
 * and one undo entry covers the whole gesture.
 */
export type ChildSnapshot =
  | { kind: 'rings'; contours: [number, number][][] }
  | { kind: 'box'; position: { x: number; y: number }; rotation: number; scale: number }
  | { kind: 'point'; position: { x: number; y: number } }
  | { kind: 'none' };

export function snapshotChild(child: AnyChild): ChildSnapshot {
  switch (child.childType) {
    case 'shape':
      return { kind: 'rings', contours: effectiveContours(child) };
    case 'water':
      return {
        kind: 'rings',
        contours: child.contours.map((r) => r.map(([x, y]): [number, number] => [x, y])),
      };
    case 'asset':
    case 'text':
      return {
        kind: 'box',
        position: { ...child.position },
        rotation: child.rotation,
        scale: child.scale,
      };
    case 'light':
      return { kind: 'point', position: { ...child.position } };
    // Doors live on a wall; moving one by gizmo would detach it from its host.
    default:
      return { kind: 'none' };
  }
}

/**
 * The patch that puts `snap` through `t`.
 *
 * Rings are rewritten point by point, which is exact for any combination of
 * move, non-uniform scale and rotation — a stored translate/rotate/scale triple
 * cannot represent a non-uniform scale of an already-rotated shape, and would
 * silently skew it instead.
 */
export function transformChild(snap: ChildSnapshot, t: WorldTransform): Partial<AnyChild> {
  switch (snap.kind) {
    case 'rings':
      return {
        contours: snap.contours.map((ring) => ring.map(([x, y]) => mapPoint(x, y, t))),
        // The rings now carry the whole transform; a leftover one would apply twice.
        transform: undefined,
      } as Partial<AnyChild>;
    case 'box': {
      const [x, y] = mapPoint(snap.position.x, snap.position.y, t);
      // One scalar scale, so a non-uniform drag has to pick: the larger factor
      // keeps a corner drag feeling like it tracks the cursor.
      const factor = Math.abs(t.scaleX) > Math.abs(t.scaleY) ? t.scaleX : t.scaleY;
      return {
        position: { x, y },
        rotation: snap.rotation + t.rotation,
        scale: Math.max(snap.scale * Math.abs(factor), 0.01),
      } as Partial<AnyChild>;
    }
    case 'point': {
      const [x, y] = mapPoint(snap.position.x, snap.position.y, t);
      return { position: { x, y } } as Partial<AnyChild>;
    }
    case 'none':
      return {};
  }
}

/** True when the patch would actually change anything worth an undo entry. */
export function isIdentity(t: WorldTransform): boolean {
  return (
    Math.abs(t.translateX) < 1e-9 &&
    Math.abs(t.translateY) < 1e-9 &&
    Math.abs(t.scaleX - 1) < 1e-9 &&
    Math.abs(t.scaleY - 1) < 1e-9 &&
    Math.abs(t.rotation) < 1e-9
  );
}
