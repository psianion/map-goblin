// Headless driver for the tier compositor's GL truth page. Run from session/client with the
// dev server already up: `node compositor-run.mjs`.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const lines = [];
page.on('console', (m) => { if (m.text().includes('[COMPOSITOR]')) lines.push(m.text()); });
page.on('pageerror', (e) => lines.push('[PAGEERROR] ' + e.message));
await page.goto('http://localhost:5602/compositor-check.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__compositorResults !== undefined, null, { timeout: 60000 });
const results = await page.evaluate(() => JSON.stringify(window.__compositorResults, null, 2));
console.log(lines.join('\n'));
console.log(results);
await browser.close();
process.exit(JSON.parse(results).allPass ? 0 : 1);
