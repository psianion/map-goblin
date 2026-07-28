// Slice an asset sheet into individual transparent-background asset PNGs.
// Background is estimated from corner patches; foreground = pixels far from it.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export interface SliceOptions {
  /** Color distance (0-441) beyond which a pixel counts as foreground. */
  threshold?: number;
  /** Minimum bounding-box side in px for a component to be kept. */
  minSize?: number;
  /** Padding around each crop in px. */
  pad?: number;
}

interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number;
}

export async function sliceSheet(
  imagePath: string,
  outDir: string,
  opts: SliceOptions = {},
): Promise<string[]> {
  const threshold = opts.threshold ?? 60;
  const minSize = opts.minSize ?? 40;
  const pad = opts.pad ?? 8;

  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  // Background estimate: mean of four 12x12 corner patches, sampled a bit inset
  // (sheets often have decorative borders; 6% inset skips most of them).
  const inset = Math.floor(Math.min(w, h) * 0.06);
  const patch = 12;
  let r = 0, g = 0, b = 0, n = 0;
  for (const [cx, cy] of [
    [inset, inset],
    [w - inset - patch, inset],
    [inset, h - inset - patch],
    [w - inset - patch, h - inset - patch],
  ] as const) {
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * w + x) * 4;
        r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
      }
    }
  }
  const bg = [r / n, g / n, b / n] as const;

  const isFg = (i: number): boolean => {
    const dr = data[i]! - bg[0];
    const dg = data[i + 1]! - bg[1];
    const db = data[i + 2]! - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) > threshold;
  };

  // Connected components over the foreground mask (4-neighbour BFS).
  const label = new Int32Array(w * h).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || !isFg(start * 4)) continue;
    const id = components.length;
    const comp: Component = { minX: w, minY: h, maxX: 0, maxY: 0, pixels: 0 };
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      comp.minX = Math.min(comp.minX, x); comp.maxX = Math.max(comp.maxX, x);
      comp.minY = Math.min(comp.minY, y); comp.maxY = Math.max(comp.maxY, y);
      comp.pixels++;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h) continue;
        if (Math.abs((q % w) - x) > 1) continue; // no row wrap
        if (label[q] === -1 && isFg(q * 4)) { label[q] = id; stack.push(q); }
      }
    }
    components.push(comp);
  }

  // Keep real assets: big enough, not a frame spanning the whole sheet.
  const kept = components
    .map((c, id) => ({ ...c, id }))
    .filter((c) => {
      const bw = c.maxX - c.minX, bh = c.maxY - c.minY;
      if (bw < minSize || bh < minSize) return false;
      if (bw > w * 0.85 && bh > h * 0.85) return false; // decorative border/frame
      return true;
    })
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);

  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (let k = 0; k < kept.length; k++) {
    const c = kept[k]!;
    const x0 = Math.max(0, c.minX - pad), y0 = Math.max(0, c.minY - pad);
    const x1 = Math.min(w - 1, c.maxX + pad), y1 = Math.min(h - 1, c.maxY + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

    // Copy crop, make everything not belonging to this component transparent.
    const out = Buffer.alloc(cw * ch * 4);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const src = (y * w + x) * 4;
        const dst = ((y - y0) * cw + (x - x0)) * 4;
        if (label[y * w + x] === c.id) {
          out[dst] = data[src]!; out[dst + 1] = data[src + 1]!;
          out[dst + 2] = data[src + 2]!; out[dst + 3] = 255;
        }
        // else: stays transparent
      }
    }
    const file = join(outDir, `${String(k + 1).padStart(3, '0')}.png`);
    await writeFile(
      file,
      await sharp(out, { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer(),
    );
    written.push(file);
  }
  return written;
}
