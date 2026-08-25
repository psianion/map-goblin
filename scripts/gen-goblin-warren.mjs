// Authors session/testdata/goblin-warren.mapbuilder — the cave demo map for the
// gg-demo asset drop: packed-earth floors, prop-dressed rooms, mixed lit/unlit
// halves for the vision review, one secret vein behind an auto-explore block.
// ponytail: one-shot generator, not a tool. Delete it if the map goes stale.

import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HALF = 0.25; // half of wallWidth 0.5 — rooms inset from their walls

// ─── gg-demo manifest: asset ids + real pixel sizes come from the pack itself ───
const packDir = join(import.meta.dirname, '../canvas/public/packs/gg-demo');
const manifestFile = readdirSync(packDir).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
const pack = JSON.parse(readFileSync(join(packDir, manifestFile), 'utf8'));
const KEYS = Object.keys(pack.entries);

/** First entry key matching `re` — loud failure beats a silently empty cave. */
function pick(re) {
  const hit = KEYS.filter((k) => re.test(k)).sort()[0];
  if (!hit) throw new Error(`no gg-demo entry matches ${re}`);
  return hit;
}

let assetN = 0;
function obj(re, x, y, opts = {}) {
  const key = pick(re);
  const e = pack.entries[key];
  return {
    id: `asset-${String(++assetN).padStart(3, '0')}-${key.split('_')[0]}`,
    name: key.replace(/_\d+x\d+_object_A$/, '').replace(/_/g, ' '),
    childType: 'asset',
    objectType: 'asset',
    assetId: `gg-demo:${key}`,
    position: { x, y },
    rotation: opts.rot ?? 0,
    scale: opts.scale ?? 1,
    width: e.frame.w / 200,
    height: e.frame.h / 200,
    tint: opts.tint ?? '#ffffff',
    flipX: !!opts.flipX,
    flipY: false,
    visible: true,
  };
}

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

// ─── rooms: three staggered bands, void-free inside the 2..38 × 2..32 shell ───
// tint rides on the shared plaster tile per room so the cave reads as varied
// rock/earth instead of one wash.
const R = [
  { key: 'grotto',   name: 'Fungus Grotto',    x0: 2,  y0: 2,  x1: 14, y1: 12, tint: '#7f8a6d' },
  { key: 'storage',  name: 'Plunder Nook',     x0: 14, y0: 2,  x1: 24, y1: 12, tint: '#8d7f6a' },
  { key: 'den',      name: "Chief's Den",      x0: 24, y0: 2,  x1: 38, y1: 12, tint: '#94806a' },
  { key: 'hall',     name: 'Warren Hall',      x0: 2,  y0: 12, x1: 26, y1: 24, tint: '#857868' },
  { key: 'gallery',  name: 'Web Gallery',      x0: 26, y0: 12, x1: 38, y1: 24, tint: '#7a7370' },
  { key: 'entrance', name: 'Entrance Tunnel',  x0: 2,  y0: 24, x1: 20, y1: 32, tint: '#7f7466' },
  { key: 'vein',     name: 'Hidden Vein',      x0: 20, y0: 24, x1: 38, y1: 32, tint: '#6f6a72' },
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

// ─── walls: grid lines split around 2-cell doorway segments ───
const walls = [];
const doors = [];
let wallN = 0, doorN = 0;
const wallId = () => `wall-${String(++wallN).padStart(3, '0')}`;

const seg = (a, b) => ({
  id: wallId(), points: [a, b], wallType: 'normal', direction: 'both',
  color: '#211d18', width: 0.5, roughness: 0,
});

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
      ...sides(pt(g.at), axis, g.a, g.b),
    });
    cur = e;
  }
  if (to > cur) walls.push(seg(pt(cur), pt(to)));
}
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

// outer shell — a closed cave, the "mouth" is the archway into the entrance tunnel
line('v', 2, 2, 32);
line('v', 38, 2, 32);
line('h', 2, 2, 38);
line('h', 32, 2, 38);

// band 1 partitions
line('v', 14, 2, 12, [{ at: 7, a: 'grotto', b: 'storage', name: 'Rope Curtain', state: 'open' }]);
line('v', 24, 2, 12, [{ at: 6, a: 'storage', b: 'den', name: 'Store Door' }]);

// band 1 / band 2 boundary
line('h', 12, 2, 14, [{ at: 8, a: 'grotto', b: 'hall', name: 'Low Passage', style: 'archway', state: 'open' }]);
line('h', 12, 14, 24, [{ at: 18, a: 'storage', b: 'hall', name: 'Timber Door' }]);
line('h', 12, 24, 38, [{ at: 31, a: 'den', b: 'gallery', name: 'Chief Door', style: 'double' }]);

// band 2 partition
line('v', 26, 12, 24, [{ at: 18, a: 'hall', b: 'gallery', name: 'Old Gate', style: 'portcullis' }]);

// band 2 / band 3 boundary — the vein hides behind the only secret way in
line('h', 24, 2, 20, [{ at: 10, a: 'hall', b: 'entrance', name: 'Mouth Passage', style: 'archway', state: 'open' }]);
line('h', 24, 20, 26, [{ at: 23, a: 'hall', b: 'vein', name: 'Hidden Crack', secret: true }]);
line('h', 24, 26, 38);

// band 3 partition — no door: the vein is secret-only
line('v', 20, 24, 32);

// ─── floors: the shared plaster tile, tinted per room ───
const FLOOR = `gg-demo:${pick(/^floor_small_/)}`;
const floors = R.map((r) => ({
  id: `floor-${r.key}`,
  name: `${r.name} Floor`,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]],
  roughnessEnabled: false,
  textureId: FLOOR,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: r.tint,
}));

// ─── props from gg-demo ───
const props = [
  // Fungus Grotto — unlit but for the mushroom glow (darkvision half of the review)
  obj(/^acid_mushroom_/, 4.5, 4.5),
  obj(/^acid_mushroom_/, 7, 6.2, { rot: 1.1 }),
  obj(/^acid_mushroom_/, 5.2, 9.4, { rot: 2.4, scale: 0.8 }),
  obj(/^acid_mushroom_/, 11.2, 4.1, { rot: 4.2, scale: 1.15 }),
  obj(/^rock_2_/, 3.4, 7.2),
  obj(/^rock_1_/, 12.2, 10.3, { rot: 0.6 }),
  obj(/^clutter_webs_1_full/, 12.8, 3.2),

  // Plunder Nook — the goblins' loot pile
  obj(/^storage_barrel_1/, 16, 4),
  obj(/^storage_crates_1/, 19.3, 5),
  obj(/^sack_stack_1/, 22.2, 8.4, { rot: 0.4 }),
  obj(/^storage_keg/, 17.2, 9.5),
  obj(/^produce_barrel_cabbages/, 21.4, 3.2),
  obj(/^storage_crate_broken_1/, 15.4, 11, { rot: 2.9 }),

  // Chief's Den
  obj(/^bed_pattern_1_a/, 35, 4.4),
  obj(/^decoration_bear_skin/, 30, 6, { rot: 0.3 }),
  obj(/^clutter_skull_giant/, 29.6, 9.2),
  obj(/^chest_1_steel/, 36.4, 9.4, { rot: -0.2 }),
  obj(/^weapon_rack_1/, 25.4, 10.4),
  obj(/^light_brazier_1_a/, 26.2, 4.2),

  // Warren Hall — the fire circle
  obj(/^campfire_1x1/, 14, 18),
  obj(/^campfire_pot_cooking/, 15.3, 18.6, { rot: 0.7 }),
  obj(/^firewood_pile/, 12.6, 17.3, { rot: 2.1 }),
  obj(/^log_seat_1/, 13, 19.6, { rot: 0.9 }),
  obj(/^log_seat_2/, 15.6, 16.9, { rot: 3.6 }),
  obj(/^boulder_/, 4.8, 14.2),
  obj(/^rock_outcrop_/, 22.6, 22),
  obj(/^clutter_skull_human/, 8.2, 21.4, { rot: 1.9 }),
  obj(/^tunic_stack_1/, 6.5, 16.5, { rot: 0.2 }),

  // Web Gallery — unlit, everything webbed
  obj(/^spider_web_/, 32, 18),
  obj(/^clutter_webs_2_full/, 28.8, 13.2),
  obj(/^clutter_webs_3_full/, 36.6, 14.4),
  obj(/^clutter_webs_4_full/, 36.8, 22.6),
  obj(/^clutter_skull_human/, 34.8, 20.2, { rot: 4.4, scale: 0.9 }),
  obj(/^storage_crate_broken_2/, 27.8, 22.4, { rot: 0.8 }),

  // Entrance Tunnel
  obj(/^campfire_ring/, 6, 28),
  obj(/^bear_trap_/, 12.2, 27.2),
  obj(/^rock_small_1/, 17.4, 30.2),
  obj(/^clutter_broken_boards_1/, 3.6, 30.6, { rot: 1.3 }),

  // Hidden Vein — the payoff room
  obj(/^chest_2_gold/, 34, 28),
  obj(/^mystery_sack/, 30.4, 27.2, { rot: 0.5 }),
  obj(/^clutter_scales_gold/, 32.6, 29.4),
  obj(/^rock_outcrop_/, 25.6, 26.2, { rot: 2.2 }),
  obj(/^stairs_stone_short/, 22.6, 29.6),
];

// ─── lights: fire circle + den brazier + entrance ring + a faint fungus glow.
// Gallery and vein stay black — that's the darkvision/token-vision half.
const light = (id, name, x, y, radius, intensity, color) => ({
  id, name, childType: 'light', visible: true,
  color, radius, featherRadius: 2.5, intensity, falloff: 'quadratic',
  position: { x, y },
});
const lights = [
  light('light-hall-fire', 'Warren Hall Fire', 14, 18, 10.5, 1, '#ff9b52'),
  light('light-den-brazier', 'Chief Brazier', 26.2, 4.2, 8.5, 0.95, '#ffb877'),
  light('light-entrance-ring', 'Entrance Fire Ring', 6, 28, 7.5, 0.9, '#ff9b52'),
  light('light-storage-lamp', 'Nook Lantern', 19, 7, 6.5, 0.75, '#ffc38a'),
  light('light-grotto-glow', 'Fungus Glow', 7, 6.2, 5.5, 0.55, '#9fdc8a'),
];

const zones = [{
  id: 'zone-hidden-vein',
  name: 'Hidden Vein',
  childType: 'zone',
  visible: true,
  shape: { kind: 'rect', x: 20.5, y: 24.5, width: 17, height: 7 },
  blocksAutoExplore: true,
}];

const map = {
  version: '3.1',
  mapSettings: {
    name: 'Goblin Warren',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    // Underground: no sky keys, the fires carry the map. Dim, not black — the
    // dark rooms still owe their black to fog/vision, not to a crushed grade.
    ambientLight: '#4b4552',
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  customImages: {},
  layers: [
    {
      id: 'bg-goblin-warren',
      name: 'Background',
      type: 'background',
      visible: true,
      locked: false,
      opacity: 1,
      backgroundColor: '#0a0908',
      backgroundTexture: null,
      textureScale: 0.25,
      textureTint: '#ffffff',
      presetLock: false,
    },
    {
      id: 'dungeon-goblin-warren',
      name: 'Warren',
      type: 'dungeon',
      visible: true,
      locked: false,
      opacity: 1,
      mergedFloor: null,
      style: {
        floorColor: '#6f6455',
        wallColor: '#211d18',
        wallWidth: 0.5,
        shadowEnabled: true,
        shadowColor: '#3a332b',
        shadowOffset: { x: 0.35, y: 0.3 },
        shadowIntensity: 0.55,
        roughnessAmplitude: 0,
        lineWidth: 0.04,
        edgeTransitionWidth: 0.5,
        showEdgeTransitions: true,
        wallTextureSetId: 'GG_Fieldstone',
        // Darker, colder tint than the keep: masonry reading as raw rock.
        wallTextureTint: '#8a7f6e',
        defaultTextureId: FLOOR,
      },
      sublayerVisibility: { floor: true, grid: true, walls: true },
      standaloneWalls: walls,
      rooms: R.map((r) => ({
        id: r.id, name: r.name, boundary: r.boundary,
        centroid: r.centroid, area: r.area, isPathway: false,
      })),
      roomNameOverrides: Object.fromEntries(R.map((r) => [r.id, r.name])),
      children: [...floors, ...props, ...lights, ...doors, ...zones],
    },
  ],
};

const out = join(import.meta.dirname, '../session/testdata/goblin-warren.mapbuilder');
writeFileSync(out, JSON.stringify(map, null, 1));
console.log(`${out}\nrooms=${R.length} walls=${walls.length} doors=${doors.length} props=${props.length} lights=${lights.length}`);
