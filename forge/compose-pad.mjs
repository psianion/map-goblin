// Compose padded Fieldstone pieces from approved strip texture — the general
// form of compose-corner.mjs. Each piece is a set of ARMS radiating from a
// junction anchor; a pixel belongs to the arm it sits deepest along (max u),
// with a feathered blend where two arms tie — for two perpendicular arms this
// IS the 45deg picture-frame miter, and it generalizes to T / X / 45deg diag.
// Strip TOP (highlight edge) always maps to the piece's up/left-facing side.
// Free arm ends get CAP INK: the source's thinned ink plane min-composited
// inside per-piece cap rects. Source alpha applied verbatim.
// node compose-pad.mjs --piece <name> --out <png>   (see PIECES table)
import fs from 'fs';
import { sharp, loadRaw, lum, percentiles, arg } from './lib.mjs';

const SRC = 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A';
const S555 = 'staging/stage4/cutsrc/cutsrc2-s555.png';
const S777 = 'staging/stage4/cutsrc/cutsrc2-s777.png';
const FEATHER = 10, INK = 70;

const DIRS = {
  E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1],
  SW: [-Math.SQRT1_2, Math.SQRT1_2], NE: [Math.SQRT1_2, -Math.SQRT1_2],
  SE: [Math.SQRT1_2, Math.SQRT1_2], NW: [-Math.SQRT1_2, -Math.SQRT1_2],
};

// arms: dir + strip window x (134px+ windows picked for calm texture), or
// ['ARC', strip, wx, {cx, cy, r0, r1}] — quarter-annulus polar remap (strip
// length -> arc angle, strip rows -> radius, highlight lands on the outer rim);
// caps: rects (x,y,w,h) in source coords where source ink is re-applied
const PIECES = {
  'corner-A': { src: 'Corner_A_1x1', arms: [['E', S555, 228], ['S', S777, 364]], caps: [[146, 56, 30, 88], [56, 146, 88, 30]] },
  'corner-B': { src: 'Corner_B_1x1', arms: [['E', S777, 20], ['S', S555, 430]], caps: [[146, 56, 30, 88], [56, 146, 88, 30]] },
  'corner-C': { src: 'Corner_C_1x1', arms: [['E', S555, 228], ['S', S777, 364]], caps: [] },
  'corner-D': { src: 'Corner_D_1x1', arms: [['E', S777, 150], ['S', S555, 60]], caps: [] },
  'corner-E': { src: 'Corner_E_1x1', arms: [['ARC', S555, 440, { cx: 200, cy: 200, r0: 66, r1: 134 }]], caps: [] },
  'corner-F': { src: 'Corner_F_2x2', arms: [['ARC', S555, 0, { cx: 400, cy: 400, r0: 166, r1: 234 }]], caps: [] },
  'corner-G': { src: 'Corner_G_2x2', arms: [['ARC', S777, 120, { cx: 400, cy: 400, r0: 266, r1: 334 }]], caps: [] },
  'corner-H': { src: 'Corner_H_3x3', arms: [['ARC', S555, 300, { cx: 600, cy: 600, r0: 366, r1: 434 }]], caps: [] },
  'joint-A': { src: 'Joint_A_1x1', arms: [['E', S555, 100], ['W', S777, 300], ['N', S555, 400], ['S', S777, 40]], caps: [[140, 56, 30, 88], [30, 56, 30, 88], [56, 26, 88, 30], [56, 140, 88, 30]] },
  'joint-B': { src: 'Joint_B_1x1', arms: [['E', S777, 430], ['W', S555, 20], ['S', S555, 300]], caps: [[140, 56, 30, 88], [30, 56, 30, 88], [56, 140, 88, 30]] },
  'joint-C': { src: 'Joint_C_1x1', arms: [['E', S555, 160], ['W', S777, 220], ['N', S777, 100], ['S', S555, 440]], caps: [] },
  'joint-D': { src: 'Joint_D_1x1', arms: [['E', S777, 60], ['W', S555, 380], ['S', S777, 460]], caps: [] },
  'diag': { src: 'Connector_DIAG_A_1x1', arms: [['E', S555, 130], ['SW', S777, 200]], caps: [[144, 56, 26, 88], [6, 138, 62, 54]] },
  'ending': { src: 'Ending_A_1x1', arms: [['E', S555, 466]], caps: [[130, 56, 26, 88]] },
  'connector-A': { src: 'Connector_A_1x1', arms: [['E', S777, 250]], caps: [] },
  'connector-B': { src: 'Connector_B_1x1', arms: [['E', S555, 26]], caps: [] },
};

const name = arg('piece'), out = arg('out');
const cfg = PIECES[name];
if (!cfg) { console.error('unknown piece', name); process.exit(1); }

const { data: srcData, w, h } = await loadRaw(`${SRC}/Wall_Stone_Earthy_A_${cfg.src}.png`);
const strips = {};
for (const [, s] of cfg.arms.map(a => [a[0], a[1]])) if (!strips[s]) strips[s] = await loadRaw(s);

const ANCHOR = [100, 100], BANDC = 100; // band center row in strips

// bilinear sample with alpha-aware clamp toward the band center
const sampleStrip = (st, fx, fy) => {
  fx = ((fx % st.w) + st.w) % st.w; // strips wrap-tile by construction
  for (let tries = 0; tries < 40; tries++) {
    const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(st.h - 2, Math.floor(fy)));
    const x1 = (x0 + 1) % st.w, tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * st.w + x0) * 4, i01 = (y0 * st.w + x1) * 4;
    const i10 = ((y0 + 1) * st.w + x0) * 4, i11 = ((y0 + 1) * st.w + x1) * 4;
    if (Math.min(st.data[i00 + 3], st.data[i01 + 3], st.data[i10 + 3], st.data[i11 + 3]) >= 128) {
      const v = (i, c) => st.data[i + c];
      return [0, 1, 2].map(c =>
        (v(i00, c) * (1 - tx) + v(i01, c) * tx) * (1 - ty) + (v(i10, c) * (1 - tx) + v(i11, c) * tx) * ty);
    }
    fy += fy < BANDC ? 1 : -1; // chip overhang: pull toward band interior
  }
  return [160, 160, 160];
};

const base = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const o = (y * w + x) * 4;
  base[o + 3] = srcData[o + 3];
  if (srcData[o + 3] < 8) continue;
  const px = x - ANCHOR[0], py = y - ANCHOR[1];
  // per-arm depth u + sample
  const cand = cfg.arms.map(([dk, sPath, wx, arc]) => {
    if (dk === 'ARC') {
      const ax = x - arc.cx, ay = y - arc.cy;
      const r = Math.hypot(ax, ay);
      // quarter sweep from due-west (theta 0) to due-north (theta 1)
      const th = Math.max(0, Math.min(1, Math.atan2(-ay, -ax) / (Math.PI / 2)));
      const mid = (arc.r0 + arc.r1) / 2;
      return { u: 1e6, st: strips[sPath], fx: wx + th * (Math.PI / 2) * mid, fy: BANDC - 34 + (arc.r1 - r) };
    }
    const [dx, dy] = DIRS[dk];
    let [nx, ny] = [dy, -dx]; // rot90cw
    if (nx + ny < 0) { nx = -nx; ny = -ny; } // shade side faces down/right
    const u = px * dx + py * dy, v = px * nx + py * ny;
    return { u, st: strips[sPath], fx: wx + u + 34, fy: BANDC + v };
  }).sort((a, b) => b.u - a.u);
  const top = cand[0], sec = cand[1];
  let rgb;
  if (sec && top.u - sec.u < FEATHER) {
    const t = 0.5 + (top.u - sec.u) / (2 * FEATHER);
    const a = sampleStrip(top.st, top.fx, top.fy), b = sampleStrip(sec.st, sec.fx, sec.fy);
    rgb = [0, 1, 2].map(c => a[c] * t + b[c] * (1 - t));
  } else rgb = sampleStrip(top.st, top.fx, top.fy);
  for (let c = 0; c < 3; c++) base[o + c] = Math.round(rgb[c]);
}

// source grey plane (contrast stretch + thin, same recipe as templates) —
// used for cap ink AND the boundary-ink gap fill
{
  const lums = [];
  for (let i = 0; i < srcData.length; i += 4) if (srcData[i + 3] > 12) lums.push(lum(srcData, i));
  lums.sort((a, b) => a - b);
  const [p5s, p95s] = percentiles(lums, [0.05, 0.95]);
  const stretch = v => Math.max(0, Math.min(255, 25 + (v - p5s) * (205 - 25) / Math.max(1, p95s - p5s)));
  let plane = new Float32Array(w * h);
  for (let p = 0, i = 0; p < plane.length; p++, i += 4)
    plane[p] = srcData[i + 3] > 128 ? stretch(lum(srcData, i)) : 255;
  // thin 1px (erode ink mask, heal dropouts with local non-ink max)
  const mask = plane.map(v => v < INK ? 1 : 0);
  const next = new Float32Array(plane);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (!mask[p]) continue;
    let interior = true;
    for (const d of [-w, -1, 1, w]) if (!mask[p + d]) { interior = false; break; }
    if (interior) continue;
    let m = 0;
    for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) if (!mask[p + d] && plane[p + d] > m) m = plane[p + d];
    next[p] = m || plane[p];
  }
  plane = next;
  for (const [cx, cy, cw, ch] of cfg.caps)
    for (let y = cy; y < cy + ch && y < h; y++) for (let x = cx; x < cx + cw && x < w; x++) {
      const p = y * w + x, o = p * 4;
      if (base[o + 3] < 8 || plane[p] >= INK) continue;
      const v = Math.min(base[o], Math.round(plane[p]));
      base[o] = base[o + 1] = base[o + 2] = v;
    }

  // boundary ink: where the source has outline ink near the silhouette edge but
  // the composed base has none within 2px (rounded bends, diagonal edges cut
  // away from the arms' straight edge inks), fill from the source plane.
  // Skip open butt faces (alpha spans on tile edges stay ink-free).
  const nearEdge = p => {
    const x = p % w, y = (p / w) | 0;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue; // tile edge != silhouette
      if (srcData[(yy * w + xx) * 4 + 3] < 8) return true;
    }
    return false;
  };
  const hasInk = p => {
    const x = p % w, y = (p / w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const oo = (yy * w + xx) * 4;
      if (base[oo + 3] > 8 && base[oo] < INK) return true;
    }
    return false;
  };
  const apply = []; // decide against the pre-pass base, then write
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    if (base[o + 3] < 8 || plane[p] >= INK) continue;
    if (!nearEdge(p) || hasInk(p)) continue;
    apply.push(p);
  }
  for (const p of apply) {
    const o = p * 4;
    const v = Math.min(base[o], Math.round(plane[p]));
    base[o] = base[o + 1] = base[o + 2] = v;
  }
}

await sharp(base, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
console.log(`composed ${name} -> ${out} (${w}x${h}, arms ${cfg.arms.map(a => a[0]).join('/')}, caps ${cfg.caps.length})`);
