// Shared helpers for the wall-recreation forge scripts.
import { createRequire } from 'module';

// sharp comes from the pnpm store by path: forge is not a workspace package, so normal
// resolution finds nothing. Pinned rather than scanned for `sharp@*` — the store can hold
// several versions of a package at once (it currently does, for zod), and picking the
// first match silently binds to whichever pnpm happened to list first. The version is
// vault-engine's; bump this line when that package bumps sharp. A miss throws
// MODULE_NOT_FOUND naming this exact path, which is the whole point.
const PNPM = 'D:/Labs/map-goblin/node_modules/.pnpm';
const SHARP = 'sharp@0.34.5';
export const sharp = createRequire(import.meta.url)(`${PNPM}/${SHARP}/node_modules/sharp`);

export async function loadRaw(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export const lum = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

export function percentiles(sorted, qs) {
  return qs.map(q => sorted[Math.floor(q * (sorted.length - 1))]);
}

export function savePngRaw(data, w, h, out) {
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
}

/** Extract a size×size RGBA window from a raw image, wrapping around the edges. */
export function torusExtract(img, ox, oy, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = (oy + y) % img.h;
    for (let x = 0; x < size; x++) {
      const sx = (ox + x) % img.w;
      const di = (y * size + x) * 4;
      const si = (sy * img.w + sx) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Blend an RGBA window into a raw image in place, wrapping placement around the edges.
 * All four window edges ramp from 0 over `ramp` px, so the new paint cross-fades into
 * whatever it lands on instead of butting against it.
 */
export function torusBlend(img, win, size, ox, oy, ramp) {
  for (let y = 0; y < size; y++) {
    const ty = (oy + y) % img.h;
    const ay = Math.min(1, Math.min(y, size - 1 - y) / ramp);
    for (let x = 0; x < size; x++) {
      const tx = (ox + x) % img.w;
      const a = smooth(Math.min(ay, Math.min(1, Math.min(x, size - 1 - x) / ramp)));
      if (a === 0) continue;
      const si = (y * size + x) * 4;
      const di = (ty * img.w + tx) * 4;
      img.data[di] = win[si] * a + img.data[di] * (1 - a);
      img.data[di + 1] = win[si + 1] * a + img.data[di + 1] * (1 - a);
      img.data[di + 2] = win[si + 2] * a + img.data[di + 2] * (1 - a);
    }
  }
}

/**
 * Replace `result`'s low-frequency tone with `base`'s, keeping result's detail:
 * result += lowpass(base) - lowpass(result). Kills the tonal shift a repaint pass
 * leaves (a re-painted band brightens against once-painted interior) without touching
 * the paint itself. Blur is torus-padded so the correction wraps like the tile does.
 */
export async function harmonizeToBase(result, base, sigma = 48) {
  const pad = Math.ceil(sigma * 3);
  const lowpass = async (img) => {
    const size = img.w + 2 * pad;
    const padded = torusExtract(img, img.w - pad, img.h - pad, size);
    return sharp(padded, { raw: { width: size, height: size, channels: 4 } })
      .blur(sigma).raw().toBuffer();
  };
  const size = result.w + 2 * pad;
  const [lr, lb] = [await lowpass(result), await lowpass(base)];
  for (let y = 0; y < result.h; y++) {
    for (let x = 0; x < result.w; x++) {
      const di = (y * result.w + x) * 4;
      const si = ((y + pad) * size + (x + pad)) * 4;
      for (let c = 0; c < 3; c++) {
        const v = result.data[di + c] + lb[si + c] - lr[si + c];
        result.data[di + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
}

export function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
