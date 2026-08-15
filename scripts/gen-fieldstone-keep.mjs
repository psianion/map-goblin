// Authors session/testdata/fieldstone-keep.mapbuilder.
// Kept as a script because the geometry (walls split around door gaps, room
// boundaries inset by half a wall) is arithmetic, not something to hand-edit.
// ponytail: one-shot generator, not a tool. Delete it if the map goes stale.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HALF = 0.25; // half of wallWidth 0.5 — rooms inset from their walls
const PACK = 'dungeon-classic:';

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
  textureId: PACK + r.floor + '_1x1_floor_A',
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
}));

// courtyard ground detail, painted on top of its base grass floor above —
// same shape/texture vocabulary as `floors`, just hand-authored since it's
// two textures inside one room instead of one.
const patch = (id, name, tex, x0, y0, x1, y1) => ({
  id, name, childType: 'shape', visible: true, shapeType: 'rectangle',
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  roughnessEnabled: false,
  textureId: PACK + tex + '_1x1_floor_A',
  textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0,
  textureTint: '#ffffff',
});
const courtyardFloors = [
  patch('floor-courtyard-apron', 'Bailey Apron', 'dirt-b-04', 5, 43, 13, 49),
  patch('floor-courtyard-path', 'Bailey Path', 'cobblestone-a-01', 7, 43, 9, 55),
];

const water = [{
  id: 'water-cistern',
  name: 'Cistern Pool',
  childType: 'water',
  visible: true,
  waterType: 'lake',
  contours: [[[47, 17], [56, 17], [56, 27], [47, 27]]],
  textureId: PACK + 'Water_Still_A_01_7x7_floor_A',
  tint: '#5f8790',
  opacity: 0.88,
  bankTextureId: PACK + 'Bank_Stone_Mossy_Path_A1_4x1_edge_A',
  bankWidth: 0.6,
  flowSpeed: 0,
  flowAngle: 0,
}];

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

const asset = (id, name, assetId, x, y, opts = {}) => ({
  id, name, childType: 'asset', visible: true, objectType: 'asset',
  assetId: PACK + assetId,
  position: { x, y },
  rotation: opts.rotation ?? 0,
  scale: opts.scale ?? 1,
  width: opts.width ?? 1,
  height: opts.height ?? 1,
  tint: opts.tint ?? '#ffffff',
  flipX: false, flipY: false,
});
// Style guide rule 6: detail concentrated at walls and edges, floor centres left
// open for tokens. Everything below hugs a wall except the two hall braziers,
// which are the map's focal accent and have to sit where the light pools do.
const ROCK = 'Rock_Stone_Mossy_C11_2x1_2x1_object_A';
const LEAF = 'Fallen_Leaves_Piles_Green1_A1_1x1_1x1_object_A';
const rock = (n, x, y, rot) => asset(`asset-rock-${n}`, 'Fallen Stone', ROCK, x, y, { width: 2, height: 1, rotation: rot });
const leaf = (n, x, y, rot) => asset(`asset-leaf-${n}`, 'Blown Leaves', LEAF, x, y, { tint: '#b9c4b0', rotation: rot });
const assets = [
  // focal: the two hall braziers
  asset('asset-brazier-hall-w', 'Hall Brazier West', 'Campfire_Wood_Dark_Stone_Sandstone_Lit_A1_1x1_1x1_object_A', 9, 19),
  asset('asset-brazier-hall-e', 'Hall Brazier East', 'Campfire_Wood_Dark_Stone_Sandstone_Lit_A1_1x1_1x1_object_A', 24, 26),
  asset('asset-hearth-kitchen', 'Kitchen Hearth', 'Campfire_Wood_Dark_Stone_Sandstone_Lit_A1_1x1_1x1_object_A', 37, 37),
  asset('asset-embers-chapel', 'Chapel Embers', 'Campfire_Embers_B1_1x1_1x1_object_A', 9, 7),
  asset('asset-lamp-gatehouse', 'Gatehouse Lamp', 'Lamp_Metal_Brass_A_1x1_1x1_object_A', 8, 37),
  asset('asset-lamp-hall-n', 'Hall Sconce', 'Lamp_Street_Metal_Brass_A_1x1_1x1_object_A', 16, 14.2),
  asset('asset-lamp-hall-s', 'Hall Sconce', 'Lamp_Street_Metal_Brass_A_1x1_1x1_object_A', 27, 29.8),
  asset('asset-lamp-guard', 'Guard Lamp', 'Lamp_Metal_Brass_A_1x1_1x1_object_A', 15.2, 32.2),
  asset('asset-lamp-barracks', 'Cold Sconce', 'Lamp_Street_Metal_Brass_A_1x1_1x1_object_A', 32.2, 14.2),
  asset('asset-lamp-cistern', 'Dead Lamp', 'Lamp_Metal_Brass_A_1x1_1x1_object_A', 46.2, 14.2),
  // firewood + logs along the hall's cold wall
  asset('asset-log-hall', 'Firewood', 'Log_Ashen_A1_6x3_6x3_object_A', 5.5, 29.5, { width: 6, height: 3, scale: 0.5 }),
  asset('asset-log-kitchen', 'Kitchen Logs', 'Log_Ashen_A1_6x3_6x3_object_A', 43, 41, { width: 6, height: 3, scale: 0.42, rotation: 1.57 }),
  asset('asset-stump-crypt', 'Block', 'Stump_Ashen_A1_4x4_4x4_object_A', 56, 41.5, { width: 4, height: 4, scale: 0.35 }),
  // rubble hugging walls
  rock('armory-n', 27.4, 3.2, 0.3),
  rock('scriptorium-s', 31.5, 11.8, -0.15),
  rock('vault-e', 56.2, 4.4, 1.5),
  rock('barracks-w', 32.4, 29.6, 0.1),
  rock('cistern-n', 46.5, 14.5, -0.4),
  rock('crypt-w', 46.6, 41.2, -0.2),
  rock('crypt-e', 56.4, 33, 1.4),
  rock('hall-nw', 3.4, 14.4, 0.2),
  rock('guard-s', 16, 41.6, -0.3),
  // damp: cistern seepage and the crypt stair
  asset('asset-puddle-cistern', 'Seep', 'Puddle_Water_Muddy_A12_2x2_2x2_object_A', 46.5, 29, { width: 2, height: 2 }),
  asset('asset-puddle-cistern-2', 'Seep', 'Puddle_Water_Muddy_A5_2x2_2x2_object_A', 56, 15.5, { width: 2, height: 2 }),
  asset('asset-puddle-crypt', 'Crypt Seep', 'Puddle_Water_Blue_A11_1x1_1x1_object_A', 47, 35.5),
  asset('asset-puddle-crypt-2', 'Crypt Seep', 'Puddle_Water_Blue_A1_2x2_2x2_object_A', 52, 42, { width: 2, height: 2 }),
  asset('asset-puddle-barracks', 'Spill', 'Puddle_Water_Muddy_A5_2x2_2x2_object_A', 43, 15.5, { width: 2, height: 2 }),
  // leaf litter blown in from the gate
  leaf('gate-1', 3.2, 41.6, 0),
  leaf('gate-2', 12.6, 32.2, 1.1),
  leaf('gate-3', 6.4, 33.4, 2.3),
  leaf('hall-1', 4.2, 22.5, 0.6),
  leaf('guard-1', 28.6, 32.4, 1.8),
  asset('asset-grass-crypt', 'Weeds', 'Grass_Patch_Green1_A1_1x1_1x1_object_A', 46.4, 32.4, { tint: '#8a9b7e' }),
  asset('asset-grass-gate', 'Weeds', 'Grass_Patch_Green1_A1_1x1_1x1_object_A', 3.4, 36.5, { tint: '#8a9b7e' }),
  // bailey courtyard dressing — spaced apart for directional prop shadows
  asset('asset-lamp-courtyard-gate', 'Gate Lantern', 'Lamp_Metal_Brass_A_1x1_1x1_object_A', 8, 46),
  asset('asset-tree-courtyard-1', 'Bailey Tree', 'Tree_Green_A1_6x6_6x6_object_A', 20, 47, { width: 6, height: 6 }),
  asset('asset-tree-courtyard-2', 'Bailey Tree', 'Tree_Green_A1_6x6_6x6_object_A', 23, 53, { width: 6, height: 6 }),
  asset('asset-logs-courtyard', 'Supply Stack', 'Log_Ashen_A1_6x3_6x3_object_A', 16, 45, { width: 6, height: 3, scale: 0.4, rotation: 0.3 }),
  asset('asset-stump-courtyard', 'Yard Stump', 'Stump_Ashen_A1_4x4_4x4_object_A', 11, 52, { width: 4, height: 4, scale: 0.35 }),
  rock('courtyard-1', 5, 55, 0.4),
  asset('asset-grass-courtyard', 'Weeds', 'Grass_Patch_Green1_A1_1x1_1x1_object_A', 21, 44, { tint: '#8a9b7e' }),
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
    ambientLight: '#0e0f14',
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
        defaultTextureId: PACK + 'large-flagstone-a-01_1x1_floor_A',
        edgeTransitionWidth: 0.5,
        showEdgeTransitions: true,
        wallTextureSetId: 'fieldstone',
        wallTextureTint: '#b09878',
      },
      sublayerVisibility: { floor: true, grid: true, walls: true },
      standaloneWalls: walls,
      rooms: R.map((r) => ({
        id: r.id, name: r.name, boundary: r.boundary,
        centroid: r.centroid, area: r.area, isPathway: false,
      })),
      roomNameOverrides: Object.fromEntries(R.map((r) => [r.id, r.name])),
      children: [...floors, ...courtyardFloors, ...water, ...assets, ...lights, ...doors, ...zones],
    },
  ],
};

const out = join(import.meta.dirname, '../session/testdata/fieldstone-keep.mapbuilder');
writeFileSync(out, JSON.stringify(map, null, 1));
console.log(`${out}\nrooms=${R.length} walls=${walls.length} doors=${doors.length} lights=${lights.length} assets=${assets.length}`);
