// Headless browser smoke test: boots the menu, starts a match, moves/fires, opens
// the buy menu and editor, and captures screenshots for visual inspection.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
fs.mkdirSync('artifacts', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const consoleErrors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const shot = async (name) => {
  await page.screenshot({ path: `artifacts/${name}.png` });
  console.log(`[shot] artifacts/${name}.png`);
};

try {
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 20000 });
  await page.waitForTimeout(700);

  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  console.log('webgl:', webgl);
  console.log('profile:', await page.evaluate(() => window.SLOPSTRIKE?.net?.profile?.name || 'none'));
  await shot('menu');

  // start a quickplay match
  await page.click('#btn-quickplay');
  await page.waitForTimeout(2200);
  console.log('screen game active:', await page.evaluate(() => document.getElementById('screen-game').classList.contains('active')));
  console.log('room:', await page.evaluate(() => window.SLOPSTRIKE?.net?.room?.name || 'none'));
  console.log('font loaded:', await page.evaluate(() => document.fonts.check('16px "DejaVu Sans"')));
  await page.waitForTimeout(500);

  // buy menu while the buy window is still open
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(400);
  console.log('buy open:', await page.evaluate(() => !document.getElementById('buy-menu').classList.contains('hidden')));
  await shot('buy');
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(300);

  // click canvas to acquire pointer lock, then move + fire
  const box = await page.locator('#viewport').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  console.log('pointer locked:', await page.evaluate(() => document.pointerLockElement?.id || 'no'));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  await page.mouse.move(box.x + 900, box.y + 400);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(1400);
  await shot('game');

  const diag = await page.evaluate(() => {
    const S = window.SLOPSTRIKE;
    const me = S.net.me;
    const arr = S.net.getYouArray();
    return {
      phase: S.net.latest?.phase,
      hp: me?.hp, alive: me?.alive, money: me?.money, weapon: me?.active,
      pos: arr ? [arr[1], arr[2], arr[3]] : null,
      players: S.net.latest?.players?.length,
      snapshots: S.net.stats.snapshots,
      rtt: Math.round(S.net.rtt),
      fps: Math.round(S.game.fps),
      upscale: S.game.upscaler.getStatus(),
      hudWeapon: document.getElementById('hud-weapon')?.textContent,
      timer: document.getElementById('match-timer')?.textContent,
      perf: document.getElementById('perf')?.textContent,
      roster: S.net.roster.map((p) => `${p.name}:${p.team}`),
    };
  });
  console.log('DIAG', JSON.stringify(diag, null, 2));

  // scoreboard
  await page.keyboard.down('Tab');
  await page.waitForTimeout(400);
  await shot('scoreboard');
  await page.keyboard.up('Tab');

  // leave match through the pause overlay
  await page.evaluate(() => document.exitPointerLock?.());
  await page.waitForTimeout(500);
  console.log('pause visible:', await page.evaluate(() => !document.getElementById('pause-menu').classList.contains('hidden')));
  await page.click('#btn-leave-match');
  await page.waitForTimeout(900);
  console.log('back to menu:', await page.evaluate(() => document.getElementById('screen-menu').classList.contains('active')));
  await shot('menu-after');

  // shop
  await page.click('[data-tab="shop"]');
  await page.waitForTimeout(600);
  await shot('shop');
  console.log('shop cards:', await page.locator('.shop-card').count());

  // loadout
  await page.click('[data-tab="loadout"]');
  await page.waitForTimeout(500);
  await shot('loadout');

  // editor
  await page.click('[data-tab="maps"]');
  await page.waitForTimeout(400);
  await page.click('#btn-open-editor');
  await page.waitForTimeout(1200);
  console.log('editor active:', await page.evaluate(() => document.getElementById('screen-editor').classList.contains('active')));
  // place a block and orbit
  const ed = await page.locator('#editor-canvas').boundingBox();
  await page.mouse.move(ed.x + ed.width * 0.5, ed.y + ed.height * 0.55);
  await page.waitForTimeout(300);
  await page.mouse.click(ed.x + ed.width * 0.5, ed.y + ed.height * 0.55);
  await page.waitForTimeout(300);
  await page.mouse.move(ed.x + ed.width * 0.7, ed.y + ed.height * 0.3);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(ed.x + ed.width * 0.55, ed.y + ed.height * 0.4, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  console.log('editor blocks:', await page.evaluate(() => document.getElementById('ed-count')?.textContent));
  await shot('editor');

  console.log('PAGE ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log('CONSOLE ERRORS:', consoleErrors.length ? consoleErrors.slice(0, 12).join('\n') : 'none');
  if (errors.length) process.exitCode = 1;
} catch (err) {
  console.error('TEST FAILED:', err);
  await shot('failure');
  console.log('PAGE ERRORS:', errors.join('\n'));
  console.log('CONSOLE ERRORS:', consoleErrors.slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
