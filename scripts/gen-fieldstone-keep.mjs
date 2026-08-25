// Authors session/testdata/fieldstone-keep.mapbuilder.
// Kept as a script because the geometry (walls split around door gaps, room
// boundaries inset by half a wall) is arithmetic, not something to hand-edit.
// ponytail: one-shot generator, not a tool. Delete it if the map goes stale.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HALF = 0.25; // half of wallWidth 0.5 — rooms inset from their walls
// Floors/props/water were dungeon-classic art and left with it — rooms render
// flat floorColor until gg-demo ships replacements. Walls are gg-forge.

// ─── stable room id (mirror of core/src/shared/roomUtils) ───
const signedArea = (b) => {
  let s = 0;
  for (let i = 0; i < b.length; i++) {
    const [x1, y1] = b[i];
    const [x2, y2] = b[(i + 1) % b.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};
const centroidOf = (b) => {
  const a = signedArea(b);
  let cx = 0, cy = 0;
  for (let i = 0; i < b.length; i++) {
    const [x1, y1] = b[i];
    const [x2, y2] = b[(i + 1) % b.length];
    const cr = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cr;
    cy += (y1 + y2) * cr;
  }
  return [cx / (6 * a), cy / (6 * a)];
};
const stableRoomId = (c) => {
  const key = `${Math.round(c[0])},${Math.round(c[1])}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `room-${(h >>> 0).toString(36)}`;
};

// ─── rooms: a 4x3 band grid, the Great Hall eating two bands ───
// Staggered bands rather than a uniform 4x3 grid: the partition walls of one
// band never line up with the next, so the plan reads as a building instead of
// a spreadsheet. Void-free by construction — every cell inside the shell is
// somebody's floor, which is what keeps the wall runs continuous.
const R = [
  { key: 'chapel',      name: 'Chapel of the Pale Flame', x0: 2,  y0: 2,  x1: 17, y1: 13, floor: 'large-flagstone-a-01' },
  { key: 'armory',      name: 'Armoury',                  x0: 17, y0: 2,  x1: 29, y1: 13, floor: 'rectangular-tiles-a-01' },
  { key: 'scriptorium', name: 'Scriptorium',              x0: 29, y0: 2,  x1: 45, y1: 13, floor: 'smooth-stone-floor-a-10' },
  { key: 'vault',       name: 'Sealed Vault',             x0: 45, y0: 2,  x1: 58, y1: 13, floor: 'rectangular-tiles-a-01' },
  { key: 'hall',        name: 'Great Hall of Banners',    x0: 2,  y0: 13, x1: 31, y1: 31, floor: 'large-flagstone-a-01' },
  { key: 'barracks',    name: 'Barrack Rows',             x0: 31, y0: 13, x1: 45, y1: 31, floor: 'cobblestone-a-01' },
  { key: 'cistern',     name: 'Cistern Undercroft',       x0: 45, y0: 13, x1: 58, y1: 31, floor: 'rock-tiles-b-01' },
  { key: 'gatehouse',   name: 'Gatehouse',                x0: 2,  y0: 31, x1: 14, y1: 43, floor: 'cobblestone-a-01' },
  { key: 'guard',       name: 'Guard Room',               x0: 14, y0: 31, x1: 30, y1: 43, floor: 'cobblestone-a-01' },
  { key: 'kitchen',     name: 'Kitchens',                 x0: 30, y0: 31, x1: 45, y1: 43, floor: 'large-flagstone-a-01' },
  { key: 'crypt',       name: 'Crypt Stair',              x0: 45, y0: 31, x1: 58, y1: 43, floor: 'smooth-stone-floor-a-10' },
  // exterior: south of the Gatehouse, outside the shell. Registered as a room
  // like the rest (door binding needs `rid`/`sides` to find it) but its
  // perimeter below is deliberately incomplete — see the palisade segments.
  { key: 'courtyard',   name: 'Bailey Courtyard',         x0: 2,  y0: 43, x1: 26, y1: 58, floor: 'grass-a-01' },
];

for (const r of R) {
  r.boundary = [
    [r.x0 + HALF, r.y0 + HALF], [r.x1 - HALF, r.y0 + HALF],
    [r.x1 - HALF, r.y1 - HALF], [r.x0 + HALF, r.y1 - HALF],
  ];
  r.centroid = centroidOf(r.boundary);
  r.id = stableRoomId(r.centroid);
  r.area = Math.abs(signedArea(r.boundary));
}
const rid = (k) => R.find((r) => r.key === k).id;
if (new Set(R.map((r) => r.id)).size !== R.length) throw new Error('room id collision');

// ─── walls: each grid line, split around 2-cell doorway segments ───
// A doorway is its own short wall segment; the door child binds to it and the
// renderer cuts the gap out of exactly that piece (same as emberhold-crypt).
const walls = [];
const doors = [];
let wallN = 0, doorN = 0;
const wallId = () => `wall-${String(++wallN).padStart(3, '0')}`;

/**
 * @param axis 'v' (x fixed) or 'h' (y fixed)
 * @param gaps [{ at, a, b, name, style, state, secret }] — `at` is the gap centre
 */
function line(axis, fixed, from, to, gaps = []) {
  const pt = (t) => (axis === 'v' ? [fixed, t] : [t, fixed]);
  const angle = axis === 'v' ? Math.PI / 2 : 0;
  let cur = from;
  for (const g of [...gaps].sort((x, y) => x.at - y.at)) {
    const s = g.at - 1, e = g.at + 1;
    if (s > cur) walls.push(seg(pt(cur), pt(s)));
    const gapWall = seg(pt(s), pt(e));
    walls.push(gapWall);
    doors.push({
      id: `door-${String(++doorN).padStart(2, '0')}-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: g.name,
      childType: 'door',
      visible: true,
      wallId: gapWall.id,
      position: pt(g.at),
      angle,
      width: 2,
      style: g.style ?? 'single',
      state: g.state ?? 'closed',
      isSecret: !!g.secret,
      // Authored in the order roomSync will rebind to, so a load never flips a
      // door's graph edge: bindDoorToRooms probes along the wall normal
      // (-dy, dx) — the -x side of a +y wall, the +y side of a +x wall.
      ...sides(pt(g.at), axis, g.a, g.b),
    });
    cur = e;
  }
  if (to > cur) walls.push(seg(pt(cur), pt(to)));
}
/** Which of the two neighbouring rooms the binder's +normal probe lands in. */
function sides([px, py], axis, k1, k2) {
  const probe = axis === 'v' ? [px - 0.5, py] : [px, py + 0.5];
  const holds = (k) => {
    const r = R.find((x) => x.key === k);
    return probe[0] > r.x0 && probe[0] < r.x1 && probe[1] > r.y0 && probe[1] < r.y1;
  };
  if (holds(k1) === holds(k2)) throw new Error(`door probe ambiguous between ${k1}/${k2}`);
  const [a, b] = holds(k1) ? [k1, k2] : [k2, k1];
  return { roomA: rid(a), roomB: rid(b) };
}

const seg = (a, b) => {
  const w = {
    id: wallId(), points: [a, b], wallType: 'normal', direction: 'both',
    color: '#26221c', width: 0.5, roughness: 0,
  };
  return w;
};

// outer shell
line('v', 2, 2, 43);
line('v', 58, 2, 43);
line('h', 2, 2, 58);
line('h', 43, 2, 58, [{ at: 8, a: 'gatehouse', b: 'courtyard', name: 'Bailey Gate', style: 'archway', state: 'open' }]);

// vertical partitions
line('v', 17, 2, 13, [{ at: 8, a: 'chapel', b: 'armory', name: 'Vestry Door' }]);
line('v', 29, 2, 13, [{ at: 6, a: 'armory', b: 'scriptorium', name: 'Muster Arch', style: 'archway', state: 'open' }]);
line('v', 45, 2, 13, [{ at: 8, a: 'scriptorium', b: 'vault', name: 'Hidden Shelf', secret: true }]);
line('v', 31, 13, 31, [{ at: 22, a: 'hall', b: 'barracks', name: 'Hall Double Door', style: 'double' }]);
line('v', 45, 13, 31, [{ at: 22, a: 'barracks', b: 'cistern', name: 'Cistern Gate', style: 'portcullis' }]);
line('v', 14, 31, 43, [{ at: 37, a: 'gatehouse', b: 'guard', name: 'Watch Door' }]);
line('v', 30, 31, 43, [{ at: 36, a: 'guard', b: 'kitchen', name: 'Scullery Door', state: 'open' }]);
line('v', 45, 31, 43, [{ at: 38, a: 'kitchen', b: 'crypt', name: 'Crypt Door' }]);

// horizontal partitions
line('h', 13, 2, 17, [{ at: 9, a: 'chapel', b: 'hall', name: 'Chancel Arch', style: 'archway', state: 'open' }]);
line('h', 13, 17, 29, [{ at: 23, a: 'armory', b: 'hall', name: 'Armoury Door' }]);
line('h', 13, 29, 31); // scriptorium's south-west stub
line('h', 13, 31, 45, [{ at: 38, a: 'scriptorium', b: 'barracks', name: 'Stair Door' }]);
line('h', 13, 45, 58); // vault sealed from the cistern: no door on this run
line('h', 31, 2, 14, [{ at: 8, a: 'hall', b: 'gatehouse', name: 'Gate Arch', style: 'archway', state: 'open' }]);
line('h', 31, 14, 30, [{ at: 22, a: 'hall', b: 'guard', name: 'Guard Door', state: 'open' }]);
line('h', 31, 30, 31); // hall's south-east stub
line('h', 31, 31, 45, [{ at: 38, a: 'barracks', b: 'kitchen', name: 'Mess Door', state: 'open' }]);
line('h', 31, 45, 58, [{ at: 51, a: 'cistern', b: 'crypt', name: 'Undercroft Door' }]);

// courtyard perimeter: timber palisade, per-wall texture override (the layer
// style stays 'fieldstone' for the interior). Left deliberately incomplete —
// wide gaps on the west and south runs — so it reads as an open bailey, not
// a walled room. The isolated stub in the yard is freestanding on purpose:
// directional-shadow testing wants a wall with nothing behind it.
const segPalisade = (a, b) => ({ ...seg(a, b), textureSetId: 'palisade', textureTint: '#b49366', color: '#221a12' });
walls.push(segPalisade([2, 50], [2, 58]));   // west run, starts well clear of the gate
walls.push(segPalisade([4, 58], [14, 58]));  // south run, west half
walls.push(segPalisade([17, 58], [25, 58])); // south run, east half — 3-unit gap between
walls.push(segPalisade([18, 49], [18, 53])); // freestanding stub, shadow test target

// ─── children ───
const floors = R.map((r) => ({
  id: `floor-${r.key}`,
  name: `${r.name} Floor`,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]],
  roughnessEnabled: false,
  textureId: undefined,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
}));

// 5 warm lights. Armoury, Scriptorium, Vault, Barracks, Cistern and the Crypt
// Stair are deliberately unlit — that is the darkvision/torch half of the review.
const light = (id, name, x, y, radius, intensity, color) => ({
  id, name, childType: 'light', visible: true,
  color, radius, featherRadius: 2.5, intensity, falloff: 'quadratic',
  position: { x, y },
});
const lights = [
  light('light-hall-west', 'Great Hall Brazier (West)', 9, 19, 9.5, 0.95, '#ffb877'),
  light('light-hall-east', 'Great Hall Brazier (East)', 24, 26, 9.5, 0.95, '#ffb877'),
  light('light-gatehouse', 'Gatehouse Lantern', 8, 37, 7.5, 0.85, '#ffc38a'),
  light('light-kitchen', 'Kitchen Hearth', 37, 37, 8.5, 0.9, '#ff9b52'),
  light('light-chapel', 'Chapel Candles', 9, 7, 6.5, 0.7, '#ffd9a0'),
  light('light-courtyard-gate', 'Bailey Gate Lantern', 8, 46, 8, 0.8, '#ffb877'),
];

const zones = [{
  id: 'zone-vault-seal',
  name: 'Sealed Vault',
  childType: 'zone',
  visible: true,
  shape: { kind: 'rect', x: 45.5, y: 2.5, width: 12, height: 10 },
  blocksAutoExplore: true,
}];

const map = {
  version: '3.1',
  mapSettings: {
    name: 'Fieldstone Keep',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    // The Day preset. The mood is "this world in neutral daylight" now, not a baked night —
    // the dark comes from the time keys (and the braziers keep their own pools), so a mood of
    // near-black composed the noon courtyard to near-black and no shadow could multiply onto it.
    ambientLight: '#e8e4d8',
    // The keep stands under real sky, so the demo map demonstrates the world clock out of the
    // box: the grade carries the hour and the sun casts (P2/P3).
    environment: 'outdoor',
    naturalLight: true,
    // Sunrise sits at `orientation` degrees clockwise from screen-right, and a shadow runs the
    // opposite way. At 90° the morning sun stands south-west of the bailey, so both palisade
    // runs — the west one at x=2 and the south one at y=58 — throw their shadows up and to the
    // right, i.e. into the courtyard rather than out into the void beyond it.
    orientation: 90,
    // timeMode left unset (= 'clock'): the keep follows the campaign's own hour.
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  customImages: {},
  layers: [
    {
      id: 'bg-fieldstone-keep',
      name: 'Background',
      type: 'background',
      visible: true,
      locked: false,
      opacity: 1,
      backgroundColor: '#08090b',
      backgroundTexture: null,
      textureScale: 0.25,
      textureTint: '#ffffff',
      presetLock: false,
    },
    {
      id: 'dungeon-fieldstone-keep',
      name: 'Keep',
      type: 'dungeon',
      visible: true,
      locked: false,
      opacity: 1,
      mergedFloor: null,
      style: {
        floorColor: '#b8ac92',
        wallColor: '#26221c',
        wallWidth: 0.5,
        shadowEnabled: true,
        shadowColor: '#5c544a',
        shadowOffset: { x: 0.4, y: 0.3 },
        shadowIntensity: 0.5,
        roughnessAmplitude: 0,
        lineWidth: 0.04,
        edgeTransitionWidth: 0.5,
        showEdgeTransitions: true,
        wallTextureSetId: 'GG_Fieldstone',
        wallTextureTint: '#b09878',
      },
      sublayerVisibility: { floor: true, grid: true, walls: true },
      standaloneWalls: walls,
      rooms: R.map((r) => ({
        id: r.id, name: r.name, boundary: r.boundary,
        centroid: r.centroid, area: r.area, isPathway: false,
      })),
      roomNameOverrides: Object.fromEntries(R.map((r) => [r.id, r.name])),
      children: [...floors, ...lights, ...doors, ...zones],
    },
  ],
};

const out = join(import.meta.dirname, '../session/testdata/fieldstone-keep.mapbuilder');
writeFileSync(out, JSON.stringify(map, null, 1));
console.log(`${out}\nrooms=${R.length} walls=${walls.length} doors=${doors.length} lights=${lights.length}`);
