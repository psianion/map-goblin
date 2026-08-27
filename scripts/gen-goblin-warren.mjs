// Authors session/testdata/goblin-warren.mapbuilder — the cave demo, assembled
// the way the CaveRoomBuilder kit's own reference maps are: a SMOOTH CURVED
// outline with the wall pieces CHORD-WALKED along it. From a point P on the
// curve we take Q at chord distance = the piece's own joint span, drop the
// piece so its two joints land exactly on P and Q, and continue from Q — so
// consecutive pieces share endpoints (no overlap, no gap) and the turn spreads
// along the arc instead of piling up at a corner.
//
// Orientation is measured from the art, not guessed (scripts/cave/pieces.json,
// built by scripts/cave/measure-pieces.mjs): every piece is stored with its
// joints ordered so the VOID (the dark drop-shadow side) is on the LEFT of
// travel and the floor (the pale pebble side) on the right. The boundary rings
// are traced floor-on-the-right, so walking them forward puts the void on the
// left and the art lands the right way round. The old generator had the
// straights 180° out — dark rock shading indoors, pebbles out in the void.
//
// ponytail: one-shot generator, not a tool. Delete it if the map goes stale.
// ponytail: no rock island inside the cave (the reference has one) — a floor
// shape renders contours[0] only, so a hole would need a second shape kind.
// The tunnel graph is a tree for that reason. Add it when shapes take holes.

import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ─── the band walk: one copy, shared with the engine ───
// packages/core/src/engine/caveWalk.ts holds the chord walk, the arc fit and the
// piece mapping, because the canvas band editor re-lays a dragged stretch with
// the same rules and two copies would drift apart. Node reads a .ts file on its
// own from 22.18; older ones need a flag, so re-exec with it rather than making
// the command line remember. The import is dynamic because a static one is
// hoisted above this check and would blow up before it runs.
if (!process.features.typescript) {
  const { status } = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...process.argv.slice(1)],
    { stdio: 'inherit' },
  );
  process.exit(status ?? 1);
}
const { BAND_OUT, offsetCurve, placePiece, resampleClosed, tangentAt, walkClosed } = await import(
  '../packages/core/src/engine/caveWalk.ts'
);

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
    flipY: !!opts.flipY,
    visible: true,
  };
}

// ─── measured piece geometry (joints + turn, void always on the left) ───
// One copy, shared with the engine: the canvas edits this same band, so a
// measurement that differed between the two would let an edited stretch drift
// away from the stretch beside it. Handedness is already settled in the file
// (see packages/core/src/assets/caveWallKit.ts), so nothing is re-derived here.
const PIECES = JSON.parse(
  readFileSync(join(import.meta.dirname, '../packages/core/src/assets/caveWallKit.json'), 'utf8'),
);
const byPrefix = (p) => PIECES.filter((x) => x.key.startsWith(p));
const BAND_SET = [...byPrefix('wall_short_'), ...byPrefix('inside_bend_'), ...byPrefix('outside_bend_')];
const LEDGE_SET = byPrefix('ledge_1x');
if (!BAND_SET.length || !LEDGE_SET.length) throw new Error('caveWallKit.json is missing wall or ledge pieces');
// gg-demo carries one variant per length, so a long run repeats the same stones
// down the wall. Mirroring a straight along its LENGTH (flipY) leaves the void
// on the same side and gives a second face for free — the joints just swap ends.
// Bends can't do this: mirroring one turns it into the other family's shape.
const mirrored = (p) => ({
  ...p,
  jointsCells: [[p.jointsCells[1][0], -p.jointsCells[1][1]], [p.jointsCells[0][0], -p.jointsCells[0][1]]],
  flipY: true,
});
for (const p of [...BAND_SET, ...LEDGE_SET]) if (p.turnDeg === 0) (p.key.startsWith('ledge') ? LEDGE_SET : BAND_SET).push(mirrored(p));

// ─── seeded PRNG so the cave is stable run to run ───
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(11);
const TAU = Math.PI * 2;

const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const mul = (p, s) => [p[0] * s, p[1] * s];
const len = (p) => Math.hypot(p[0], p[1]);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const norm = (p) => { const l = len(p) || 1; return [p[0] / l, p[1] / l]; };
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

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
// Detection insets faces by the wall band, drifting the centroid a little — a
// .5-straddling coordinate then rounds to a different id and the name override
// misses. Chambers sit far apart, so claiming the whole ±1 rounding
// neighbourhood is safe and keeps the names layout-proof.
const idNeighborhood = (c) => {
  const ids = new Set();
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      ids.add(stableRoomId([Math.round(c[0]) + dx, Math.round(c[1]) + dy]));
  return [...ids];
};

// ─── the layout, in cells on a 60×48 grid. Chambers are lobed blobs (an
// ellipse with a few radial harmonics), tunnels are capsules along a polyline.
// Rock between two chambers is kept ≥2.4 cells thick — the band is ~1.5 cells, so
// anything thinner and the two bands eat each other. The tunnel graph is a
// TREE: a cycle would trap a rock island, and a floor shape can't hold a hole. ───
// A chamber is a UNION OF DISCS, not one lobed ellipse. That choice is doing
// real work: an ellipse of radius 5 turns ~55° across a 4-cell span, so every
// piece the tracer lays on it qualifies as a corner and the whole ring comes out
// as bends and 2-cell stones. A disc union gives what the kit's own maps have —
// long gentle arcs on the big discs (radius ≥7 keeps a 4-cell span under 35°),
// tight concave fillets where two discs meet (that is what the outside bends are
// FOR), and an outline nothing like an ellipse.
//
// The rooms sit far enough apart that every tunnel gets a stretch of bare
// corridor between the two chambers it joins — THAT neck is the boundary a
// player reads, and it is the only thing that stops seven rooms merging into one
// amoeba. Warren Hall is the hub (mouth, grotto, nook, gallery); Chief's Den
// hangs off the nook and the Hidden Vein off the gallery, which keeps the map
// inside 60×48 — a 300×240 ft cave, which is still a big evening.
//
// Every chamber is hand-shaped, not solved: different disc COUNTS and different
// radius RATIOS, because seven rooms cut to the same two radii read as machine
// output even when nobody can say why. Grotto is a lumpy trefoil, the hall a big
// disc pulled into a rough triangle, the nook a plain pear, the den a tight
// squarish cluster, the gallery a long oval, the mouth a narrow slot and the
// vein a small kidney.
const W = 60, H = 48;
const CHAMBERS = [
  { key: 'grotto',   name: 'Fungus Grotto', discs: [[9.0, 9.5, 6.8], [6.6, 15.4, 4.2], [14.8, 7.0, 4.9]] },
  { key: 'nook',     name: 'Plunder Nook',  discs: [[32.0, 9.0, 6.6], [27.4, 6.2, 4.0]] },
  { key: 'den',      name: "Chief's Den",   discs: [[50.0, 13.0, 6.5], [54.0, 9.6, 3.8], [54.0, 17.4, 3.4], [46.6, 8.2, 3.2]] },
  { key: 'hall',     name: 'Warren Hall',   discs: [[20.0, 26.0, 8.0], [22.5, 32.6, 5.6], [13.6, 26.8, 4.6]] },
  { key: 'gallery',  name: 'Web Gallery',   discs: [[40.0, 30.0, 7.0], [37.2, 23.4, 5.0], [36.4, 35.6, 4.4]] },
  { key: 'entrance', name: 'Cave Mouth',    discs: [[9.0, 40.0, 4.8], [5.4, 42.4, 3.4]] },
  { key: 'vein',     name: 'Hidden Vein',   discs: [[52.0, 40.0, 4.4], [48.6, 42.0, 3.5], [54.6, 35.4, 3.2]] },
];
if (W > 60 || H > 48) throw new Error(`${W}×${H} is past the 60×48 cap — a 5ft cell makes that an unrunnable cave`);
// A whisper of lobing on top, low harmonics only — the fine wobble of a cave
// edge lives inside the art, the placement only supplies the shape.
for (const ch of CHAMBERS) {
  ch.harm = [
    [2, 0.04 + rand() * 0.04, rand() * TAU],
    [3, 0.03 + rand() * 0.03, rand() * TAU],
  ];
  ch.c = [ch.discs[0][0], ch.discs[0][1]];
  ch.rMin = ch.discs[0][2];
}
const inChamber = (ch, p) =>
  ch.discs.some(([cx, cy, r]) => {
    const d = [p[0] - cx, p[1] - cy];
    let m = 1;
    const th = Math.atan2(d[1], d[0]);
    for (const [k, a, ph] of ch.harm) m += a * Math.cos(k * th + ph);
    return Math.hypot(d[0], d[1]) <= r * m;
  });
// Rock between two chambers must stay ≥2.4 cells: the band is ~1.5 cells thick,
// so anything thinner and the two walls eat each other. Fail loudly, not
// visually. The *1.09 term is the harmonic overshoot on a disc's radius.
for (let i = 0; i < CHAMBERS.length; i++)
  for (let j = i + 1; j < CHAMBERS.length; j++)
    for (const [ax, ay, ar] of CHAMBERS[i].discs)
      for (const [bx, by, br] of CHAMBERS[j].discs) {
        const gap = Math.hypot(ax - bx, ay - by) - (ar + br) * 1.09;
        if (gap < 2.4) throw new Error(`${CHAMBERS[i].key}/${CHAMBERS[j].key}: ${gap.toFixed(2)} cells of rock between them`);
      }
// Primary radius band. Below ~6.65 a 4-cell wall piece cannot sit inside its 35°
// turn gate and the room comes out as a picket fence of 2-cell stones; above 9
// the room buys nothing and just eats the 60×48 budget. The mouth and the vein
// are meant to read small, so they get their own band.
for (const ch of CHAMBERS) {
  const [lo, hi] = ch.key === 'entrance' || ch.key === 'vein' ? [4.0, 6.0] : [6.5, 9.0];
  if (ch.rMin < lo || ch.rMin > hi) throw new Error(`${ch.key}: primary disc r=${ch.rMin} outside ${lo}–${hi}`);
}
// Seven rooms cut from the same radii read as machine output — vary the shapes.
{
  const seen = new Map();
  for (const ch of CHAMBERS) {
    const sig = ch.discs.map((d) => d[2]).join('/');
    if (seen.has(sig)) throw new Error(`${ch.key} and ${seen.get(sig)} are the same shape (r=${sig})`);
    seen.set(sig, ch.key);
  }
}
// Every disc, overshoot included, stays 1.5 cells inside the grid.
for (const ch of CHAMBERS)
  for (const [x, y, r] of ch.discs) {
    const m = Math.min(x - r * 1.09, y - r * 1.09, W - (x + r * 1.09), H - (y + r * 1.09));
    if (m < 1.5) throw new Error(`${ch.key}: disc ${x},${y} r${r} is ${m.toFixed(2)} cells from the ${W}×${H} edge`);
  }

// door.at names the chamber whose mouth carries the door; the tunnel then
// belongs to the OTHER chamber's fog face. `hw` is a HALF width, so 1.15 is a
// 2.3-cell corridor — two tokens abreast, and visibly narrower than any room.
// The `via` bends each neck off the straight centre-to-centre line so six
// corridors don't all read as ruler lines drawn from the same hub.
const TUNNELS = [
  { key: 't-low',   name: 'Low Passage',   a: 'grotto', b: 'hall', hw: 1.15,
    via: [[13.34, 18.53]],
    door: { at: 'grotto', name: 'Low Passage', style: 'archway', state: 'open' } },
  { key: 't-mouth', name: 'Mouth Passage', a: 'entrance', b: 'hall', hw: 1.25,
    via: [[13.40, 32.14]],
    door: { at: 'hall', name: 'Mouth Passage', style: 'archway', state: 'open' } },
  { key: 't-store', name: 'Nook Tunnel',   a: 'nook', b: 'hall', hw: 1.05,
    via: [[27.14, 18.31]],
    door: { at: 'nook', name: 'Timber Door', style: 'single', state: 'closed' } },
  { key: 't-gate',  name: 'Old Working',   a: 'hall', b: 'gallery', hw: 1.2,
    via: [[29.73, 29.37]],
    door: { at: 'gallery', name: 'Old Gate', style: 'portcullis', state: 'closed' } },
  { key: 't-chief', name: 'Chief Steps',   a: 'nook', b: 'den', hw: 1.1,
    via: [[41.30, 9.63]],
    door: { at: 'den', name: 'Chief Door', style: 'double', state: 'closed' } },
  { key: 't-vein',  name: 'Cramped Crawl', a: 'gallery', b: 'vein', hw: 0.95,
    via: [[45.10, 36.08]],
    door: { at: 'gallery', name: 'Hidden Crack', style: 'single', state: 'closed', secret: true } },
];
const chamberOf = (k) => CHAMBERS.find((c) => c.key === k);
for (const t of TUNNELS) {
  t.owner = t.door.at === t.a ? t.b : t.a;
  t.path = [chamberOf(t.a).c, ...t.via, chamberOf(t.b).c];
}

/** nearest point on the tunnel polyline, plus arc offset from the `a` end */
function onPath(path, p) {
  let best = { d: Infinity, s: 0, t: [1, 0], q: p };
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const v = sub(b, a), L = len(v);
    const u = Math.max(0, Math.min(1, dot(sub(p, a), v) / (L * L)));
    const q = add(a, mul(v, u));
    const d = dist(p, q);
    if (d < best.d) best = { d, s: acc + u * L, t: norm(v), q };
    acc += L;
  }
  return best;
}
function pathPointAt(path, s) {
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const v = sub(b, a), L = len(v);
    if (acc + L >= s) {
      const u = (s - acc) / L;
      return { p: add(a, mul(v, u)), t: norm(v) };
    }
    acc += L;
  }
  const a = path[path.length - 2], b = path[path.length - 1];
  return { p: b, t: norm(sub(b, a)) };
}
const pathLen = (path) => {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) s += dist(path[i], path[i + 1]);
  return s;
};

// The door plane: walk out of the door chamber along the tunnel axis until the
// axis clears the blob, then step a little further so the door stands in open
// corridor. The raster is split on this plane, so the door chord is the exact
// seam between the two faces and comes out dead straight.
for (const t of TUNNELS) {
  const fromA = t.door.at === t.a;
  const total = pathLen(t.path);
  const doorCh = chamberOf(t.door.at);
  let s = null;
  for (let d = 0; d <= total; d += 0.05) {
    const at = fromA ? d : total - d;
    if (!inChamber(doorCh, pathPointAt(t.path, at).p)) { s = at; break; }
  }
  if (s === null) throw new Error(`tunnel ${t.key}: axis never leaves ${t.door.at}`);
  // Stand the door in the NECK — the stretch of axis outside BOTH chambers.
  // Testing only the door chamber and stepping a fixed 0.9 further lands inside
  // the far chamber wherever the two rooms sit close, and then the "door" spans
  // a whole lobe: t-chief measured 7.2 cells wide before this.
  const far = chamberOf(t.door.at === t.a ? t.b : t.a);
  const inNeck = (at) => !inChamber(doorCh, pathPointAt(t.path, at).p) && !inChamber(far, pathPointAt(t.path, at).p);
  let lo = null, hi = null;
  for (let d = 0; d <= total; d += 0.05) {
    const at = fromA ? d : total - d;
    if (inNeck(at)) { if (lo === null) lo = at; hi = at; }
    else if (lo !== null) break;
  }
  if (lo === null) throw new Error(`tunnel ${t.key}: no neck outside both chambers`);
  // MIDDLE of the neck, not one end of it. Near an end the cross-section ray
  // still reaches into the neighbouring lobe's floor, and the door comes out as
  // wide as the room: t-chief measured 7.2 cells standing 0.8 cells off the den.
  s = (lo + hi) / 2;
  const { p, t: tan } = pathPointAt(t.path, s);
  // plane normal points from the door chamber toward the far chamber
  t.plane = { p, n: fromA ? tan : mul(tan, -1) };
  const perp = [-tan[1], tan[0]];
  t.chord = { p1: add(p, mul(perp, t.hw + 0.55)), p2: sub(p, mul(perp, t.hw + 0.55)) };
}

// ─── layout gates. A neck is the only thing that tells a player where one room
// ends and the next begins, so measure it rather than trusting the picture:
// walk each tunnel axis and count the stretch that is outside BOTH chambers. ───
for (const t of TUNNELS) {
  if (t.hw > 1.25) throw new Error(`tunnel ${t.key}: hw ${t.hw} > 1.25 — a neck must read narrower than a room`);
  const ca = chamberOf(t.a), cb = chamberOf(t.b);
  for (const [near, far] of [[ca, cb], [cb, ca]])
    for (const [x, y] of near.discs)
      if (inChamber(far, [x, y])) throw new Error(`tunnel ${t.key}: a ${near.key} disc sits inside ${far.key}`);
  const total = pathLen(t.path);
  const step = 0.02;
  t.neck = 0;
  for (let s = 0; s < total; s += step) {
    const p = pathPointAt(t.path, s + step / 2).p;
    if (!inChamber(ca, p) && !inChamber(cb, p)) t.neck += step;
    for (const ch of CHAMBERS)
      if (ch !== ca && ch !== cb && inChamber(ch, p)) throw new Error(`tunnel ${t.key} runs through ${ch.key}`);
  }
  if (t.neck < 3) throw new Error(`tunnel ${t.key}: only ${t.neck.toFixed(2)} cells of neck between ${t.a} and ${t.b} (need 3.0)`);
  for (const [x, y] of t.path) {
    const m = Math.min(x - t.hw, y - t.hw, W - (x + t.hw), H - (y + t.hw));
    if (m < 1.5) throw new Error(`tunnel ${t.key}: path point ${x},${y} is ${m.toFixed(2)} cells from the ${W}×${H} edge`);
  }
}
// The graph must stay a TREE: a cycle traps a rock island, and a floor shape
// renders contours[0] only — it cannot hold a hole.
{
  const root = new Map(CHAMBERS.map((c) => [c.key, c.key]));
  const find = (k) => (root.get(k) === k ? k : (root.set(k, find(root.get(k))), root.get(k)));
  for (const t of TUNNELS) {
    const [ra, rb] = [find(t.a), find(t.b)];
    if (ra === rb) throw new Error(`tunnel ${t.key} closes a cycle — the graph must stay a tree`);
    root.set(ra, rb);
  }
  if (new Set(CHAMBERS.map((c) => find(c.key))).size !== 1) throw new Error('the tunnel graph is not connected');
}

const inTunnel = (t, p) => onPath(t.path, p).d <= t.hw;
/** which region owns a point: chamber key, or tunnel key past its door plane */
function regionAt(p) {
  for (const ch of CHAMBERS) if (inChamber(ch, p)) return ch.key;
  for (const t of TUNNELS) {
    if (!inTunnel(t, p)) continue;
    return dot(sub(p, t.plane.p), t.plane.n) >= 0 ? t.key : t.door.at;
  }
  return null;
}

// ─── raster at quarter-cell resolution: fine enough that the traced outline is
// a curve once smoothed, coarse enough to stay cheap ───
const SUB = 4;
const WS = W * SUB, HS = H * SUB;
const grid = Array.from({ length: HS }, () => new Array(WS).fill(null));
for (let y = 0; y < HS; y++)
  for (let x = 0; x < WS; x++)
    grid[y][x] = regionAt([(x + 0.5) / SUB, (y + 0.5) / SUB]);

const at = (x, y) => (x >= 0 && x < WS && y >= 0 && y < HS ? grid[y][x] : null);
const cellsOf = (id) => {
  const out = [];
  for (let y = 0; y < HS; y++) for (let x = 0; x < WS; x++) if (grid[y][x] === id) out.push([x, y]);
  return out;
};
for (const t of TUNNELS) {
  if (cellsOf(t.key).length === 0) throw new Error(`tunnel ${t.key} has no cells past its door`);
}
const isTunnel = (id) => TUNNELS.some((t) => t.key === id);
const faceOf = (id) => (id === null ? null : isTunnel(id) ? TUNNELS.find((t) => t.key === id).owner : id);

// ─── boundary rings: directed unit edges with the predicate region on the
// RIGHT of travel (so the void is on the LEFT — that is the side the art's
// drop shadow wants), chained with a right-turn preference so diagonal touches
// stay on one component. Coordinates come back in cells. ───
function ringsFor(pred) {
  const edges = new Map();
  const put = (from, to) => {
    const k = from.join(',');
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push({ from, to, used: false });
  };
  for (let y = 0; y < HS; y++) {
    for (let x = 0; x < WS; x++) {
      if (!pred(at(x, y))) continue;
      if (!pred(at(x, y - 1))) put([x, y], [x + 1, y]);
      if (!pred(at(x + 1, y))) put([x + 1, y], [x + 1, y + 1]);
      if (!pred(at(x, y + 1))) put([x + 1, y + 1], [x, y + 1]);
      if (!pred(at(x - 1, y))) put([x, y + 1], [x, y]);
    }
  }
  const rings = [];
  for (const list of edges.values()) {
    for (const start of list) {
      if (start.used) continue;
      const ring = [start.from];
      let cur = start;
      for (;;) {
        cur.used = true;
        const p = cur.to;
        if (p[0] === start.from[0] && p[1] === start.from[1]) break;
        ring.push(p);
        const d = sub(cur.to, cur.from);
        const prefs = [[-d[1], d[0]], d, [d[1], -d[0]]];
        const outs = (edges.get(p.join(',')) ?? []).filter((e) => !e.used);
        let next = null;
        for (const want of prefs) {
          next = outs.find((e) => e.to[0] - e.from[0] === want[0] && e.to[1] - e.from[1] === want[1]);
          if (next) break;
        }
        if (!next) throw new Error(`ring broke at ${p}`);
        cur = next;
      }
      if (ring.length > 12) rings.push(ring.map(([x, y]) => [x / SUB, y / SUB]));
    }
  }
  return rings;
}

// ─── turning the staircase into a curve ───
// (`resampleClosed` comes from caveWalk.ts — the band walk needs it too, and the
// floor and the wall have to agree on how the outline is sampled.)
function movingAvg(pts, halfWin) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, wsum = 0;
    for (let k = -halfWin; k <= halfWin; k++) {
      const w = halfWin + 1 - Math.abs(k);
      const p = pts[(i + k + n * 2) % n];
      sx += p[0] * w; sy += p[1] * w; wsum += w;
    }
    out[i] = [sx / wsum, sy / wsum];
  }
  return out;
}
/** staircase ring → smooth closed curve, densely and evenly sampled */
function smoothRing(ring) {
  let pts = resampleClosed(ring, 0.12);
  for (let i = 0; i < 3; i++) pts = movingAvg(pts, 6);
  return resampleClosed(pts, 0.1);
}
/** Douglas–Peucker on a closed curve — floors and walls share this output, so
 *  they can never disagree about where the cave edge is. */
function simplifyClosed(pts, tol) {
  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    keep[j] = true;
    if (j - i < 2) continue;
    const a = pts[i], b = pts[j];
    const v = sub(b, a), L = len(v) || 1;
    let worst = -1, wi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs(cross(v, sub(pts[k], a))) / L;
      if (d > worst) { worst = d; wi = k; }
    }
    if (worst > tol) { stack.push([i, wi], [wi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const caveCurves = ringsFor((id) => id !== null).map(smoothRing);
if (caveCurves.length !== 1) throw new Error(`expected one cave outline, got ${caveCurves.length}`);
const caveRings = caveCurves.map((c) => simplifyClosed(c, 0.1));

// ─── rooms: the fog faces (chamber + the tunnels hanging off its doorless
// mouths — the door chords are the only walls closing the faces) ───
const ROOMS = CHAMBERS.map((c) => {
  const rings = ringsFor((id) => faceOf(id) === c.key);
  if (rings.length !== 1) throw new Error(`face ${c.key}: expected 1 ring, got ${rings.length}`);
  const boundary = simplifyClosed(smoothRing(rings[0]), 0.14);
  const centroid = centroidOf(boundary);
  return { key: c.key, name: c.name, boundary, centroid, id: stableRoomId(centroid), area: Math.abs(signedArea(boundary)) };
});
const rid = (k) => ROOMS.find((r) => r.key === k).id;
if (new Set(ROOMS.map((r) => r.id)).size !== ROOMS.length) throw new Error('room id collision');

// ─── floor: one shape for the whole cave, uniform tint — the kit's reference
// maps have a single floor with the variety living in the texture, and one
// shape means no seam between neighbouring floors for the union to trip on ───
const FLOOR = `gg-demo:${pick(/^floor_small_/)}`;
const floors = caveRings.map((ring, i) => ({
  id: `floor-cave-${i}`,
  name: 'Warren Floor',
  childType: 'shape',
  visible: true,
  shapeType: 'polygon',
  contours: [ring],
  roughnessEnabled: false,
  textureId: FLOOR,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#7f7566',
}));

// ─── walls (invisible LOS under cave-natural): the cave outline, plus one
// chord wall per tunnel door ───
const walls = [];
let wallN = 0;
const wall = (points) => {
  const w = {
    id: `wall-${String(++wallN).padStart(3, '0')}`,
    points, wallType: 'normal', direction: 'both',
    color: '#1a1410', width: 0.5, roughness: 0,
  };
  walls.push(w);
  return w;
};
// The cave outline gets NO standalone wall. `resolveWalls` already emits one
// occluding wall per merged-floor-ring edge (shared/wallResolve.ts), so the
// floor shape carries the LOS boundary on its own. Authoring a second ring over
// the top produced two independent 250-point objects with nothing linking them:
// drag a floor vertex and the wall stayed put, drag a wall stone and the floor
// stayed put, and node editing missed the ringStoneDrag path that welds an edit
// back into the outline. The only standalone walls here are the door chords,
// which are genuinely not floor edges — they cut across open floor.

/** is `p` inside the drawn floor polygon (the thing room detection actually cuts) */
function inFloorPoly(p) {
  for (const ring of caveRings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
/** how far the floor reaches from `p` along `dir` before it hits rock */
function reachToRock(p, dir) {
  for (let d = 0; d < 6; d += 0.02) if (!inFloorPoly(add(p, mul(dir, d)))) return d;
  return 6;
}

const doors = [];
let doorN = 0;
for (const t of TUNNELS) {
  // Measure the opening instead of assuming it. The chord used to be the
  // tunnel's own half-width plus a fixed 0.55, which is a guess: where the
  // corridor capsule overlaps a chamber blob, or where smoothing pushed the
  // floor edge outward, the chord ended INSIDE the floor and its cut slab never
  // severed the neck — Plunder Nook and Chief's Den detected as one fused room
  // and the door between them bound that room to itself.
  // The WALL runs past the rock on both sides so it always cuts; the DOOR spans
  // only the opening, so its leaf matches the passage. The wall's overhang sits
  // inside rock, where it blocks nothing that rock was not already blocking.
  const tan = t.plane.n;
  const perp = [-tan[1], tan[0]];
  const dPos = reachToRock(t.plane.p, perp);
  const dNeg = reachToRock(t.plane.p, mul(perp, -1));
  const p1 = add(t.plane.p, mul(perp, dPos));
  const p2 = sub(t.plane.p, mul(perp, dNeg));
  const chord = sub(p2, p1);
  // A door is a doorway, not a room mouth. If the measured opening blows past
  // the corridor it was cut for, the plane is in the wrong place and the map
  // should say so rather than ship a seven-cell 'door'.
  if (len(chord) > 2 * t.hw + 1.4) {
    throw new Error(`tunnel ${t.key}: opening ${len(chord).toFixed(2)} cells wide, corridor is ${(2 * t.hw).toFixed(2)}`);
  }
  const gapWall = wall([add(t.plane.p, mul(perp, dPos + 0.6)), sub(t.plane.p, mul(perp, dNeg + 0.6))]);
  const d = t.door;
  doors.push({
    id: `door-${String(++doorN).padStart(2, '0')}-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: d.name,
    childType: 'door',
    visible: true,
    wallId: gapWall.id,
    position: mul(add(p1, p2), 0.5),
    angle: Math.atan2(chord[1], chord[0]),
    width: len(chord),
    style: d.style,
    state: d.state,
    isSecret: !!d.secret,
    roomA: rid(d.at),
    roomB: rid(t.owner),
  });
}

// ─── chord-walking a curve with the measured pieces ───
// The walk itself is packages/core/src/engine/caveWalk.ts (imported at the top):
// it answers with placements, and turning a placement into a map object is the
// only part that belongs to this generator.
/** drop a placed kit piece into `sink` as a map object */
const emit = (piece, at, sink) =>
  sink.push(obj(new RegExp(`^${piece.key}_`), at.position.x, at.position.y, {
    rot: at.rotation, scale: at.scale, flipY: at.flipY,
  }));

const band = [];
const bandStats = [];
for (const curve of caveCurves) {
  const walk = walkClosed(offsetCurve(curve, BAND_OUT), BAND_SET);
  for (const pl of walk.placed) emit(pl.piece, pl.at, band);
  bandStats.push(walk);
}

// ─── dressing: talus fans at the wall foot and fissures running between them,
// both straight off the kit's reference maps ───
const cracks = [];
const rubble = [];

const insideFloor = (p, margin) => {
  for (let a = 0; a < TAU; a += TAU / 8) {
    const q = add(p, [Math.cos(a) * margin, Math.sin(a) * margin]);
    if (at(Math.floor(q[0] * SUB), Math.floor(q[1] * SUB)) === null) return false;
  }
  return at(Math.floor(p[0] * SUB), Math.floor(p[1] * SUB)) !== null;
};
/** pull a point toward `home` until it clears the rock by `margin` */
function settle(p, home, margin) {
  let q = p;
  for (let i = 0; i < 40 && !insideFloor(q, margin); i++) q = add(q, mul(norm(sub(home, q)), 0.25));
  return q;
}
/**
 * The AREA centre of a chamber's floor, not its first disc's centre. A chamber
 * is a union of discs; anchoring dressing to disc 0 lands the whole room's
 * furniture in one lobe and leaves the rest empty, and it re-breaks every time
 * the layout moves a disc.
 */
const centreCache = new Map();
const chamberCentre = (k) => {
  if (!centreCache.has(k)) {
    const cells = cellsOf(k);
    centreCache.set(k, [
      cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length / SUB,
      cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length / SUB,
    ]);
  }
  return centreCache.get(k);
};

// Everything below is authored against the TRACED RING, not against a chamber
// centre. Talus is what falls off a wall, so it belongs to the wall: sampling
// open floor and hoping is what produced the confetti this replaces.

/** art's own size in cells, so a wanted size in cells becomes a scale factor */
const artSize = (re) => { const e = pack.entries[pick(re)]; return (e.frame.w + e.frame.h) / 400; };
const clump = (re, p, size) =>
  rubble.push(obj(re, p[0], p[1], { rot: rand() * TAU, scale: size / artSize(re) }));
// `insideFloor(p, 2)` does double duty below: true means the point has two clear
// cells all round, i.e. it is out in the open — so NOT-inside-at-2 is the test
// for "still hugging the rock".

const ring = caveCurves[0];
const RN = ring.length;
const RSTEP = dist(ring[0], ring[1]) || 0.1;
// One pile per ~6.2 cells of wall run. The reference alternates a 1.5–2.5 cell
// talus fan with 2–3 cells of clean stone, all the way round; that rhythm is
// the whole difference between "cave" and "generator output", and it also
// pins the clean gap between clusters inside its 2–8 cell window.
const STATION = 6.2;
const K = Math.round((RN * RSTEP) / STATION);
const stations = [];
for (let k = 0; k < K; k++) {
  const idx = (Math.round(((k + (rand() - 0.5) * 0.2) * RN) / K) + RN) % RN;
  const p0 = ring[idx];
  const tg = tangentAt(ring, idx);
  const inw = [-tg[1], tg[0]]; // floor is on the right of travel
  // Sit the pile against the rock, backing off toward the wall until it fits —
  // a tunnel wall has room for far less talus than a chamber wall. The depth
  // cap is load-bearing: past ~1 cell the nearest wall stops being the one the
  // pile fell off, and the talus starts reading as floor litter instead.
  const want = 0.45 + rand() * 0.45;
  let foot = null;
  for (let d = want; d >= 0.2; d -= 0.1) {
    const q = add(p0, mul(inw, d));
    if (insideFloor(q, 0.26)) { foot = q; break; }
  }
  if (!foot) foot = add(p0, mul(inw, 0.3));
  stations.push(foot);
  clump(rand() < 0.35 ? /^rubble_medium_/ : /^rubble_small_/, foot, 1.35 + rand() * 0.8);
  // a second, smaller fan beside the first — close enough to read as one pile
  if (rand() < 0.32) {
    const q = add(add(p0, mul(tg, (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.15))),
      mul(inw, 0.35 + rand() * 0.7));
    if (insideFloor(q, 0.2) && !insideFloor(q, 2)) clump(/^rubble_small_/, q, 1.2 + rand() * 0.35);
  }
}

// Floor cracks run pile to pile along the wall foot. Both blunt ends of the
// ledge art land under a talus fan, the chord's natural inward bow keeps the
// middle off the wall, and a chip of stone sits on the crack so nothing about
// it floats. Two of them lying near-parallel side by side read as tram lines,
// so a clashing one is dropped rather than nudged.
const degOf = (r) => ((((r * 180) / Math.PI) % 180) + 180) % 180;
for (let k = 0; k < stations.length; k++) {
  const A = stations[k], B = stations[(k + 1) % stations.length];
  if (rand() < 0.42) continue;
  const v = sub(B, A), L = len(v);
  if (L < 3.2 || L > 7.6) continue;
  let ok = true;
  for (let s = 1; s <= 5 && ok; s++) {
    const q = add(A, mul(v, s / 6));
    ok = insideFloor(q, 0.3) && !insideFloor(q, 2);
  }
  if (!ok) continue;
  const piece = LEDGE_SET
    .filter((p) => L / p.chordCells >= 0.85 && L / p.chordCells <= 1.25)
    .sort((a, b) => Math.abs(L - a.chordCells) - Math.abs(L - b.chordCells))[0];
  if (!piece) continue;
  emit(piece, placePiece(piece, A, B), cracks);
  const me = cracks[cracks.length - 1];
  const mid = [me.position.x, me.position.y];
  const clash = cracks.slice(0, -1).some((o) => {
    const ad = Math.abs(degOf(o.rotation) - degOf(me.rotation));
    return dist([o.position.x, o.position.y], mid) < 4.2 && Math.min(ad, 180 - ad) < 22;
  });
  if (clash) { cracks.pop(); continue; }
  const perp = norm([-v[1], v[0]]);
  clump(/^rubble_small_/, add(mid, mul(perp, (rand() < 0.5 ? -0.2 : 0.2))), 1.0 + rand() * 0.35);
}

// The one deliberate exception to "talus lives at the wall": a paired spoil
// heap out on the hall floor, the way the kit's own map drops two clumps in
// the open. Paired, sized, and the only rubble on the map past 2 cells.
{
  const c = chamberCentre('hall');
  clump(/^rubble_medium_/, add(c, [-1.0, 4.0]), 2.0);
  clump(/^rubble_small_/, add(c, [0.3, 4.9]), 1.45);
}

// ponytail: the Hidden Vein used to get a cave-dungeon adaptor and a long stone
// stair. Both are DUNGEON masonry — square, hard-edged, drawn to butt against
// built stonework — and dropped onto a natural cave floor with nothing built
// around them they read as exactly what they are: rectangles pasted on. The
// crawl's story is carried by its secret door and its no-auto-explore zone.
// Bring them back only alongside an actual worked-stone passage.

// ─── props: authored against chamber centres, then settled off the rock ───
const propAt = (re, ch, dx, dy, opts) => {
  const home = chamberCentre(ch);
  const p = settle(add(home, [dx, dy]), home, opts?.clear ?? 0.75);
  return obj(re, p[0], p[1], opts);
};
/** a prop leaned against one already placed — nothing in a lived-in cave stands
 *  on its own in clean floor, and a pair reads as placed rather than scattered */
const beside = (re, other, ch, dx, dy, opts) => {
  const p = settle([other.position.x + dx, other.position.y + dy], chamberCentre(ch), opts?.clear ?? 0.3);
  return obj(re, p[0], p[1], opts);
};

// The mushrooms are the map's ONE focal accent, so they are one bed, not four
// lime dots spread across a room — the glow has a source you can point at.
// Everything else that carried saturated paint was SWAPPED, not tinted: the
// chief's patterned bed, the nook's cabbages and keg and sack stack, the fire
// circle's log seats and the vein's gold all have unpainted cousins in the
// pack. A tint could not have done it — multiply only darkens, so a red bed
// under any tint is still a red bed. The hall fire keeps its colour: it is a
// light source, not decoration, and greying it out would cost the map its only
// warmth to win a number.
const shroom = propAt(/^acid_mushroom_/, 'grotto', -3.4, 2.5);
const denBed = propAt(/^bed_small_single_cot/, 'den', 0.9, -1.4);
const denRug = propAt(/^decoration_bear_skin/, 'den', -1.9, 1.2, { rot: 0.3 });
const webBig = propAt(/^spider_web_/, 'gallery', -0.8, -0.6);
const webSmall = propAt(/^clutter_webs_2_full/, 'gallery', -2.9, 1.9);
// The vein's hoard reads by silhouette — banded chest, strongbox, sack — not by
// chroma. It is an unlit secret room; the payoff is the door, not a gold sprite
// shouting across the map at the one accent that is supposed to carry it.
const veinChest = propAt(/^chest_classic_large_locked/, 'vein', 0.3, 0.2);
const props = [
  // Fungus Grotto — unlit but for the mushroom glow (the darkvision half)
  shroom,
  beside(/^acid_mushroom_/, shroom, 'grotto', 0.62, -0.34, { rot: 1.1 }),
  beside(/^acid_mushroom_/, shroom, 'grotto', -0.44, -0.58, { rot: 2.4, scale: 0.8 }),
  beside(/^acid_mushroom_/, shroom, 'grotto', 0.3, 0.56, { rot: 4.2, scale: 1.15 }),
  propAt(/^rock_2_/, 'grotto', -3.2, -1.6),
  propAt(/^rock_1_/, 'grotto', 2.6, 1.9, { rot: 0.6 }),
  propAt(/^clutter_webs_1_full/, 'grotto', 2.2, -2.6),

  // Plunder Nook — the goblins' loot pile
  propAt(/^storage_barrel_1/, 'nook', -3.0, -1.2),
  propAt(/^storage_crates_1/, 'nook', -0.3, -0.6),
  propAt(/^sack_pile_kitchen/, 'nook', 1.6, 1.4, { rot: 0.4 }),
  propAt(/^storage_barrel_5_a_dark/, 'nook', -2.9, 1.2),
  propAt(/^storage_crates_2_dark/, 'nook', -0.7, -1.9),
  propAt(/^storage_crate_broken_1/, 'nook', -3.6, 0.4, { rot: 2.9 }),

  // Chief's Den
  denBed,
  beside(/^chest_1_steel/, denBed, 'den', 1.25, 0.6, { rot: -0.2 }),
  denRug,
  beside(/^clutter_skull_giant/, denRug, 'den', 0.95, 0.6),
  propAt(/^weapon_rack_1/, 'den', -2.6, -1.6),
  propAt(/^light_brazier_1_a/, 'den', 0.6, 3.0),

  // Warren Hall — the fire circle
  propAt(/^campfire_1x1/, 'hall', -1.2, -0.9),
  propAt(/^campfire_pot_cooking/, 'hall', 0.2, -0.3, { rot: 0.7 }),
  propAt(/^firewood_pile/, 'hall', -2.5, -1.7, { rot: 2.1 }),
  propAt(/^chair_stool_1_dark/, 'hall', -2.2, 0.7, { rot: 0.9 }),
  propAt(/^chair_stool_2_dark/, 'hall', 0.5, -2.1, { rot: 3.6 }),
  propAt(/^boulder_/, 'hall', -5.0, -3.0),
  propAt(/^rock_outcrop_/, 'hall', 3.4, 2.6),

  // Web Gallery — unlit, everything webbed
  webBig,
  beside(/^clutter_skull_human/, webBig, 'gallery', 1.15, 0.5, { rot: 4.4, scale: 0.9 }),
  webSmall,
  beside(/^storage_barrel_broken_dark/, webSmall, 'gallery', 0.85, 0.4, { rot: 0.8 }),
  propAt(/^clutter_webs_3_full/, 'gallery', 1.8, -2.2),
  propAt(/^clutter_webs_4_full/, 'gallery', 1.3, 2.4),

  // Cave Mouth
  propAt(/^campfire_ring/, 'entrance', 0.4, 0.1),
  propAt(/^bear_trap_/, 'entrance', 1.1, 2.3),
  propAt(/^rock_small_1/, 'entrance', -0.6, 2.7),
  propAt(/^clutter_broken_boards_1/, 'entrance', 0.7, -2.2, { rot: 1.3 }),

  // Hidden Vein — the payoff room
  veinChest,
  beside(/^sack_single_kitchen/, veinChest, 'vein', 0.52, 0.34, { rot: 0.5 }),
  beside(/^chest_lockbox_2_wood/, veinChest, 'vein', -0.66, 0.42),
  propAt(/^rock_outcrop_/, 'vein', -3.2, 0.6, { rot: 2.2 }),
];

// ─── lights: fire circle + den brazier + entrance ring + a faint fungus glow.
// Gallery and vein stay black — that's the darkvision/token-vision half. ───
const posOf = (name) => {
  const p = props.find((x) => x.assetId.includes(name));
  if (!p) throw new Error(`no prop matching ${name} to light`);
  return p.position;
};
const light = (id, name, at, radius, intensity, color) => ({
  id, name, childType: 'light', visible: true,
  color, radius, featherRadius: 2.5, intensity, falloff: 'quadratic',
  position: { x: at.x, y: at.y },
});
const lights = [
  light('light-hall-fire', 'Warren Hall Fire', posOf('campfire_1x1'), 10.5, 1, '#ff9b52'),
  light('light-den-brazier', 'Chief Brazier', posOf('light_brazier_1_a'), 8.5, 0.95, '#ffb877'),
  light('light-entrance-ring', 'Cave Mouth Fire Ring', posOf('campfire_ring'), 7.5, 0.9, '#ff9b52'),
  light('light-nook-lamp', 'Nook Lantern', { x: chamberOf('nook').c[0], y: chamberOf('nook').c[1] }, 6.5, 0.75, '#ffc38a'),
  light('light-grotto-glow', 'Fungus Glow', posOf('acid_mushroom_'), 5.5, 0.55, '#9fdc8a'),
];

// zone room matching goes by bbox — keep the rect clear of every other face
const veinBox = (() => {
  const cells = cellsOf('vein');
  const xs = cells.map((c) => c[0] / SUB), ys = cells.map((c) => c[1] / SUB);
  const x = Math.min(...xs) - 1.5, y = Math.min(...ys) - 1.5;
  return { kind: 'rect', x, y, width: Math.max(...xs) - x + 2, height: Math.max(...ys) - y + 2 };
})();
const zones = [{
  id: 'zone-hidden-vein',
  name: 'Hidden Vein',
  childType: 'zone',
  visible: true,
  shape: veinBox,
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
      // cave-natural: no wall texture set — walls are invisible LOS geometry,
      // the painted band is the visible cave wall. Wide edge transitions fake
      // the kit's baked floor shading along the walls.
      style: {
        floorColor: '#7a6a58',
        wallColor: '#1a1410',
        wallWidth: 0.5,
        shadowEnabled: true,
        shadowColor: '#2a2018',
        shadowOffset: { x: 0.5, y: 0.4 },
        shadowIntensity: 0.6,
        roughnessAmplitude: 0,
        lineWidth: 0.04,
        edgeTransitionWidth: 1.1,
        showEdgeTransitions: true,
        wallTextureTint: '#ffffff',
        defaultTextureId: FLOOR,
        // The band rides BAND_OUT past the traced curve and its rock is a cell or
        // two thick, so the floor edge sits well under the art. Painting the floor
        // out to meet it means a shortfall anywhere in the band reveals more floor
        // rather than a hairline of void.
        floorBleed: 0.45,
      },
      sublayerVisibility: { floor: true, grid: true, walls: true },
      standaloneWalls: walls,
      rooms: ROOMS.map((r) => ({
        id: r.id, name: r.name, boundary: r.boundary,
        centroid: r.centroid, area: r.area, isPathway: false,
      })),
      roomNameOverrides: Object.fromEntries(
        ROOMS.flatMap((r) => idNeighborhood(r.centroid).map((id) => [id, r.name])),
      ),
      // cracks under the band (they vanish beneath the wall), rubble and props on top
      children: [...floors, ...cracks, ...band, ...rubble, ...props, ...lights, ...doors, ...zones],
    },
  ],
};

const out = join(import.meta.dirname, '../session/testdata/goblin-warren.mapbuilder');
writeFileSync(out, JSON.stringify(map, null, 1));
const pieceCount = band.reduce((m, b) => { const k = b.assetId.split(':')[1].replace(/_object_A$/, ''); m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log(`${out}
rooms=${ROOMS.length} walls=${walls.length} doors=${doors.length} band=${band.length} cracks=${cracks.length} rubble=${rubble.length} props=${props.length}
ring pts=${caveRings.map((r) => r.length).join(',')} closing stretch=${bandStats.map((s) => s.stretch.toFixed(2)).join(',')}
band mix: ${Object.entries(pieceCount).sort().map(([k, v]) => `${k}×${v}`).join(' ')}`);
const allHoles = bandStats.flatMap((s) => s.holes ?? []);
if (allHoles.length) {
  console.log(`\nBAND HOLES (${allHoles.length}) — rock the walk never laid, floor shows through to the void:`);
  for (const h of allHoles) console.log(`  ${h.gap} cells at ${h.at}  ${h.from} → ${h.to}`);
}
