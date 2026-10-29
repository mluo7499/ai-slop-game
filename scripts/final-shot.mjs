// Final regression: fresh page → custom TDM room on Slopyard → gameplay screenshot →
// match-end results overlay (score limit 1) with bots.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGEERROR:', String(e)); });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto('http://127.0.0.1:3000', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'));

await page.evaluate(() => window.SLOPSTRIKE.net.create({
  mode: 'tdm', mapId: 'slopyard', bots: 4, maxPlayers: 10, isPublic: false,
  name: 'FINAL CHECK', settings: { scoreLimit: 1 },
}));
await page.waitForFunction(() => window.SLOPSTRIKE.game.active && window.SLOPSTRIKE.net.latest, null, { timeout: 15000 });
await page.waitForTimeout(1800);
const box = await page.locator('#viewport').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(400);
await page.keyboard.down('KeyW');
await page.waitForTimeout(500);
await page.keyboard.up('KeyW');
await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 2 + 30);
await page.waitForTimeout(700);
await page.screenshot({ path: 'artifacts/final-game.png' });
console.log('HUD:', await page.evaluate(() => ({
  weapon: document.getElementById('hud-weapon').textContent,
  hp: document.getElementById('hud-hp').textContent,
  ammo: `${document.getElementById('hud-mag').textContent}/${document.getElementById('hud-reserve').textContent}`,
  timer: document.getElementById('match-timer').textContent,
  perf: document.getElementById('perf').textContent,
})));

let results = false;
try {
  await page.waitForFunction(() => !document.getElementById('results').classList.contains('hidden'), null, { timeout: 30000 });
  results = true;
} catch { /* bots didn't finish in time */ }
if (results) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/final-results.png' });
  console.log('results:', await page.evaluate(() => ({
    title: document.getElementById('res-title').textContent,
    score: document.getElementById('res-score').textContent,
    kd: document.getElementById('res-kd').textContent,
    rows: document.querySelectorAll('#res-table tbody tr').length,
  })));
} else {
  console.log('results overlay: not reached within 30s');
}
console.log('PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
