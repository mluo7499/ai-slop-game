import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGEERROR:', String(e)); });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto('http://127.0.0.1:3000', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'));
await page.waitForTimeout(400);

await page.evaluate(() => window.SLOPSTRIKE.net.create({
  mode: 'bomb', mapId: 'neondistrict', bots: 4, maxPlayers: 12,
  isPublic: false, password: 'secret', name: 'BOMB TEST', settings: {},
}));
await page.waitForTimeout(3000);
const state = await page.evaluate(() => ({
  room: window.SLOPSTRIKE.net.room,
  latestPhase: window.SLOPSTRIKE.net.latest?.phase,
  screen: document.querySelector('.screen.active')?.id,
  toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
  gameActive: window.SLOPSTRIKE.game.active,
  errText: document.getElementById('conn-state')?.textContent,
}));
console.log('STATE', JSON.stringify(state, null, 2).slice(0, 2500));
await page.screenshot({ path: 'artifacts/debug-bomb.png' });
await page.waitForTimeout(8000);
console.log('later phase:', await page.evaluate(() => window.SLOPSTRIKE.net.latest?.phase), 'round:', await page.evaluate(() => window.SLOPSTRIKE.net.latest?.round));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
