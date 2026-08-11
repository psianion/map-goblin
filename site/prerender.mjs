// Patches the built dist/index.html with static markup from the SSR entry so
// the page is complete before any JS/WebGL loads (P1 no-JS/SEO floor).
import { readFileSync, writeFileSync } from 'node:fs';
import { render } from './dist-ssr/entry-server.js';

const distIndex = './dist/index.html';
const html = readFileSync(distIndex, 'utf-8');
const appHtml = render();
writeFileSync(distIndex, html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`));
