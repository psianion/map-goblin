// Assembly demo: straights + corner + vertical run + T junction butted on the
// cell grid the way the wall renderer places them (rotations = renderer's).
// node demo-assembly.mjs --out <png>
import { sharp, arg } from './lib.mjs';

const out = arg('out');
const S3 = 'staging/stage3', S4 = 'staging/stage4';
const C = 200;

const rot = async (f, deg) => sharp(await sharp(f).png().toBuffer()).rotate(deg).png().toBuffer();
const place = async (f, cx, cy, deg = 0) =>
  ({ input: deg ? await rot(f, deg) : await sharp(f).png().toBuffer(), left: cx * C, top: cy * C });

const comps = [
  await place(`${S3}/3x1/3x1-s22.png`, 0, 0),          // top run west
  await place(`${S3}/1x1/1x1-cutA.png`, 3, 0),         // top run
  await place(`${S4}/corner-C/corner-C-comp.png`, 4, 0, 90),  // turn down
  await place(`${S3}/1x1/1x1-cutB.png`, 4, 1, 90),     // vertical run
  await place(`${S3}/3x1/3x1-s33.png`, 0, 2),          // bottom run west
  await place(`${S3}/1x1/1x1-cutC.png`, 3, 2),         // bottom run
  await place(`${S4}/joint-D/joint-D-comp.png`, 4, 2, 90), // T: vertical meets bottom run
];

await sharp({ create: { width: 5 * C, height: 3 * C, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).png().toFile(out);
console.log(`assembly ${out}: ${5 * C}x${3 * C}`);
