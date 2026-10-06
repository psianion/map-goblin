// Raw pad-piece output -> candidate: crop the pad on all sides, downscale,
// desaturate + normalize to the master ramp, re-apply the SOURCE alpha verbatim.
// node post-pad.mjs --raw <png> --src <sourcePng> --out <png> [--pad 84] [--scale 3]
import { sharp, loadRaw, lum, percentiles, arg } from './lib.mjs';

const rawPath = arg('raw'), srcPath = arg('src'), out = arg('out');
const pad = +arg('pad', 84), scale = +arg('scale', 3);
const MID = 160; // master ramp anchor #A0

const srcMeta = await sharp(srcPath).metadata();
const tw = srcMeta.width, th = srcMeta.height;

const cropped = await sharp(rawPath)
  .extract({ left: pad, top: pad, width: tw * scale, height: th * scale })
  .resize(tw, th, { kernel: 'lanczos3' })
  .ensureAlpha().raw().toBuffer();

const { data: srcData } = await loadRaw(srcPath);

const lums = [];
for (let i = 0; i < cropped.length; i += 4) if (srcData[i + 3] > 12) lums.push(lum(cropped, i));
lums.sort((a, b) => a - b);
const [p50] = percentiles(lums, [0.5]);
const k = MID / p50;

const outBuf = Buffer.alloc(cropped.length);
for (let i = 0; i < cropped.length; i += 4) {
  const v = Math.max(0, Math.min(255, Math.round(lum(cropped, i) * k)));
  outBuf[i] = outBuf[i + 1] = outBuf[i + 2] = v;
  outBuf[i + 3] = srcData[i + 3]; // source alpha verbatim
}
await sharp(outBuf, { raw: { width: tw, height: th, channels: 4 } }).png().toFile(out);
console.log(`candidate ${out}: ${tw}x${th} norm k=${k.toFixed(2)} (raw p50 ${Math.round(p50)})`);
