import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xumingyang/.npm-global/lib/node_modules/playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const outDir = path.join(__dirname, 'output');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1400, height: 1800 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!(window.lucide && window.lucide.createIcons))) {
  await page.evaluate(() => window.lucide.createIcons());
}

const posters = page.locator('section.poster.xhs');
const count = await posters.count();
console.log(`Found ${count} xhs posters`);
for (let i = 0; i < count; i++) {
  const el = posters.nth(i);
  const id = (await el.getAttribute('id')) || `xhs-${String(i + 1).padStart(2, '0')}`;
  const file = path.join(outDir, `${id}.png`);
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: file, type: 'png' });
  const box = await el.boundingBox();
  console.log(`Wrote ${file} (${Math.round(box?.width || 0)}x${Math.round(box?.height || 0)})`);
}
await browser.close();
console.log('Done');
