// Applying a gizmo drag to the children it is drawn around.
//
// The gizmo computed a delta and fired callbacks that nothing was ever
// subscribed to, so dragging a handle drew feedback and changed nothing. This
// is the missing half.

import type { AnyChild, ShapeChild } from '../../store/types';
import type { RingTangents, Vec2 } from '../../shared/bezier';
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
 * Curve handle points live in the same space as ring points, so every path
 * that maps a ring must map its tangents with the same function — a moved room
 * whose handles stayed behind bends its walls toward where it used to stand.
 */
function mapTangents(
  tangents: RingTangents[] | undefined,
  map: (p: Vec2) => Vec2,
): RingTangents[] | undefined {
  if (!tangents) return undefined;
  return tangents.map((ring) =>
    (ring ?? []).map((vt) =>
      vt
        ? {
            ...(vt.tin ? { tin: map(vt.tin) } : {}),
            ...(vt.tout ? { tout: map(vt.tout) } : {}),
          }
        : vt,
    ),
  );
}

/** The shape's tangents with its optional baked-in transform applied. */
function effectiveTangents(shape: ShapeChild): RingTangents[] | undefined {
  const t = shape.transform;
  if (!t) return shape.tangents ? structuredClone(shape.tangents) : undefined;
  const cos = Math.cos(t.rotate);
  const sin = Math.sin(t.rotate);
  return mapTangents(shape.tangents, ([px, py]) => {
    const sx = px * t.scale[0];
    const sy = py * t.scale[1];
    return [cos * sx - sin * sy + t.translate[0], sin * sx + cos * sy + t.translate[1]];
  });
}

/**
 * What a child looked like before the drag. Held for the whole gesture and
 * re-transformed from scratch each frame, so dragging never compounds rounding
 * and one undo entry covers the whole gesture.
 */
export type ChildSnapshot =
  | { kind: 'rings'; contours: [number, number][][]; tangents?: RingTangents[] }
  | {
      kind: 'box';
      position: { x: number; y: number };
      rotation: number;
      scale: number;
      width: number;
      height: number;
      /**
       * Text scales through fontSize × scale, so its size is inherently one
       * number; assets resize width/height independently.
       */
      uniform: boolean;
    }
  | { kind: 'radius'; position: { x: number; y: number }; radius: number }
  | { kind: 'none' };

export function snapshotChild(child: AnyChild): ChildSnapshot {
  switch (child.childType) {
    case 'shape':
      return { kind: 'rings', contours: effectiveContours(child), tangents: effectiveTangents(child) };
    case 'water':
      return {
        kind: 'rings',
        contours: child.contours.map((r) => r.map(([x, y]): [number, number] => [x, y])),
        tangents: child.tangents ? structuredClone(child.tangents) : undefined,
      };
    case 'asset':
    case 'text':
      return {
        kind: 'box',
        position: { ...child.position },
        rotation: child.rotation,
        scale: child.scale,
        width: child.width,
        height: child.height,
        uniform: child.childType === 'text',
      };
    case 'light':
      return { kind: 'radius', position: { ...child.position }, radius: child.radius };
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
        // Always written, even as undefined: the patch's `before` capture keys
        // off these fields, and curves must move with their ring.
        tangents: mapTangents(snap.tangents, ([x, y]) => mapPoint(x, y, t)),
        // The rings now carry the whole transform; a leftover one would apply twice.
        transform: undefined,
      } as Partial<AnyChild>;
    case 'box': {
      const [x, y] = mapPoint(snap.position.x, snap.position.y, t);
      if (snap.uniform) {
        // Text: one size number. The larger factor keeps a corner drag feeling
        // like it tracks the cursor.
        const factor = Math.abs(t.scaleX) > Math.abs(t.scaleY) ? t.scaleX : t.scaleY;
        return {
          position: { x, y },
          rotation: snap.rotation + t.rotation,
          scale: Math.max(snap.scale * Math.abs(factor), 0.01),
        } as Partial<AnyChild>;
      }
      // Assets resize width/height directly — that is what the renderer draws —
      // so edge drags are non-uniform for free. Legacy `scale` stays a
      // multiplier on top and is left untouched.
      return {
        position: { x, y },
        rotation: snap.rotation + t.rotation,
        width: Math.max(snap.width * Math.abs(t.scaleX), 0.01),
        height: Math.max(snap.height * Math.abs(t.scaleY), 0.01),
      } as Partial<AnyChild>;
    }
    case 'radius': {
      const [x, y] = mapPoint(snap.position.x, snap.position.y, t);
      // Lights have no orientation: rotation is ignored, scale resizes the
      // radius by the dominant factor.
      const factor = Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY));
      return {
        position: { x, y },
        radius: Math.max(snap.radius * factor, 0.1),
      } as Partial<AnyChild>;
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
