// Procedural, owned textures for the art pass — every texture here is drawn
// at runtime from canvas primitives (noise, gradients, strokes), never a
// pixel of external/generated image asset. Cached by key so repeated
// callers (multiple floor rects, re-renders) share one GPU texture instead
// of allocating a new one — the "reuse materials" perf rule.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function cached<T extends THREE.Texture>(key: string, build: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const texture = build();
  cache.set(key, texture);
  return texture;
}

function drawn(size: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!);
  return canvas;
}

// Low-contrast speckle over a base tint: "texture everywhere, contrast
// nowhere" (art-style-guide rule 6) — grain reads up close, disappears at a
// glance. Not seeded; these only ever build client-side on first use.
function paintSpeckle(ctx: CanvasRenderingContext2D, size: number, base: string, alpha: number, count: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  paintSpeckleDots(ctx, 0, 0, size, size, alpha, count);
}

// Same grain, scoped to a sub-rect and without the base fill — used to grain
// one cell of the floor meta-tile (see getFloorTexture) after that cell's
// own per-tile-tinted fillRect has already gone down.
function paintSpeckleDots(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number, count: number) {
  for (let i = 0; i < count; i++) {
    const shade = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(Math.random() * alpha).toFixed(3)})`;
    const s = 1 + Math.random() * 2;
    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, s, s);
  }
}

// Nudge a #rrggbb hex tint by ±delta per channel — the "per-tile tonal
// variation" between otherwise-identical floor cells (art-brief item 1).
function shiftColor(hex: string, delta: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + delta);
  const g = clamp(((n >> 8) & 255) + delta);
  const b = clamp((n & 255) + delta);
  return `rgb(${r},${g},${b})`;
}

// Vertical plank grade: lighter top, darker bottom (art-brief: table wood
// "#4A3420 -> #2A1E11 gradient", door wood "#8A6138 -> ... -> #4E3520
// vertical grade") — a real gradient fill instead of a flat tint, so every
// wood surface (table, doors) reads as lit-from-above stock rather than a
// single flat swatch (art-style-guide rule 6: "texture everywhere").
function paintWoodGrade(ctx: CanvasRenderingContext2D, size: number, baseTint: string) {
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, shiftColor(baseTint, 26));
  gradient.addColorStop(1, shiftColor(baseTint, -26));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  paintSpeckleDots(ctx, 0, 0, size, size, 0.05, 500);
}

// Dark dabs hugging a cell's border — worn/chipped stone at the seam, on top
// of the etched grid stroke rather than instead of it.
function paintEdgeWear(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tint: string) {
  ctx.fillStyle = tint;
  for (let i = 0; i < 14; i++) {
    const alongTop = Math.random() < 0.5;
    const t = Math.random() * size;
    const band = () => (Math.random() < 0.5 ? Math.random() * size * 0.12 : size - Math.random() * size * 0.12);
    const px = alongTop ? x + t : x + band();
    const py = alongTop ? y + band() : y + t;
    ctx.globalAlpha = 0.08 + Math.random() * 0.1;
    ctx.fillRect(px, py, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  ctx.globalAlpha = 1;
}

// Muted lichen fleck cluster — deliberately NOT the marketing goblin green
// (#B6D648 is CTA/eyes-only per the art brief's palette table).
const MOSS_TINT = '#4a5a3a';

function paintMoss(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const cx = x + size * (0.3 + Math.random() * 0.4);
  const cy = y + size * (0.3 + Math.random() * 0.4);
  // Texture critique P2-8: 6 soft same-hue arcs read as a mildew smudge, not
  // lichen. Recomposed as 8-14 small flecks in two values of the same family
  // — darker cores near the cluster center, lighter rims toward its edge —
  // plus an occasional 1px ink tick (the board's lichen references all carry
  // this internal structure). Cluster center + the caller's placement odds
  // (getFloorTexture's 0.08) are unchanged; overall footprint stays within
  // the old ~0.2*size spread.
  const coreTint = shiftColor(MOSS_TINT, -14);
  const rimTint = shiftColor(MOSS_TINT, 18);
  const flecks = 8 + Math.floor(Math.random() * 7);
  for (let i = 0; i < flecks; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * size * 0.11;
    ctx.fillStyle = d > size * 0.055 ? rimTint : coreTint;
    ctx.globalAlpha = 0.14 + Math.random() * 0.16;
    const r = size * (0.012 + Math.random() * 0.028);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (Math.random() < 0.5) {
    ctx.fillStyle = '#2a3020';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(cx + (Math.random() - 0.5) * size * 0.14, cy + (Math.random() - 0.5) * size * 0.14, 1, 1 + Math.random() * 2);
  }
  ctx.globalAlpha = 1;
}

export interface MaterialMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
}
const bundleCache = new Map<string, MaterialMaps>();

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Normal + AO maps read straight off the finished color canvas's own
// luminance — no second paint pass, so relief always matches what's actually
// drawn (seams, edge wear, moss all sit exactly where the albedo puts them).
// Sampling wraps at the edges to match RepeatWrapping so tiled repeats don't
// seam. Cheap: runs once per cached texture, never per-frame.
function deriveReliefMaps(source: HTMLCanvasElement, strength = 1.6): { normal: HTMLCanvasElement; ao: HTMLCanvasElement } {
  const { width, height } = source;
  const src = source.getContext('2d')!.getImageData(0, 0, width, height).data;
  const h = (x: number, y: number) => {
    const cx = (x + width) % width;
    const cy = (y + height) % height;
    const i = (cy * width + cx) * 4;
    return luminance(src[i], src[i + 1], src[i + 2]);
  };
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width;
  normalCanvas.height = height;
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = width;
  aoCanvas.height = height;
  const nctx = normalCanvas.getContext('2d')!;
  const actx = aoCanvas.getContext('2d')!;
  const nData = nctx.createImageData(width, height);
  const aData = actx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1) || 1;
      nData.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nData.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nData.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      nData.data[i + 3] = 255;
      // Groove/seam pixels (dark in the albedo) read as mildly occluded;
      // never fully black so torchlight still reaches into them.
      const av = Math.round(THREE.MathUtils.clamp(0.55 + h(x, y) * 0.45, 0, 1) * 255);
      aData.data[i] = aData.data[i + 1] = aData.data[i + 2] = av;
      aData.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nData, 0, 0);
  actx.putImageData(aData, 0, 0);
  return { normal: normalCanvas, ao: aoCanvas };
}

// Wraps a built color texture with normal + AO maps derived from it,
// matching its wrap/repeat so all three tile identically. Callers still key
// by their own cache key (shared with the color texture's own `cached()`
// call) so re-requesting the same tint reuses the whole bundle.
function withRelief(key: string, colorTexture: THREE.CanvasTexture): MaterialMaps {
  const hit = bundleCache.get(key);
  if (hit) return hit;
  const { normal, ao } = deriveReliefMaps(colorTexture.image as HTMLCanvasElement);
  const normalMap = new THREE.CanvasTexture(normal);
  const aoMap = new THREE.CanvasTexture(ao);
  for (const t of [normalMap, aoMap]) {
    t.wrapS = colorTexture.wrapS;
    t.wrapT = colorTexture.wrapT;
    t.repeat.copy(colorTexture.repeat);
  }
  const bundle: MaterialMaps = { map: colorTexture, normalMap, aoMap };
  bundleCache.set(key, bundle);
  return bundle;
}

/** 4-step toon ramp shared by every ramp-shaded material — the ladder from
 * near-black shadow to a lit face, banded rather than smooth-shaded, which
 * is what keeps everything matte (no specular highlight to read as glossy). */
export function getToonGradientMap(): THREE.CanvasTexture {
  return cached('toon-ramp', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ['#3c3c3c', '#828282', '#bebebe', '#ffffff'].forEach((shade, i) => {
      ctx.fillStyle = shade;
      ctx.fillRect(i, 0, 1, 1);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  });
}

// Meta-tile: this many distinct cells baked per texture repeat. A literal
// single-cell repeating texture would be pixel-identical at every grid
// square, which can't carry "per-tile tonal variation" or moss "on select
// tiles" — those need neighboring tiles to actually differ. Grid seams still
// land exactly on cell boundaries (geometry.ts's floorGeometry divides its
// UV scale by this same constant), so the etched grid stays at true cell size.
// D2 fix round (finding 8): 4 repeated the exact same moss-constellation
// meta-tile every 4 cells (~305px at this room's cell size), reading as
// wallpaper — doubled to 8 so the repeat period is large enough nothing on
// screen shows two copies of the same pattern at once.
export const FLOOR_TILE_CELLS = 8;
const FLOOR_CELL_PX = 128;

/** Floor meta-tile: each of the FLOOR_TILE_CELLS×FLOOR_TILE_CELLS cells gets
 * its own tonal nudge, fine grain, edge wear along its seam, and a chance of
 * a moss fleck cluster — plus the seam itself, etched into the texture (not
 * an overlay line) per art-style-guide rule 2. Normal + AO maps are derived
 * from this same canvas below (see deriveReliefMaps) so the etched seams,
 * wear, and moss all pick up torchlight relief. */
export function getFloorTexture(baseTint: string, seamTint: string): MaterialMaps {
  const key = `floor-${baseTint}-${seamTint}`;
  const color = cached(key, () => {
    const size = FLOOR_CELL_PX * FLOOR_TILE_CELLS;
    const canvas = drawn(size, (ctx) => {
      for (let cy = 0; cy < FLOOR_TILE_CELLS; cy++) {
        for (let cx = 0; cx < FLOOR_TILE_CELLS; cx++) {
          const x = cx * FLOOR_CELL_PX;
          const y = cy * FLOOR_CELL_PX;
          const tint = shiftColor(baseTint, (Math.random() - 0.5) * 16);
          ctx.fillStyle = tint;
          ctx.fillRect(x, y, FLOOR_CELL_PX, FLOOR_CELL_PX);
          paintSpeckleDots(ctx, x, y, FLOOR_CELL_PX, FLOOR_CELL_PX, 0.05, 220);
          paintEdgeWear(ctx, x, y, FLOOR_CELL_PX, seamTint);
          // D2 fix round (finding 8): 0.22 put moss on roughly 1 in 4 cells —
          // dense enough that the repeating meta-tile's moss layout alone was
          // recognizable as a repeat even before the FLOOR_TILE_CELLS bump
          // above. ~1 in 12 reads as "occasional fleck", not a pattern.
          if (Math.random() < 0.08) paintMoss(ctx, x, y, FLOOR_CELL_PX);
          ctx.strokeStyle = seamTint;
          // D2 value inversion: floor went from mid-tone to light stone
          // (Diorama.tsx FLOOR_TINT) and the seam tint went from a lighter
          // grey to dark ink (FLOOR_SEAM_TINT) — a dark line on a light
          // floor needs far less alpha to read than the old light-on-mid-tone
          // case did (that's what the 0.55 above was tuned for). Matches the
          // direction board's own reference: --m-grid rgba(22,24,15,.10),
          // "low-contrast terrain-tinted", disappears at a glance.
          ctx.globalAlpha = 0.14;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, FLOOR_CELL_PX - 2, FLOOR_CELL_PX - 2);
          ctx.globalAlpha = 1;
        }
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  return withRelief(key, color);
}

/** Wall stone grain: blotchy low-contrast noise, no seam (walls aren't cell-tiled). */
export function getWallTexture(baseTint: string): MaterialMaps {
  const key = `wall-${baseTint}`;
  const color = cached(key, () => {
    const size = 128;
    const canvas = drawn(size, (ctx) => paintSpeckle(ctx, size, baseTint, 0.07, 1400));
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  return withRelief(key, color);
}

/** Plank wood grain with dark seams — matches the DOM door's
 * repeating-linear-gradient plank look (styles/global.css `.door`), redrawn
 * as a shared texture for the table and the 3D exit door (beat 8). */
export function getWoodTexture(baseTint: string, seamTint: string): MaterialMaps {
  const key = `wood-${baseTint}-${seamTint}`;
  const color = cached(key, () => {
    const size = 128;
    const canvas = drawn(size, (ctx) => {
      paintWoodGrade(ctx, size, baseTint);
      ctx.strokeStyle = seamTint;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3;
      for (let x = 0; x <= size; x += size / 4) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Denser plank repeat than the door's — the table is a big flat span
    // (26 world units) that read as one smeared tile at the door's (3,3).
    // Vertical repeat is 1, not 4: paintWoodGrade bakes a top-light/
    // bottom-dark ramp that does NOT loop back to its start value, so tiling
    // it 4x down a plane's depth (the old repeat) drew 4 hard light->dark
    // sawtooth seams across the table and the diorama's wood skirt (both
    // callers of this function) — the D2 round's banding root cause. The
    // plank divisions (the seam strokes below) still repeat horizontally;
    // only the grade itself stops re-tiling.
    texture.repeat.set(6, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  return withRelief(key, color);
}

/** Plank wood + iron banding: the wood-plank base from getWoodTexture plus
 * two horizontal iron straps with rivets, one tile-height apart — the
 * "planked wood, iron banding" door read (art-brief doors). Kept as its own
 * function (not a getWoodTexture option) so the table/mug's plain wood
 * grain doesn't pick up bands meant only for doors. */
export function getDoorTexture(baseTint: string, seamTint: string): MaterialMaps {
  const key = `door-${baseTint}-${seamTint}`;
  const color = cached(key, () => {
    const size = 128;
    const canvas = drawn(size, (ctx) => {
      paintWoodGrade(ctx, size, baseTint);
      ctx.strokeStyle = seamTint;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3;
      for (let x = 0; x <= size; x += size / 4) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const y of [size * 0.28, size * 0.72]) {
        ctx.fillStyle = '#1c1c1a';
        ctx.fillRect(0, y - size * 0.045, size, size * 0.09);
        ctx.fillStyle = '#5a5a54';
        for (let x = size * 0.1; x < size; x += size * 0.22) {
          ctx.beginPath();
          ctx.arc(x, y, size * 0.018, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  return withRelief(key, color);
}

/** Door TOP face only (BoxGeometry material index 2): the beat-4 true-nadir
 * camera (cameraPath.ts keyframe 4, "no more forward-cheat tilt") looks
 * straight down a door leaf, so its side faces — where getDoorTexture's
 * vertical plank grade and iron bands actually live — never face the lens.
 * All that reads from directly above is this top face, which used to share
 * getDoorTexture's own material and so showed a thin, near-flat sliver of
 * dark wood indistinguishable from the wall beside it (the "flat placeholder
 * color" defect). This is a dedicated plan-view instead: a bright, flat wood
 * fill (no vertical ramp — there's no "up" on a top face) with a bold ink
 * center seam (the two-leaf split, readable straight down) and iron corner
 * studs. `heavy` (the secret door only) adds a center lock plate + thicker
 * studs — map-wide door fix stays one function, the secret door just reads
 * more reinforced within it. */
export function getDoorTopTexture(baseTint: string, inkTint: string, heavy: boolean): MaterialMaps {
  const key = `door-top-${baseTint}-${inkTint}-${heavy}`;
  const color = cached(key, () => {
    const size = 128;
    const canvas = drawn(size, (ctx) => {
      ctx.fillStyle = baseTint;
      ctx.fillRect(0, 0, size, size);
      paintSpeckleDots(ctx, 0, 0, size, size, 0.05, 260);
      // Center seam: the two-leaf split, the one line that still reads once
      // this square gets squashed onto the door's thin (width x depth) top.
      ctx.strokeStyle = inkTint;
      ctx.lineWidth = size * 0.07;
      ctx.beginPath();
      ctx.moveTo(size / 2, 0);
      ctx.lineTo(size / 2, size);
      ctx.stroke();
      // Plank ticks either side of the seam.
      ctx.lineWidth = size * 0.02;
      ctx.globalAlpha = 0.6;
      for (const x of [size * 0.18, size * 0.32, size * 0.68, size * 0.82]) {
        ctx.beginPath();
        ctx.moveTo(x, size * 0.06);
        ctx.lineTo(x, size * 0.94);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Iron studs at the corners (+ a center lock plate for the heavy/secret variant).
      const studR = size * (heavy ? 0.09 : 0.06);
      ctx.fillStyle = '#2a2824';
      for (const [sx, sy] of [
        [size * 0.14, size * 0.14],
        [size * 0.86, size * 0.14],
        [size * 0.14, size * 0.86],
        [size * 0.86, size * 0.86],
      ]) {
        ctx.beginPath();
        ctx.arc(sx, sy, studR, 0, Math.PI * 2);
        ctx.fill();
      }
      if (heavy) {
        ctx.fillStyle = '#1c1a17';
        ctx.fillRect(size * 0.38, size * 0.4, size * 0.24, size * 0.2);
        ctx.fillStyle = inkTint;
        ctx.beginPath();
        ctx.arc(size * 0.5, size * 0.5, size * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  return withRelief(key, color);
}

// Issue 4 / P1-A fix: the table's lamp pool now lives at a real world
// position instead of a hardcoded canvas UV fraction (the old cx=0.26,
// cy=0.12 bug — correct as a UV fraction, but the plane grew to 120x64
// world units without the bake following it, landing the pool at world
// (-20.8, -20.8), 37.7 units off any camera's frame). Every bake that
// depends on "where the lamp is" derives from this one constant now, so a
// future plane resize can't desync them again.
//
// Placement spec: at camera keyframe 0 (nadir, position [4.5, 40, 3.5],
// fov 44 — cameraPath.ts) the pool's screen centroid should land at
// (26%, 12%) of the frame, the same spot the loader's #gg-lamp and the
// (now-retired) .stage-lamp CSS radial both used, so the loader's exit
// still hands off to what looks like the same light. Half-height at
// keyframe 0 = 40*tan(22deg) = 16.16 world units:
//   world z = 3.5 + (0.12 - 0.5)*2*16.16 = -8.8
//   world x = 4.5 + (0.26 - 0.5)*2*16.16*aspect  ->  -7.9 @ aspect 1.6, -10.4 @ 1.92
// LAMP_WORLD takes the aspect-1.75 midpoint (-9); the pool is soft enough
// that the +-1.3 unit spread across aspects is invisible. See
// docs/2026-08-11-nine-issue-fix-plan.md section 4 for the full derivation.
export const LAMP_WORLD: [number, number] = [-9, -8.8];
// World-unit falloff radius (not UV-sized — the old bug again: `size*1.05`
// was 1.05 of the texture's full extent, which stretched to 126x67 world
// units, so everything any camera ever framed sat inside the first few
// percent of the ramp and read as a flat wash). Sized so the map footprint
// (x 0..16, z 0..7) sits inside the pool's bright half and the table's far
// corners fall off.
export const LAMP_RADIUS = 20;

// Shared by every lamp-position-dependent bake: converts a world (x, z)
// point into the fraction-of-canvas-0..1 space a texture painter works in,
// given the table plane's own center and world size (passed in by the
// caller, not duplicated here — see getTableWoodTexture).
function worldToTableUV(worldXZ: [number, number], center: [number, number], size: [number, number]): [number, number] {
  return [0.5 + (worldXZ[0] - center[0]) / size[0], 0.5 + (worldXZ[1] - center[1]) / size[1]];
}

// D2 fix round (finding 10): paintWoodGrade's linear vertical ramp reads as a
// striped curtain on a horizontal surface — fine for the door (a vertical
// panel, meant to look lit top-to-bottom) but wrong for the table plane,
// which needs the board's own `.d2 .stage` recipe: a single radial pool
// (`radial-gradient(130% 120% at 24% 8%, --wood-lit -> --wood -> --wood-deep)`),
// one light source per style-guide rule 5. Table-only.
function paintTableWoodRadial(
  ctx: CanvasRenderingContext2D,
  size: number,
  baseTint: string,
  tableCenter: [number, number],
  tableSize: [number, number],
) {
  const [ux, uy] = worldToTableUV(LAMP_WORLD, tableCenter, tableSize);
  const cx = ux * size;
  const cy = uy * size;
  // Elliptical, not circular: the canvas is square but the plane isn't
  // (120x64), so a world-circular pool needs a canvas-pixel radius that's
  // proportionally bigger along the axis mapped to fewer world units per
  // pixel (z/64) than the one mapped to more (x/120). ctx.createRadialGradient
  // only draws circles, so the ellipse comes from a non-uniform scale
  // transform around the pool's own center, undone before returning.
  const rx = (LAMP_RADIUS / tableSize[0]) * size;
  const ry = (LAMP_RADIUS / tableSize[1]) * size;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, shiftColor(baseTint, 26));
  gradient.addColorStop(0.38, baseTint);
  gradient.addColorStop(1, shiftColor(baseTint, -26));
  ctx.fillStyle = gradient;
  // Huge margin in the (scaled) local space — cheap, and guarantees full
  // canvas coverage regardless of the rx/ry ratio; the canvas itself clips
  // the fill to its real pixel bounds.
  ctx.fillRect(-size * 10, -size * 10, size * 20, size * 20);
  ctx.restore();
  // Speckle count scales with canvas area (11000 @ 1024 ≈ the 700 @ 256 the
  // recipe was tuned at) so density survives the resolution bump below.
  paintSpeckleDots(ctx, 0, 0, size, size, 0.05, 11000);
}

/** Table-only wood grain: same plank seams as getWoodTexture, but a baked
 * radial falloff (see paintTableWoodRadial) instead of a vertical ramp.
 * Never tiled (no wrapS/wrapT/repeat set, same as getSheetTexture) — the
 * whole point is ONE light pool across the table's own UV 0..1; repeating it
 * would multiply that pool into the exact banding this exists to fix. */
// tableCenter/tableSize default to TableScene.tsx's own current plane
// (center [8, 3.5], world size 120x64) — TableScene passes its own named
// constants explicitly (issue 4) so the two can never drift apart the way
// the plane resize and this bake did before; the defaults just mean this
// function still works standalone (tests, storybook-style usage) without a
// caller.
export function getTableWoodTexture(
  baseTint: string,
  seamTint: string,
  tableCenter: [number, number] = [8, 3.5],
  tableSize: [number, number] = [120, 64],
): MaterialMaps {
  const key = `table-wood-${baseTint}-${seamTint}`;
  const color = cached(key, () => {
    // 1024, not 256: this texture stretches un-tiled across the full table
    // plane (~120 world units), so 256px starved to ~2 px/world-unit — a flat
    // brown field with no readable grain on the page's largest surface. 1024
    // lands ~9 px/unit, in family with the sheet's density. Not 2048:
    // deriveReliefMaps loops every pixel of this canvas at texture build.
    const size = 1024;
    // size/32 (not /10): plank seams land ~2 world units apart on the
    // enlarged plane instead of ~7-unit-wide corrugation bands.
    const plank = size / 32;
    const canvas = drawn(size, (ctx) => {
      paintTableWoodRadial(ctx, size, baseTint, tableCenter, tableSize);
      // Texture critique P1-3: the ramp + ruled seams alone read as "material
      // stated, not painted" — stripe wallpaper. Three plank layers on top of
      // the (untouched) radial lamp ramp:
      // (1) Per-plank tonal offset: each seam-bounded strip shifted base
      //     ±7-13/255 so columns read as boards cut from different stock.
      //     G3 (final critique round): (4 + rand*4)/255 landed a measured
      //     3.4/255 step between neighbors vs the 4-8 spec — raised. Sign
      //     choice: "opposite of previous" MOST of the time (guaranteed
      //     separation — two same-sign neighbors cancel toward 0, measured
      //     pairs as low as 0.2 lum) but with a ~22% chance of repeating,
      //     because a STRICT alternation read as a low/high/low/high rhythm
      //     across all 17 visible planks (verify round measured the 2-plank
      //     period) — a manufactured tell of its own. Real boards separate
      //     without a beat.
      let plankSign = Math.random() < 0.5;
      for (let x = 0; x < size; x += plank) {
        ctx.fillStyle = plankSign ? '#ffffff' : '#000000';
        ctx.globalAlpha = (9 + Math.random() * 7) / 255;
        ctx.fillRect(x, 0, plank, size);
        plankSign = Math.random() < 0.22 ? plankSign : !plankSign;
      }
      // (2) Longitudinal grain, G2 (two rounds of misses, root cause found by
      //     the close-out verify): the 1024px map stretches over ~120 world
      //     units, so a 3-stroke bundle smears to 15-20 SCREEN px at beat 8
      //     and the beat's ~35% brightness grade eats the delta — bundling
      //     buys sub-pixel width, not contrast. The lever is AMPLITUDE:
      //     per-stroke alpha 0.16-0.24 with ±34/30 contrast targets an
      //     accumulated 12-16/255 in texture space so ~4-6/255 survives the
      //     beat-7/8 grade. Acceptance (measured in-browser): shear-aligned
      //     column-mean SD >= 2.0 lum inside a clean plank at beat 8, with
      //     the shear-0 control staying ~0.3, and no wallpaper read at
      //     beats 0/7.
      ctx.lineWidth = 1;
      const darkGrain = shiftColor(baseTint, -34);
      const lightGrain = shiftColor(baseTint, 30);
      for (let x = 0; x < size; x += plank) {
        const strokes = 26 + Math.floor(Math.random() * 14);
        for (let s = 0; s < strokes; s++) {
          let gx = x + 2 + Math.random() * (plank - 4);
          const y0 = Math.random() * size;
          const y1 = Math.min(size, y0 + size * (0.12 + Math.random() * 0.3));
          ctx.strokeStyle = Math.random() < 0.6 ? darkGrain : lightGrain;
          ctx.globalAlpha = 0.16 + Math.random() * 0.08;
          const points: [number, number][] = [[gx, y0]];
          for (let gy = y0 + 12; gy < y1; gy += 12) {
            gx = Math.max(x + 1, Math.min(x + plank - 1, gx + (Math.random() - 0.5) * 2.4));
            points.push([gx, gy]);
          }
          for (const off of [0, -0.9, 0.9]) {
            ctx.beginPath();
            points.forEach(([px, py], pi) => (pi === 0 ? ctx.moveTo(px + off, py) : ctx.lineTo(px + off, py)));
            ctx.stroke();
          }
        }
      }
      // (3) Staggered butt joints: each plank column broken 1-2x by a short
      //     horizontal seam at its own random height, so planks stop reading
      //     as continuous full-length boards. Independent randoms per column
      //     keep neighbors from aligning.
      ctx.strokeStyle = seamTint;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.3;
      for (let x = 0; x < size; x += plank) {
        const joints = Math.random() < 0.5 ? 2 : 1;
        for (let j = 0; j < joints; j++) {
          const jy = size * (0.08 + Math.random() * 0.84);
          ctx.beginPath();
          ctx.moveTo(x, jy);
          ctx.lineTo(x + plank, jy);
          ctx.stroke();
        }
      }
      // One knot, elongated along the plank, mid-plank in the table's SW
      // quadrant — canvas (0.11, 0.72) lands well outside the sheet footprint
      // and away from every beat's copy zone.
      const kx = plank * 3.5;
      const ky = size * 0.72;
      ctx.strokeStyle = shiftColor(baseTint, -20);
      ctx.lineWidth = 1;
      for (let r = 9; r >= 3; r -= 2) {
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 1.6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = shiftColor(baseTint, -26);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 2.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Plank seams last, on top of the layers above.
      ctx.strokeStyle = seamTint;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      for (let x = 0; x <= size; x += plank) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  return withRelief(key, color);
}

// Standard right-handed die layout, opposite faces summing to 7.
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.22],
    [0.28, 0.5],
    [0.28, 0.78],
    [0.72, 0.22],
    [0.72, 0.5],
    [0.72, 0.78],
  ],
};

/** One die face: flat tint + ink pips in the standard 1-6 arrangement.
 * Callers build a 6-entry BoxGeometry material array from this (one call
 * per opposite-summing-to-7 pair) — "simple beveled cubes with pip decals
 * are fine" per the art brief; true bevel geometry is skipped as unneeded
 * polish (see TableScene.tsx). */
export function getDiceFaceTexture(pipCount: number, baseColor: string, pipColor = '#16180f'): THREE.CanvasTexture {
  return cached(`dice-${baseColor}-${pipCount}`, () => {
    const size = 64;
    const canvas = drawn(size, (ctx) => {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = pipColor;
      const r = size * 0.09;
      for (const [px, py] of PIP_LAYOUTS[pipCount] ?? []) {
        ctx.beginPath();
        ctx.arc(px * size, py * size, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Generic radial falloff plane, parameterized by color/opacity — shared by
 * the table's room glow (beat 7) and the exit door's stage glow (beat 8),
 * both "a warm radial glow behind the subject" per the art brief. */
export function getRadialGlowTexture(hex: string, coreAlpha: number, midAlpha: number): THREE.CanvasTexture {
  return cached(`radial-${hex}-${coreAlpha}-${midAlpha}`, () => {
    const size = 128;
    const [r, g, b] = hexToRgb(hex);
    const canvas = drawn(size, (ctx) => {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, `rgba(${r},${g},${b},${coreAlpha})`);
      gradient.addColorStop(0.6, `rgba(${r},${g},${b},${midAlpha})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** Amber dashed break, drawn once as a horizontal stroke — the secret door's
 * "not a wall, not a door, a break in the plan" mark on the DM pane
 * (art-brief beat 4: "amber dashed secret-door break across the wall gap"). */
export function getDashTexture(): THREE.CanvasTexture {
  return cached('dash-amber', () => {
    const w = 128;
    const h = 32;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#eda94e';
    ctx.lineWidth = 7;
    ctx.setLineDash([11, 9]);
    ctx.beginPath();
    ctx.moveTo(2, h / 2);
    ctx.lineTo(w - 2, h / 2);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** Circular amber "S" badge marking a secret door on the DM pane only
 * (art-brief beat 4). */
export function getBadgeTexture(): THREE.CanvasTexture {
  return cached('badge-s', () => {
    const size = 64;
    const canvas = drawn(size, (ctx) => {
      ctx.fillStyle = '#eda94e';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#16180f';
      ctx.font = `bold ${size * 0.55}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', size / 2, size / 2 + 2);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** Painted token cap: tinted fill with an off-center highlight, light grain,
 * and the rim itself — a darker ink annulus around the outer ~12% plus a
 * lighter bevel arc facing the key light (art-style-guide's dark-ink-outline
 * idiom). The rim used to be left to the token cylinder's side wall, but
 * under this diorama's near-nadir camera that side wall is only ~1.7% of the
 * token's on-screen width — unreadable as a rim, so it's painted into the
 * cap instead (the cylinder itself is kept only for silhouette/outline).
 * The cap's own circular UV never samples past the disc edge, so no shadow
 * gets baked in here — that's a separate decal (getRadialGlowTexture reused
 * near-black) sitting under the token. */
export function getTokenTexture(color: string): THREE.CanvasTexture {
  return cached(`token-${color}`, () => {
    const [r, g, b] = hexToRgb(color);
    const size = 64;
    const canvas = drawn(size, (ctx) => {
      const grad = ctx.createRadialGradient(size * 0.34, size * 0.34, size * 0.05, size / 2, size / 2, size * 0.5);
      grad.addColorStop(0, `rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)})`);
      grad.addColorStop(0.65, color);
      grad.addColorStop(1, `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      paintSpeckleDots(ctx, 0, 0, size, size, 0.05, 60);

      const outerR = size * 0.5;
      const rimWidth = outerR * 0.12;
      ctx.lineWidth = rimWidth;
      ctx.strokeStyle = `rgb(${Math.max(0, r - 70)},${Math.max(0, g - 70)},${Math.max(0, b - 70)})`;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, outerR - rimWidth / 2, 0, Math.PI * 2);
      ctx.stroke();

      // Light bevel arc on the side facing the key light — same upper-left
      // corner the highlight above leans toward.
      ctx.lineWidth = rimWidth * 0.5;
      ctx.strokeStyle = `rgb(${Math.min(255, r + 70)},${Math.min(255, g + 70)},${Math.min(255, b + 70)})`;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, outerR - rimWidth, Math.PI * 1.05, Math.PI * 1.55);
      ctx.stroke();
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** Warm radial falloff for baked torch pools — a painted glow on the floor
 * that holds the art-style-guide's "every light source gets a soft radial
 * warm glow baked into the ground art" even where the dynamic point light
 * alone would read as a thin specular-free toon highlight. Stops fade out at
 * the same 2.5-cell mark as before (this plane is a 3.5-cell-radius square,
 * so 2.5/3.5 ≈ 0.71).
 *
 * D2 value inversion: this used to be additive-blended over a dark floor
 * (cheap, can't overflow — additive on near-black just lifts it toward the
 * torch hue). The floor is now light stone (Diorama.tsx FLOOR_TINT
 * #efe6cf-family); additive amber on top of that blows straight to white
 * regardless of alpha. Callers (Diorama.tsx's baked pool, composition.tsx's
 * PoolBoosts) now use NORMAL (alpha) blending instead, so this reads as a
 * genuine warm-tinted wash — floor mixed toward amber, never summed past it
 * — which is also what the direction board's own CSS `.glow` recipe does
 * (radial-gradient, not `mix-blend-mode: screen`). Same texture still works
 * at night: normal-blending a warm color over the night-tinted dark floor
 * just tints it warm, the "torch pools holding warm against the blue" read. */
export function getTorchGlowTexture(): THREE.CanvasTexture {
  return cached('torch-glow', () => {
    const size = 128;
    const canvas = drawn(size, (ctx) => {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      // D2 fix round (finding 4) pulled the old 0.71 plateau in to 0.5, but a
      // shelf at any radius still draws a rim — texture critique P2-7 found a
      // readable inner disc where the 0.35-0.5 flat band ended. Stops are now
      // strictly monotonic (0.42/0.30/0.16/0) so the falloff never holds a
      // shelf; the 0.42 core keeps the deliberate warm-pool read the D2 round
      // deepened these for.
      g.addColorStop(0, 'rgba(237,169,78,0.42)');
      g.addColorStop(0.35, 'rgba(237,169,78,0.30)');
      g.addColorStop(0.5, 'rgba(237,169,78,0.16)');
      g.addColorStop(1, 'rgba(237,169,78,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** The parchment map sheet the diorama physically sits on (D2 "the lit
 * table" — board recipe `.sheet`: `linear-gradient(168deg, #efe7d1 0%,
 * #e8dfc6 46%, #d9cdab 100%)` plus a faint multiply noise). Baked once as a
 * big flat plane texture — unlit MeshBasicMaterial, same "final values
 * baked into canvas textures" rule as every other surface here. Diagonal
 * gradient approximated with a 168deg-equivalent linear gradient across the
 * square canvas (corner-to-corner-ish, matching the CSS angle closely enough
 * that repeat=1 stretched onto a wide rectangular plane still reads as one
 * soft diagonal light source, not a banded tile — this texture is never
 * repeated, just stretched to the sheet plane's own UV 0..1). */
export function getSheetTexture(): THREE.CanvasTexture {
  return cached('sheet-parchment', () => {
    const size = 256;
    const canvas = drawn(size, (ctx) => {
      const angle = (168 * Math.PI) / 180;
      const dx = Math.cos(angle) * size;
      const dy = Math.sin(angle) * size;
      const g = ctx.createLinearGradient(size / 2 - dx / 2, size / 2 - dy / 2, size / 2 + dx / 2, size / 2 + dy / 2);
      // Texture critique P2-5: at pull-back distance the sheet read grey-cold
      // — the bake matched the board hexes exactly, but the downstream
      // PostFX vignette x roomGlow interaction (not this file's to touch)
      // cools it. Small warm compensation baked in: R+4/B-6 per stop, hue
      // family unchanged.
      g.addColorStop(0, '#f3e7cb');
      g.addColorStop(0.46, '#ecdfc0');
      g.addColorStop(1, '#ddcda5');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      paintSpeckleDots(ctx, 0, 0, size, size, 0.035, 2200);
      // P2-5 paper thickness: a ~2px warm lit strip on the lamp-facing edges
      // (canvas left = world -x, canvas top via flipY = world -z). Issue 4
      // moved the lamp to LAMP_WORLD = (-9, -8.8) — still west and north of
      // SHEET_CENTER (8, 3.5) in TableScene.tsx, i.e. still the -x/-z
      // corner, so this direction (not a re-derived position) survives the
      // move unchanged; only the wood bake itself needed the exact UV.
      ctx.fillStyle = '#f9f2de';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, 0, size, 2);
      ctx.fillRect(0, 0, 2, size);
      ctx.globalAlpha = 1;
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** The sheet's cast shadow onto the wood beneath it (board recipe:
 * `box-shadow: 0 14px 34px rgba(12,8,4,.55)` — an OFFSET shadow agreeing
 * with the table lamp).
 *
 * Texture critique P2-5: the old bake was a symmetric 4-side vignette that
 * peaked AT the decal plane's own rim — a picture frame fighting the lamp,
 * with a full-strength band on the lamp-facing edges. Rebaked directional:
 * the table lamp sits in the world -x/-z direction from the sheet (issue 4:
 * LAMP_WORLD = (-9, -8.8) vs SHEET_CENTER = (8, 3.5) in TableScene.tsx — the
 * same corner the pre-fix bake assumed, so this direction still holds), so
 * the shadow now carries on the far (+x/+z = canvas right/bottom) edges and
 * is near-zero on the lamp-facing ones. Per-edge profile peaks where the
 * sheet's edge sits over this decal (the plane is SHEET_SIZE + 1.4 world
 * units, TableScene.tsx — 0.7 units of visible ring per side, ~0.031 of u /
 * ~0.049 of v) and falls to zero at the decal rim, so the visible read is
 * "darkest at the paper's edge, dissolving outward onto the wood", never a
 * hard-cut rectangle. */
export function getSheetShadowTexture(): THREE.CanvasTexture {
  return cached('sheet-shadow', () => {
    const size = 128;
    const canvas = drawn(size, (ctx) => {
      const img = ctx.createImageData(size, size);
      // Sheet-edge inset in texture space: 0.7 / (SHEET_SIZE + 1.4) per axis.
      const px = 0.7 / 22.4;
      const pz = 0.7 / 14.4;
      // 0 at the rim, peak 1 at d = p (the sheet edge), then a FAST Gaussian
      // drop just inside it — this decal sits in the transparent pass over a
      // depthWrite:false sheet, so anything baked inward of the sheet edge
      // composites ON TOP of the parchment; only a thin contact overlap
      // (gone by ~2p, i.e. ~0.7 world units in) is allowed to survive there.
      const shape = (d: number, p: number) => {
        const t = d / p;
        if (t <= 1) return t * t * (3 - 2 * t); // smoothstep rise across the visible ring
        const o = (t - 1) / 0.35;
        return Math.exp(-o * o);
      };
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / (size - 1);
          const v = y / (size - 1); // loop v: 0 = canvas top = world -z (lamp side)
          const a =
            0.08 * shape(u, px) + // west rim: lamp-facing, near-zero
            0.08 * shape(v, pz) + // north rim: lamp-facing, near-zero
            shape(1 - u, px) + // east rim: full cast shadow
            shape(1 - v, pz); // south rim: full cast shadow
          const alpha = Math.round(THREE.MathUtils.clamp(a, 0, 1) * 0.6 * 255);
          const i = (y * size + x) * 4;
          img.data[i] = 12;
          img.data[i + 1] = 8;
          img.data[i + 2] = 4;
          img.data[i + 3] = alpha;
        }
      }
      ctx.putImageData(img, 0, 0);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}
