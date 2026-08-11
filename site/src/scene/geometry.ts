// Greybox geometry builders — turn map data into THREE geometry. No
// hardcoded meshes: every wall/floor/door shape is derived from the point
// data in mapData.ts.
import * as THREE from 'three';
import type { Door, FloorRect, Vec2 } from './mapData';
import { FLOOR_TILE_CELLS } from './textures';

/** Clones the default UV set into `uv2` — three.js's aoMap always samples
 * uv2 regardless of what's on `uv`/`.repeat`. Every geometry that can carry
 * one of textures.ts's MaterialMaps bundles needs this once, after its
 * final `uv` layout is settled (so a tiled/rescaled `uv` — see floorGeometry
 * below — carries into `uv2` too and the AO map tiles exactly like the color map). */
export function withUv2<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.setAttribute('uv2', geometry.attributes.uv);
  return geometry;
}

/** A thin rectangular ribbon along a-b, extruded upward. Standard
 * floor-plan-to-wall recipe: build the footprint shape in (x, -z), extrude
 * along the shape's local Z by `height`, then rotateX(-90deg) to stand it
 * up so the extrusion becomes world Y and the footprint lands back on XZ. */
export function wallSegmentGeometry(a: Vec2, b: Vec2, thickness: number, height: number): THREE.ExtrudeGeometry {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (thickness / 2);
  const nz = (dx / len) * (thickness / 2);
  const shape = new THREE.Shape();
  shape.moveTo(a.x + nx, -(a.z + nz));
  shape.lineTo(b.x + nx, -(b.z + nz));
  shape.lineTo(b.x - nx, -(b.z - nz));
  shape.lineTo(a.x - nx, -(a.z - nz));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return withUv2(geometry);
}

export function floorGeometry(rect: FloorRect): { geometry: THREE.PlaneGeometry; center: [number, number, number] } {
  const width = rect.max.x - rect.min.x;
  const depth = rect.max.z - rect.min.z;
  const geometry = new THREE.PlaneGeometry(width, depth);
  // Scale UVs 1:FLOOR_TILE_CELLS with world units so the shared floor texture
  // (scene/textures.ts) — a meta-tile of FLOOR_TILE_CELLS grid cells per
  // repeat, not a single cell — repeats exactly once per meta-tile's worth
  // of world units regardless of this rect's size; the repeat count lives in
  // this geometry, not on the (cached, shared-across-rects) texture.
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * width) / FLOOR_TILE_CELLS, (uv.getY(i) * depth) / FLOOR_TILE_CELLS);
  }
  uv.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  withUv2(geometry);
  return {
    geometry,
    center: [rect.min.x + width / 2, 0, rect.min.z + depth / 2],
  };
}

/** Inverted-hull ink outline: clones a geometry and pushes each vertex out
 * along its own normal by `epsilon`. Rendered back-face-only and unlit (see
 * scene/Outline.tsx) it silhouettes the source mesh in dark linework — the
 * art-style-guide's "dark ink outlines on every wall/prop" rule. */
export function outlineGeometry(source: THREE.BufferGeometry, epsilon: number): THREE.BufferGeometry {
  const geometry = source.clone();
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) + normal.getX(i) * epsilon,
      position.getY(i) + normal.getY(i) * epsilon,
      position.getZ(i) + normal.getZ(i) * epsilon,
    );
  }
  position.needsUpdate = true;
  return geometry;
}

export function doorGeometry(
  door: Door,
  thickness: number,
  height: number,
): { geometry: THREE.BoxGeometry; center: [number, number, number]; rotationY: number } {
  const dx = door.b.x - door.a.x;
  const dz = door.b.z - door.a.z;
  const width = Math.hypot(dx, dz);
  const doorHeight = height * 0.85;
  return {
    geometry: withUv2(new THREE.BoxGeometry(width, doorHeight, thickness * 1.6)),
    center: [(door.a.x + door.b.x) / 2, doorHeight / 2, (door.a.z + door.b.z) / 2],
    rotationY: -Math.atan2(dz, dx),
  };
}

export interface DoorFrameParts {
  jambs: [
    { geometry: THREE.BoxGeometry; position: [number, number, number] },
    { geometry: THREE.BoxGeometry; position: [number, number, number] },
  ];
  lintel: { geometry: THREE.BoxGeometry; position: [number, number, number]; height: number };
  rotationY: number;
}

/** Stone jambs + a lintel bridging a door's wall gap, so it reads as a
 * trimmed opening rather than a leaf floating in a hole (style-guide rule
 * 8: "archways are gaps with stone trim"). Jambs stand the full wall
 * height at the door's own a/b points; the lintel fills the sliver between
 * the door leaf's top and the wall's top. Callers that want a hero arch
 * instead of a flat lintel (TableScene's exit door) just skip `.lintel`. */
export function doorFrameParts(
  door: Door,
  wallThickness: number,
  wallHeight: number,
  doorLeafHeight: number,
): DoorFrameParts {
  const dx = door.b.x - door.a.x;
  const dz = door.b.z - door.a.z;
  const width = Math.hypot(dx, dz) || 1;
  const rotationY = -Math.atan2(dz, dx);
  const jambWidth = wallThickness * 0.9;
  const jambDepth = wallThickness * 2.2;
  const jambGeo = withUv2(new THREE.BoxGeometry(jambWidth, wallHeight, jambDepth));
  const lintelHeight = Math.max(0.05, wallHeight - doorLeafHeight);
  const lintelGeo = withUv2(new THREE.BoxGeometry(width + jambWidth * 1.6, lintelHeight, jambDepth));
  return {
    jambs: [
      { geometry: jambGeo, position: [door.a.x, wallHeight / 2, door.a.z] },
      { geometry: jambGeo.clone(), position: [door.b.x, wallHeight / 2, door.b.z] },
    ],
    lintel: {
      geometry: lintelGeo,
      position: [(door.a.x + door.b.x) / 2, doorLeafHeight + lintelHeight / 2, (door.a.z + door.b.z) / 2],
      height: lintelHeight,
    },
    rotationY,
  };
}

/** Background-texture critique P1-2: baked torch-pool quads used to be
 * plain centered squares, so a pool near a wall bled straight through it
 * onto the neighboring room / the sheet beyond — contradicting "torches
 * carry exactly as far as you placed them" in the same viewport. This
 * builds the pool plane pre-clipped to the floor rect the torch sits in
 * (static, build-time — the cheap "pre-split against the wall graph"
 * containment: every authored wall in these maps lies on a floor-rect
 * boundary), with UVs remapped so the radial glow texture stays centered on
 * the torch. Callers mount it with the same rotation-x={-PI/2} the old
 * plain plane used (local +y maps to world -z; the glow texture is radially
 * symmetric, so that flip is invisible). Returns the world-XZ center to
 * position the mesh at. */
export function clippedPoolGeometry(
  pos: Vec2,
  floors: FloorRect[],
  size: number,
): { geometry: THREE.PlaneGeometry; center: [number, number] } {
  const half = size / 2;
  const room = floors.find(
    (f) => pos.x >= f.min.x && pos.x <= f.max.x && pos.z >= f.min.z && pos.z <= f.max.z,
  );
  const x0 = Math.max(pos.x - half, room ? room.min.x : -Infinity);
  const x1 = Math.min(pos.x + half, room ? room.max.x : Infinity);
  const z0 = Math.max(pos.z - half, room ? room.min.z : -Infinity);
  const z1 = Math.min(pos.z + half, room ? room.max.z : Infinity);
  const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const wx = cx + position.getX(i);
    const wz = cz - position.getY(i);
    uv.setXY(i, (wx - pos.x + half) / size, (wz - pos.z + half) / size);
  }
  uv.needsUpdate = true;
  return { geometry, center: [cx, cz] };
}

// Cheap deterministic hash (sine-scramble) — used for the torn-edge jitter
// below so the same map always produces the same jagged silhouette (no
// Math.random reshuffle on every hot-reload) without a real PRNG dependency.
function hashJitter(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function subtractCovered(range: [number, number], covered: [number, number][]): [number, number][] {
  let segments: [number, number][] = [range];
  for (const [cs, ce] of covered) {
    const next: [number, number][] = [];
    for (const [s, e] of segments) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    segments = next;
  }
  return segments.filter(([s, e]) => e - s > 1e-6);
}

/** The floor-rect union's true outer boundary: every rect edge minus
 * whatever overlap it has with a neighboring rect (an interior seam, e.g. a
 * room's wall against the corridor it opens into). Purely derived from
 * `floors` — no separate authored outline — so any map shape gets a correct
 * exterior automatically. */
export function exteriorEdges(floors: FloorRect[]): { a: Vec2; b: Vec2; outward: Vec2 }[] {
  const edges: { a: Vec2; b: Vec2; outward: Vec2 }[] = [];
  floors.forEach((rect, ri) => {
    const sides: { fixed: 'x' | 'z'; value: number; range: [number, number]; outward: Vec2 }[] = [
      { fixed: 'z', value: rect.min.z, range: [rect.min.x, rect.max.x], outward: { x: 0, z: -1 } }, // north
      { fixed: 'x', value: rect.max.x, range: [rect.min.z, rect.max.z], outward: { x: 1, z: 0 } }, // east
      { fixed: 'z', value: rect.max.z, range: [rect.min.x, rect.max.x], outward: { x: 0, z: 1 } }, // south
      { fixed: 'x', value: rect.min.x, range: [rect.min.z, rect.max.z], outward: { x: -1, z: 0 } }, // west
    ];
    for (const side of sides) {
      const covered: [number, number][] = [];
      floors.forEach((other, oi) => {
        if (oi === ri) return;
        const onLine =
          side.fixed === 'z'
            ? other.min.z === side.value || other.max.z === side.value
            : other.min.x === side.value || other.max.x === side.value;
        if (!onLine) return;
        const otherRange: [number, number] =
          side.fixed === 'z' ? [other.min.x, other.max.x] : [other.min.z, other.max.z];
        covered.push([Math.max(otherRange[0], side.range[0]), Math.min(otherRange[1], side.range[1])]);
      });
      for (const [s, e] of subtractCovered(side.range, covered)) {
        const a: Vec2 = side.fixed === 'z' ? { x: s, z: side.value } : { x: side.value, z: s };
        const b: Vec2 = side.fixed === 'z' ? { x: e, z: side.value } : { x: side.value, z: e };
        edges.push({ a, b, outward: side.outward });
      }
    }
  });
  return edges;
}

/** Torn-rock silhouette around the floor union's exterior edges: a ribbon
 * that's straight on the floor-facing side and ragged on the void-facing
 * side, so the map's edge reads as broken stone meeting the dark instead of
 * a rectangle clipped into it (art-brief "map borders"). One merged
 * geometry per map — ExtrudeGeometry takes a shape array, so this is a
 * single draw call regardless of how many exterior edges the plan has. */
export function mapBorderGeometry(floors: FloorRect[], height: number): THREE.ExtrudeGeometry {
  // Background-texture critique P1-4: the old loop placed a tooth every 0.5
  // units at uniform width — same-size, same-angle triangles reading as a
  // pinking-shears stamp rather than a torn edge. The tear is noise-driven:
  // tooth POSITIONS jitter along the edge (varying width AND angle in one
  // move), depths are power-curved, and ~1 in 5 teeth carries a second
  // shallower bite right behind it (the "double-tear"). All
  // hashJitter-deterministic — same silhouette every reload.
  //
  // G1 fix (final critique round): tooth depths are sized against the WALLS'
  // PROJECTED silhouette, not the wall footprint. The extrude cap
  // triangulation was verified exact (earcut fills every tooth; cap area ==
  // contour area) — the "straight fringe with hollow chevrons" at the nadir
  // beats was pure occlusion: a 2.2-high wall under a perspective camera at
  // y 15-36 shadows ~0.36-1.0 world units of ground BEYOND the floor line
  // (overhang = d*wallH/(camY-wallH) + halfThickness*camY/(camY-wallH), d =
  // horizontal offset from the camera axis), so the old 0.12-0.62 teeth
  // (mean ~0.31) mostly never cleared it — only tips peeked, reading as
  // outline-without-fill at 1-2px. Depth floor 0.38 clears beat 4's N/S
  // shadow (~0.36) for EVERY tooth; the 0.55 range keeps deep bites near a
  // grid cell without escaping the sheet/contact-shadow footprints. Power
  // 1.2 (was 1.7) stops shallow nicks from dominating the distribution.
  // ponytail: static geometry can't out-jag every camera — beat 3's
  // off-center north edge (~0.92 shadow) and beat 4's E/W edges (~0.65)
  // still swallow some teeth; per-beat depth would need camera-aware
  // geometry, not worth it while acceptance names beats 4/6 N/S.
  const shapes = exteriorEdges(floors).map((edge, ei) => {
    const { a, b, outward } = edge;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.round(len / 0.45));
    const shape = new THREE.Shape();
    const pts: [number, number][] = [];
    const bite = (t: number, depth: number) => {
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      pts.push([px + outward.x * depth, pz + outward.z * depth]);
    };
    for (let i = 0; i <= steps; i++) {
      // Interior teeth wander up to ~±35% of a step off the uniform grid;
      // endpoints stay put so adjacent edges' corners still meet.
      const wander = i > 0 && i < steps ? (hashJitter(ei * 31.77 + i * 3.19) - 0.5) * 0.7 : 0;
      const t = (i + wander) / steps;
      const depth = 0.38 + hashJitter(ei * 97.13 + i * 7.31) ** 1.2 * 0.55;
      bite(t, depth);
      if (i < steps && hashJitter(ei * 53.91 + i * 11.73) > 0.8) {
        // Offset kept under the next tooth's own minimum jittered position
        // (i+0.65)/steps so the outline stays monotonic — a backwards fold
        // would self-intersect the shape and break the extrude triangulation.
        // Close-out round: the second bite is floored like the primary —
        // depth*0.45 alone (0.17-0.42) sat at or below the projected wall
        // shadow, so the double-tear never emerged at the nadir beats.
        bite(Math.min(1, t + 0.25 / steps), Math.max(0.38, depth * 0.45));
      }
    }
    // Close-out round: emit each flank with one hash-driven mid-vertex kink
    // (mostly-outward, up to ~0.09 units) so flanks stop being perfect line
    // segments — at 5x zoom straight single-segment flanks read as schematic
    // shards, not torn rock. Mostly-outward bias keeps kink vertices clear
    // of the projected wall shadow that hides inward excursions.
    shape.moveTo(a.x, -a.z);
    let prev: [number, number] = [a.x, a.z];
    const emit = (p: [number, number], j: number) => {
      const kink = hashJitter(ei * 71.29 + j * 5.53) * 0.12 - 0.03;
      shape.lineTo((prev[0] + p[0]) / 2 + outward.x * kink, -((prev[1] + p[1]) / 2 + outward.z * kink));
      shape.lineTo(p[0], -p[1]);
      prev = p;
    };
    pts.forEach((p, j) => emit(p, j));
    emit([b.x, b.z], pts.length);
    shape.closePath();
    return shape;
  });
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return withUv2(geometry);
}
