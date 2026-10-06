// Cut a shorter straight piece out of a finished 3x1 candidate strip.
// All straight lengths share band 68@y66 and tile edge-to-edge, so any segment
// of a strip is a valid shorter piece; the target source's alpha gives it the
// authentic per-length chipped-edge silhouette.
// node cut-piece.mjs --strip <3x1 candidate> --x <offset> --src <target source> --out <png>
import { sharp, loadRaw, arg } from './lib.mjs';

const strip = arg('strip'), x = +arg('x', 0), srcPath = arg('src'), out = arg('out');

const { data: srcData, w, h } = await loadRaw(srcPath);
const seg = await sharp(strip).extract({ left: x, top: 0, width: w, height: h })
  .ensureAlpha().raw().toBuffer();

const outBuf = Buffer.alloc(seg.length);
for (let i = 0; i < seg.length; i += 4) {
  outBuf[i] = seg[i]; outBuf[i + 1] = seg[i + 1]; outBuf[i + 2] = seg[i + 2];
  outBuf[i + 3] = srcData[i + 3];
}
await sharp(outBuf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
console.log(`cut ${out}: ${w}x${h} from ${strip}@x${x}`);
