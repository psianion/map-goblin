// Reads the GLYPHS literal out of ../src/shell/icons.tsx and writes it as
// window.GLYPHS in docs/mockups/2026-08-22-table-ui/icons-data.js, so the
// mockup page (plain HTML, can't import TSX) always shows the real icon
// data. Run manually after editing icons.tsx; not part of the build.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const iconsSrc = path.join(here, '..', 'src', 'shell', 'icons.tsx');
const outFile = path.join(here, '..', '..', '..', 'docs', 'mockups', '2026-08-22-table-ui', 'icons-data.js');

const src = readFileSync(iconsSrc, 'utf8');
const match = src.match(/const GLYPHS: Record<IconName, string> = (\{[\s\S]*?\n\});/);
if (!match) throw new Error('GLYPHS literal not found in icons.tsx');

// eslint-disable-next-line no-new-func -- trusted local source file, not user input
const glyphs = new Function(`return ${match[1]};`)();

const body = `window.GLYPHS = ${JSON.stringify(glyphs, null, 2)};\n`;
writeFileSync(outFile, body);
console.log(`wrote ${Object.keys(glyphs).length} glyphs to ${outFile}`);
