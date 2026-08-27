// Mechanical measurement of CaveRoomBuilder wall-art pieces: locates the two
// butt-joint points on each piece's bounding box, the void/floor sides, and
// the signed turn of the rock band between the joints. No design decisions.
import sharp from 'file:///D:/Labs/map-goblin/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC_DIR = 'D:/Labs/test-asset-sets/processed';
const OUT_JSON = 'D:/Labs/map-goblin/packages/core/src/assets/caveWallKit.json';
const OUT_IMG =
  'C:/Users/excer/AppData/Local/Temp/claude/D--Labs-map-goblin/4ccbbbdd-d304-466b-9532-7b63fb4292ef/scratchpad/cave/joints.png';
const CELL = 200;
const STRIP = 6;
const COVERAGE_THRESHOLD = 0.12;

const PIECES = [
  ['Wall, short (2x2).png', 'wall_short_2x2'],
  ['Wall, short (2x4).png', 'wall_short_2x4'],
  ['Wall, short (2x6).png', 'wall_short_2x6'],
  ['Inside bend (2x2).png', 'inside_bend_2x2'],
  ['Inside bend (3x2).png', 'inside_bend_3x2'],
  ['Inside bend (3x3).png', 'inside_bend_3x3'],
  ['Inside bend (4x4).png', 'inside_bend_4x4'],
  ['Inside bend (5x3).png', 'inside_bend_5x3'],
  ['Outside bend (2x2).png', 'outside_bend_2x2'],
  ['Outside bend (3x2).png', 'outside_bend_3x2'],
  ['Outside bend (3x3).png', 'outside_bend_3x3'],
  ['Outside bend (4x4).png', 'outside_bend_4x4'],
  ['Outside bend (5x3).png', 'outside_bend_5x3'],
  ['Outside bend (5x5).png', 'outside_bend_5x5'],
  ['Ledge (1x2).png', 'ledge_1x2'],
  ['Ledge (1x4).png', 'ledge_1x4'],
  ['Ledge (1x6).png', 'ledge_1x6'],
];

// Edge inward/outward unit normals in y-down screen space.
const NORMALS = {
  top: { inward: [0, 1], outward: [0, -1] },
  bottom: { inward: [0, -1], outward: [0, 1] },
  left: { inward: [1, 0], outward: [-1, 0] },
  right: { inward: [-1, 0], outward: [1, 0] },
};

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

async function loadPixels(file) {
  const raw = await sharp(`${SRC_DIR}/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw.data, w: raw.info.width, h: raw.info.height };
}

function classify(data, i) {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const rock = a > 170;
  const shadow = a > 25 && a <= 170 && lum < 100;
  const pebble = a > 200 && lum > 115;
  return { rock, shadow, pebble };
}

// Accumulate rock centroid + coverage for one edge strip.
function edgeStrip(data, w, h, edge) {
  let x0, x1, y0, y1;
  if (edge === 'top') { x0 = 0; x1 = w; y0 = 0; y1 = STRIP; }
  else if (edge === 'bottom') { x0 = 0; x1 = w; y0 = h - STRIP; y1 = h; }
  else if (edge === 'left') { x0 = 0; x1 = STRIP; y0 = 0; y1 = h; }
  else { x0 = w - STRIP; x1 = w; y0 = 0; y1 = h; }

  let rockCount = 0, sx = 0, sy = 0;
  const total = (x1 - x0) * (y1 - y0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (classify(data, i).rock) {
        rockCount++;
        sx += x;
        sy += y;
      }
    }
  }
  const coverage = rockCount / total;
  const point = rockCount > 0 ? [sx / rockCount, sy / rockCount] : [(x0 + x1) / 2, (y0 + y1) / 2];
  return { edge, coverage, rockCount, point };
}

function wholeImageCentroid(data, w, h, kind) {
  let count = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (classify(data, i)[kind]) {
        count++;
        sx += x;
        sy += y;
      }
    }
  }
  return count > 0 ? { point: [sx / count, sy / count], count } : { point: null, count: 0 };
}

function toCellsRel(px, py, wPx, hPx) {
  return [(px - wPx / 2) / CELL, (py - hPx / 2) / CELL];
}

const warnings = [];
const results = [];

for (const [file, key] of PIECES) {
  const { data, w, h } = await loadPixels(file);
  const isBend = key.includes('bend');

  const edges = ['top', 'bottom', 'left', 'right'].map((e) => edgeStrip(data, w, h, e));
  let crossing = edges.filter((e) => e.coverage > COVERAGE_THRESHOLD);

  if (crossing.length !== 2) {
    const cov = edges.map((e) => `${e.edge}=${(e.coverage * 100).toFixed(1)}%`).join(', ');
    warnings.push(
      `${key}: edge-crossing detection found ${crossing.length} edges (${cov}) — using fallback.`
    );
    if (!isBend) {
      // Two short edges: whichever pair (top/bottom vs left/right) has the shorter run length.
      crossing = w <= h ? edges.filter((e) => e.edge === 'top' || e.edge === 'bottom')
                         : edges.filter((e) => e.edge === 'left' || e.edge === 'right');
    } else {
      crossing = [...edges].sort((a, b) => b.coverage - a.coverage).slice(0, 2);
    }
  }

  const [A, B] = crossing;
  const voidRaw = wholeImageCentroid(data, w, h, 'shadow');
  const floorRaw = wholeImageCentroid(data, w, h, 'pebble');
  if (voidRaw.count === 0) warnings.push(`${key}: no shadow pixels found for void centroid.`);
  if (floorRaw.count === 0) warnings.push(`${key}: no pebble pixels found for floor centroid.`);
  const voidPx = voidRaw.point ?? [w / 2, h / 2];
  const floorPx = floorRaw.point ?? [w / 2, h / 2];

  // Order A,B so the void sits on the LEFT of travel from joint0 -> joint1.
  const mid = [(A.point[0] + B.point[0]) / 2, (A.point[1] + B.point[1]) / 2];
  const d = [B.point[0] - A.point[0], B.point[1] - A.point[1]];
  const toVoid = [voidPx[0] - mid[0], voidPx[1] - mid[1]];
  const s = cross(d, toVoid);
  const [j0, j1] = s < 0 ? [A, B] : [B, A];

  // Re-check after ordering (should always be left now).
  const d2 = [j1.point[0] - j0.point[0], j1.point[1] - j0.point[1]];
  const mid2 = [(j0.point[0] + j1.point[0]) / 2, (j0.point[1] + j1.point[1]) / 2];
  const toVoid2 = [voidPx[0] - mid2[0], voidPx[1] - mid2[1]];
  const s2 = cross(d2, toVoid2);
  if (s2 >= 0) warnings.push(`${key}: void-on-left ordering failed to hold after swap (s=${s2.toFixed(2)}).`);

  const dir0 = NORMALS[j0.edge].inward;
  const dir1 = NORMALS[j1.edge].outward;
  const turnDeg = (Math.atan2(cross(dir0, dir1), dot(dir0, dir1)) * 180) / Math.PI;

  const j0Cells = toCellsRel(j0.point[0], j0.point[1], w, h);
  const j1Cells = toCellsRel(j1.point[0], j1.point[1], w, h);
  const chordCells = Math.hypot(j1Cells[0] - j0Cells[0], j1Cells[1] - j0Cells[1]);
  const voidCentroidCells = toCellsRel(voidPx[0], voidPx[1], w, h);
  const floorCentroidCells = toCellsRel(floorPx[0], floorPx[1], w, h);

  results.push({
    key,
    file,
    wPx: w,
    hPx: h,
    wCells: w / CELL,
    hCells: h / CELL,
    joints: [
      [Math.round(j0.point[0] * 1000) / 1000, Math.round(j0.point[1] * 1000) / 1000],
      [Math.round(j1.point[0] * 1000) / 1000, Math.round(j1.point[1] * 1000) / 1000],
    ],
    jointsCells: [
      [Math.round(j0Cells[0] * 1000) / 1000, Math.round(j0Cells[1] * 1000) / 1000],
      [Math.round(j1Cells[0] * 1000) / 1000, Math.round(j1Cells[1] * 1000) / 1000],
    ],
    chordCells: Math.round(chordCells * 1000) / 1000,
    turnDeg: Math.round(turnDeg * 100) / 100,
    voidCentroidCells: [Math.round(voidCentroidCells[0] * 1000) / 1000, Math.round(voidCentroidCells[1] * 1000) / 1000],
    floorCentroidCells: [Math.round(floorCentroidCells[0] * 1000) / 1000, Math.round(floorCentroidCells[1] * 1000) / 1000],
    voidSide: 'left',
    // internal, not part of the documented schema but handy for the render pass below
    _voidPx: voidPx,
    _floorPx: floorPx,
    _isBend: isBend,
  });
}

// --- verify the three known-good statements -----------------------------
const verifyLines = [];
for (const r of results) {
  const [vx, vy] = r.voidCentroidCells;
  const [fx, fy] = r.floorCentroidCells;
  if (r.key.startsWith('wall_short') || r.key.startsWith('ledge')) {
    const ok = vx < 0 && fx > 0;
    verifyLines.push(`${r.key}: void -x / floor +x? ${ok ? 'OK' : `FAIL void=(${vx},${vy}) floor=(${fx},${fy})`}`);
  } else if (r.key.startsWith('inside_bend')) {
    const ok = vx < 0 && vy < 0 && fx > 0 && fy > 0;
    verifyLines.push(`${r.key}: void NW / floor SE? ${ok ? 'OK' : `FAIL void=(${vx},${vy}) floor=(${fx},${fy})`}`);
  } else if (r.key.startsWith('outside_bend')) {
    const ok = vx < 0 && vy > 0 && fx > 0 && fy < 0;
    verifyLines.push(`${r.key}: void SW / floor NE? ${ok ? 'OK' : `FAIL void=(${vx},${vy}) floor=(${fx},${fy})`}`);
  }
}

// --- write JSON (strip internal fields) ----------------------------------
const publicResults = results.map(({ _voidPx, _floorPx, _isBend, ...rest }) => rest);

// Handedness is a property of the FAMILY, not of a per-piece pixel guess: an inside
// bend IS the convex floor corner (walking void-on-left that is a right turn, void
// off the NW of the art) and an outside bend the concave one. The void-centroid
// measurement above mis-reads on three pieces whose floor side carries a dark
// decorative crack, so re-order those joints from the family. Settled here, at
// measurement time, because both the generator and the canvas band editor read this
// file — deriving it separately in each is how the two would drift apart.
for (const r of publicResults) {
  const want = r.key.startsWith('inside_bend') ? 90 : r.key.startsWith('outside_bend') ? -90 : 0;
  if (want && Math.sign(r.turnDeg) !== Math.sign(want)) {
    r.jointsCells = [r.jointsCells[1], r.jointsCells[0]];
    r.joints = [r.joints[1], r.joints[0]];
    r.turnDeg = -r.turnDeg;
  }
}

writeFileSync(OUT_JSON, JSON.stringify(publicResults, null, 2) + '\n');

// --- verification image ---------------------------------------------------
const scale = 90 / CELL;
const maxWidth = 1900;
const pad = 24;
const labelH = 18;
let x = pad, y = pad, rowH = 0;
const placements = [];
for (const p of results) {
  const dispW = p.wPx * scale;
  const dispH = p.hPx * scale;
  const cellW = dispW + pad;
  const cellH = dispH + labelH + pad;
  if (x + cellW > maxWidth && x > pad) {
    x = pad;
    y += rowH;
    rowH = 0;
  }
  placements.push({ p, x, y: y + labelH, dispW, dispH });
  x += cellW;
  rowH = Math.max(rowH, cellH);
}
const totalWidth = maxWidth;
const totalHeight = y + rowH + pad;

function arrowSvg(x1, y1, x2, y2, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 7;
  const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"/>
    <polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${color}"/>`;
}

const pieceSvgs = placements
  .map(({ p, x, y, dispW, dispH }) => {
    const b64 = readFileSync(`${SRC_DIR}/${p.file}`).toString('base64');
    const j0 = [x + p.joints[0][0] * scale, y + p.joints[0][1] * scale];
    const j1 = [x + p.joints[1][0] * scale, y + p.joints[1][1] * scale];
    const voidPt = [x + p._voidPx[0] * scale, y + p._voidPx[1] * scale];
    const mid = [(j0[0] + j1[0]) / 2, (j0[1] + j1[1]) / 2];
    const dir = [voidPt[0] - mid[0], voidPt[1] - mid[1]];
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const arrowLen = 28;
    const tip = [mid[0] + (dir[0] / len) * arrowLen, mid[1] + (dir[1] / len) * arrowLen];
    return `
    <text x="${x}" y="${y - 5}" font-size="11" font-family="monospace" fill="black">${p.key}</text>
    <image href="data:image/png;base64,${b64}" x="${x}" y="${y}" width="${dispW}" height="${dispH}"/>
    <line x1="${j0[0]}" y1="${j0[1]}" x2="${j1[0]}" y2="${j1[1]}" stroke="black" stroke-width="1.5"/>
    ${arrowSvg(mid[0], mid[1], tip[0], tip[1], 'magenta')}
    <circle cx="${j0[0]}" cy="${j0[1]}" r="5" fill="green"/>
    <circle cx="${j1[0]}" cy="${j1[1]}" r="5" fill="red"/>`;
  })
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">
  <rect width="100%" height="100%" fill="white"/>
  ${pieceSvgs}
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUT_IMG);

// --- report -----------------------------------------------------------
console.log('Wrote', OUT_JSON);
console.log('Wrote', OUT_IMG);
console.log('\nkey\tchordCells\tturnDeg\tvoidSide');
for (const r of publicResults) {
  console.log(`${r.key}\t${r.chordCells}\t${r.turnDeg}\t${r.voidSide}`);
}
if (warnings.length) {
  console.log('\nWARNINGS:');
  for (const w of warnings) console.log(' - ' + w);
} else {
  console.log('\nNo fallback warnings.');
}
console.log('\nVERIFY:');
for (const l of verifyLines) console.log(' - ' + l);
