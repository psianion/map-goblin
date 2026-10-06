// Compose padded Timber Palisade pieces from approved strip texture — palisade
// clone of compose-pad.mjs (wood taxonomy, band 44@78 instead of stone's 68@66).
// Same arm/cap/ARC machinery; only SRC, strip sources, and the half-band
// constant (HALF=22, was 34) differ. See compose-pad.mjs for the algorithm
// writeup (arms radiate from a junction anchor, deepest-u arm wins per pixel,
// feathered picture-frame miter at ties, cap ink for free arm ends).
// node compose-pad-palisade.mjs --piece <name> --out <png>   (see PIECES table)
import fs from 'fs';
import { sharp, loadRaw, lum, percentiles, arg } from './lib.mjs';

const SRC = 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Wood_A';
// fresh cutsrc strips from run-p3-cutsrc-palisade.sh (seeds 99/111 — 555 was a
// P2 dud seed). The -seam variants carry the source's reinstated center seam:
// sampling them as arm texture carries the two-row read along the arm (rows map
// across the band; the ARC remap turns it into a concentric mid-ring line).
// Seam assignment is per-PIECE, never per-arm — a seam dead-ending at a miter
// reads broken, but when every arm of a piece is seamed the lines meet at the
// 45° miters the way the outline does. Seamed: corners B/D/G, joints B/D,
// connector-B; the rest stay single-row (mix mirrors the straight variants).
const S555 = 'staging/palisade-s3/cutsrc-s99.png';
const S777 = 'staging/palisade-s3/cutsrc-s111.png';
const S555M = 'staging/palisade-s3/cutsrc-s99-seam.png';
const S777M = 'staging/palisade-s3/cutsrc-s111-seam.png';
const FEATHER = 10, INK = 70;

const DIRS = {
  E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1],
  SW: [-Math.SQRT1_2, Math.SQRT1_2], NE: [Math.SQRT1_2, -Math.SQRT1_2],
  SE: [Math.SQRT1_2, Math.SQRT1_2], NW: [-Math.SQRT1_2, -Math.SQRT1_2],
};

// arms: dir + strip window x (PLACEHOLDER — real windows get hand-picked at P4
// for calm texture, same as fieldstone), or ['ARC', strip, wx, {cx,cy,r0,r1}] —
// quarter-annulus polar remap (arc radii verified against Wall_Wood_A alpha:
// E(200,200) r78-122, F(400,400) r178-222, G(400,400) r278-322, H(600,600)
// r378-422 — all band-44 rings, r1 = pivot - box.x, r0 = r1 - 44);
// caps: rects (x,y,w,h) in source coords where source ink is re-applied —
// PLACEHOLDER geometry (tip ± ~20px along the arm, band+20=64px across it,
// centered on BANDC) for the free-standing capped tips (corner A/B, joint A/B's
// open ends, diag, ending); full-bleed pieces (corner C/D, joint C/D,
// connectors) get no caps, same as fieldstone — their open faces are straight
// tile-edge butts the boundary-ink-fill pass already handles.
const PIECES = {
  'corner-A': { src: 'Corner_A_1x1', arms: [['E', S555, 20], ['S', S777, 61]], caps: [[148, 68, 40, 64], [68, 149, 64, 40]] },
  'corner-B': { src: 'Corner_B_1x1', arms: [['E', S777M, 102], ['S', S555M, 143]], caps: [[148, 68, 40, 64], [68, 149, 64, 40]] },
  'corner-C': { src: 'Corner_C_1x1', arms: [['E', S555, 184], ['S', S777, 225]], caps: [] },
  'corner-D': { src: 'Corner_D_1x1', arms: [['E', S777M, 266], ['S', S555M, 307]], caps: [] },
  'corner-E': { src: 'Corner_E_1x1', arms: [['ARC', S555, 348, { cx: 200, cy: 200, r0: 78, r1: 122 }]], caps: [] },
  // wx 100: arc length (pi/2)*200=314 -> fx 100..414, clear of s99's butt at
  // 71-79 (wx 389 wrapped past 600 and landed the butt AT the arc end)
  'corner-F': { src: 'Corner_F_2x2', arms: [['ARC', S555, 100, { cx: 400, cy: 400, r0: 178, r1: 222 }]], caps: [] },
  'corner-G': { src: 'Corner_G_2x2', arms: [['ARC', S777M, 430, { cx: 400, cy: 400, r0: 278, r1: 322 }]], caps: [] },
  'corner-H': { src: 'Corner_H_3x3', arms: [['ARC', S555, 471, { cx: 600, cy: 600, r0: 378, r1: 422 }]], caps: [] },
  'joint-A': { src: 'Joint_A_1x1', arms: [['E', S555, 512], ['W', S777, 553], ['N', S555, 34], ['S', S777, 75]], caps: [[144, 68, 40, 64], [17, 68, 40, 64], [68, 16, 64, 40], [68, 144, 64, 40]] },
  'joint-B': { src: 'Joint_B_1x1', arms: [['E', S777M, 116], ['W', S555M, 157], ['S', S555M, 198]], caps: [[144, 68, 40, 64], [17, 68, 40, 64], [68, 144, 64, 40]] },
  'joint-C': { src: 'Joint_C_1x1', arms: [['E', S555, 239], ['W', S777, 280], ['N', S777, 321], ['S', S555, 362]], caps: [] },
  'joint-D': { src: 'Joint_D_1x1', arms: [['E', S777M, 403], ['W', S555M, 444], ['S', S777M, 485]], caps: [] },
  'diag': { src: 'Connector_DIAG_A_1x1', arms: [['E', S555, 526], ['SW', S777, 7]], caps: [[146, 68, 40, 64], [6, 145, 50, 40]] },
  // wx 160 keeps the sampled span (fx 182-228) clear of s99's butt at x71-79
  'ending': { src: 'Ending_A_1x1', arms: [['E', S555, 160]], caps: [[127, 68, 40, 64]] },
  // connectors have FREE ends (content 51..149 / 82..117, measured) — both tips capped
  'connector-A': { src: 'Connector_A_1x1', arms: [['E', S777, 89]], caps: [[31, 68, 40, 64], [129, 68, 40, 64]] },
  'connector-B': { src: 'Connector_B_1x1', arms: [['E', S555M, 130]], caps: [[62, 68, 40, 64], [97, 68, 40, 64]] },
};

const name = arg('piece'), out = arg('out');
const cfg = PIECES[name];
if (!cfg) { console.error('unknown piece', name); process.exit(1); }

const { data: srcData, w, h } = await loadRaw(`${SRC}/Wall_Wood_Ashen_A_${cfg.src}.png`);
const strips = {};
for (const [, s] of cfg.arms.map(a => [a[0], a[1]])) if (!strips[s]) strips[s] = await loadRaw(s);

const ANCHOR = [100, 100], BANDC = 100, HALF = 22; // band center row + half-band (44/2)

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
      return { u: 1e6, st: strips[sPath], fx: wx + th * (Math.PI / 2) * mid, fy: BANDC - HALF + (arc.r1 - r) };
    }
    const [dx, dy] = DIRS[dk];
    let [nx, ny] = [dy, -dx]; // rot90cw
    if (nx + ny < 0) { nx = -nx; ny = -ny; } // shade side faces down/right
    const u = px * dx + py * dy, v = px * nx + py * ny;
    return { u, st: strips[sPath], fx: wx + u + HALF, fy: BANDC + v };
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
