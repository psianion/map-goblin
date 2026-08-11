// Cheap ink-outline post-pass: inverted-hull technique. A backface-only,
// unlit, ink-colored mesh nested as a JSX child of the source mesh so it
// automatically inherits the parent's transform — including the scroll-
// driven scale.y that grows walls/doors during beats 1-2, no separate sync
// needed. Built from a geometry whose vertices are pushed along their own
// normals (geometry.ts's outlineGeometry), not a mesh.scale trick: wall
// geometry bakes world position into its vertices, so scaling the mesh
// itself would shift it toward/away from world origin instead of just
// puffing up its silhouette.
import * as THREE from 'three';

export const INK_OUTLINE = '#16180f';

// Outline push-out distance, tiered per art-style-guide rule 3 ("line
// weight is heavier on structure, lighter on ground clutter"): walls, doors,
// and the map's own torn-rock border are structure; dice, mug, chair, and
// tokens are props/clutter and get the lighter weight instead.
export const OUTLINE_EPS_STRUCTURE = 0.045;
export const OUTLINE_EPS_PROP = 0.018;

// D2 value inversion fix: `matRef` is optional (every existing caller passes
// none and keeps the old always-opaque-at-1 behavior — walls/doors already
// fade in correctly because their own scale.y grows from 0, which this mesh
// inherits as a JSX child). The border/skirt's own reveal is opacity-driven
// instead (Diorama.tsx borderMatRef, not a scale trick — a flat ground-level
// ribbon doesn't "grow" the way a wall does), and this component's material
// used to ignore that entirely: the border's ink silhouette rendered at full
// opacity from the very first frame regardless of riseT. Harmless (invisible)
// against the old dark-void backdrop; glaring against D2's light floor/wood
// world, tracing the room's full silhouette through beat 0 "pre-dawn" (which
// is supposed to show nothing). `transparent` is set unconditionally so a
// caller's ref can drive opacity at runtime — at the default opacity=1 this
// renders identically to the old plain opaque material.
export function Outline({ geometry, matRef }: { geometry: THREE.BufferGeometry; matRef?: (m: THREE.MeshBasicMaterial | null) => void }) {
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial ref={matRef} color={INK_OUTLINE} side={THREE.BackSide} toneMapped={false} transparent />
    </mesh>
  );
}
