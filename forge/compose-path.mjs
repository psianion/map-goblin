// Straight_Path (1650x200 ribbon) = butt-composite of segments from the three
// approved 3x1 variant strips + the path source's alpha verbatim (chipped ends).
// Butt joints at 600/1200 are legitimate slab joints (same as mixed runs).
// node compose-path.mjs --out <png>
import { sharp, loadRaw, arg } from './lib.mjs';

const out = arg('out');
const SRC = 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_Path.png';
// fresh strips (not the placed 3x1 variants — avoids texture repeats at the
// table); s555 re-used within the ribbon 1200px from its first segment
const S4 = 'staging/stage4/cutsrc';
const segs = [
  { strip: `${S4}/cutsrc2-s555.png`, x: 0, w: 600, at: 0 },
  { strip: `${S4}/cutsrc2-s777.png`, x: 0, w: 600, at: 600 },
  { strip: `${S4}/cutsrc2-s555.png`, x: 75, w: 450, at: 1200 },
];

const { data: srcData, w, h } = await loadRaw(SRC);
const comps = [];
for (const s of segs)
  comps.push({ input: await sharp(s.strip).extract({ left: s.x, top: 0, width: s.w, height: h }).png().toBuffer(), left: s.at, top: 0 });

const flat = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).ensureAlpha().raw().toBuffer();

const outBuf = Buffer.alloc(flat.length);
for (let i = 0; i < flat.length; i += 4) {
  outBuf[i] = flat[i]; outBuf[i + 1] = flat[i + 1]; outBuf[i + 2] = flat[i + 2];
  outBuf[i + 3] = srcData[i + 3]; // path source alpha verbatim
}
await sharp(outBuf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
console.log(`path ${out}: ${w}x${h} from ${segs.map(s => `${s.strip.split('/').pop()}@${s.x}+${s.w}`).join(' | ')}`);
