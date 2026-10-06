// Palisade Straight_Path (1650x200 ribbon, band 44@78) = butt-composite of
// segments from the approved 3x1 variant strips + the path source's alpha
// verbatim (chipped ends). Clone of compose-path.mjs — same 600/600/450 split
// (Wall_Wood_Ashen_A_Straight_Path.png measures 1650x200, band 44@78, same as
// the fieldstone stone path, so the segment math carries over unchanged).
// Butt joints at 600/1200 are legitimate plank joints (same as mixed runs).
// node compose-path-palisade.mjs --out <png>
import { sharp, loadRaw, arg } from './lib.mjs';

const out = arg('out');
const SRC = 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Wood_A/Wall_Wood_Ashen_A_Straight_Path.png';
// fresh cutsrc strips from run-p3-cutsrc-palisade.sh (seeds 99/111 — not the
// placed 3x1 variants — avoids texture repeats at the table); s99 re-used
// within the ribbon 1200px from its first segment
const S3 = 'staging/palisade-s3';
const segs = [
  { strip: `${S3}/cutsrc-s99.png`, x: 0, w: 600, at: 0 },
  { strip: `${S3}/cutsrc-s111.png`, x: 0, w: 600, at: 600 },
  { strip: `${S3}/cutsrc-s99.png`, x: 75, w: 450, at: 1200 },
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
