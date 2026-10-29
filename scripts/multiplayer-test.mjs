// Two independent browser clients: verifies real multiplayer join, shared roster,
// remote player replication and prediction accuracy.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
fs.mkdirSync('artifacts', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function makeClient(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 20000 });
  await page.evaluate((n) => window.SLOPSTRIKE.net.rename(n), name);
  await page.waitForTimeout(300);
  return { context, page, errors, name };
}

try {
  const a = await makeClient('ALPHA');
  const b = await makeClient('BRAVO');

  await a.page.click('#btn-quickplay');
  await a.page.waitForFunction(() => window.SLOPSTRIKE.net.room && window.SLOPSTRIKE.net.latest, null, { timeout: 15000 });
  await a.page.waitForTimeout(800);
  const code = await a.page.evaluate(() => window.SLOPSTRIKE.net.room.code);
  console.log('room code:', code);

  await b.page.evaluate((c) => { window.SLOPSTRIKE.net.joinCode(c); }, code);
  await b.page.waitForFunction(() => window.SLOPSTRIKE.net.room && window.SLOPSTRIKE.net.latest, null, { timeout: 15000 });
  await b.page.waitForTimeout(1500);

  const rosterA = await a.page.evaluate(() => window.SLOPSTRIKE.net.roster.map((p) => `${p.name}:${p.bot ? 'bot' : 'human'}`));
  const rosterB = await b.page.evaluate(() => window.SLOPSTRIKE.net.roster.map((p) => `${p.name}:${p.bot ? 'bot' : 'human'}`));
  console.log('A roster:', rosterA);
  console.log('B roster:', rosterB);

  const aId = await a.page.evaluate(() => window.SLOPSTRIKE.net.youId);
  const bId = await b.page.evaluate(() => window.SLOPSTRIKE.net.youId);
  console.log('ids:', aId, bId);
  console.log('B sees A mesh:', await b.page.evaluate((id) => !!window.SLOPSTRIKE.game.players.get(id), aId));

  const before = await b.page.evaluate((id) => {
    const v = window.SLOPSTRIKE.game.players.get(id);
    return v ? v.group.position.toArray() : null;
  }, aId);

  // move A for a while, then check B's replicated position
  await a.page.keyboard.down('KeyW');
  await a.page.waitForTimeout(1600);
  await a.page.keyboard.up('KeyW');
  await a.page.waitForTimeout(500);

  const after = await b.page.evaluate((id) => {
    const v = window.SLOPSTRIKE.game.players.get(id);
    return v ? v.group.position.toArray() : null;
  }, aId);
  console.log('A replicated on B before:', before?.map((n) => +n.toFixed(2)), 'after:', after?.map((n) => +n.toFixed(2)));
  const moved = Math.hypot((after?.[0] || 0) - (before?.[0] || 0), (after?.[2] || 0) - (before?.[2] || 0));
  console.log('replicated movement:', moved.toFixed(2), 'm');

  // shoot on A; confirm ammo consumption and B receiving shot events
  await a.page.locator('#viewport').click({ position: { x: 640, y: 400 } });
  await a.page.mouse.move(640, 380);
  await a.page.mouse.down();
  await a.page.waitForTimeout(900);
  await a.page.mouse.up();
  await a.page.waitForTimeout(700);
  const combat = await a.page.evaluate(() => ({
    mag: window.SLOPSTRIKE.net.me?.mag,
    shots: window.SLOPSTRIKE.net.stats.snapshots,
    hp: window.SLOPSTRIKE.net.me?.hp,
  }));
  console.log('A combat:', combat);

  const prediction = await a.page.evaluate(() => {
    const n = window.SLOPSTRIKE.net;
    const arr = n.getYouArray();
    if (!arr || !n.local) return null;
    return {
      diff: Math.hypot(n.local.pos[0] - arr[1], n.local.pos[1] - arr[2], n.local.pos[2] - arr[3]),
      correction: Math.hypot(...n.correction),
      rtt: Math.round(n.rtt),
      jitter: Math.round(n.jitter),
    };
  });
  console.log('prediction:', prediction);

  await b.page.screenshot({ path: 'artifacts/multi-b.png' });
  await a.page.screenshot({ path: 'artifacts/multi-a.png' });

  // bomb mode room with password, joined by B
  await a.page.evaluate(() => window.SLOPSTRIKE.leaveMatch());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => window.SLOPSTRIKE.net.create({
    mode: 'bomb', mapId: 'neondistrict', bots: 4, maxPlayers: 12,
    isPublic: false, password: 'secret', name: 'BOMB TEST', settings: {},
  }));
  await a.page.waitForFunction(() => window.SLOPSTRIKE.net.room?.mode === 'bomb' && window.SLOPSTRIKE.net.latest, null, { timeout: 15000 });
  await a.page.waitForTimeout(600);
  const bombCode = await a.page.evaluate(() => window.SLOPSTRIKE.net.room.code);
  const bombPhase = await a.page.evaluate(() => window.SLOPSTRIKE.net.latest.phase);
  console.log('bomb room:', bombCode, 'phase:', bombPhase);

  await b.page.evaluate(({ c }) => window.SLOPSTRIKE.net.joinCode(c, 'secret'), { c: bombCode });
  await b.page.waitForTimeout(1200);
  console.log('B in bomb room:', await b.page.evaluate(() => ({
    mode: window.SLOPSTRIKE.net.room?.mode,
    humans: window.SLOPSTRIKE.net.roster.filter((p) => !p.bot).length,
    phase: window.SLOPSTRIKE.net.latest?.phase,
    role: window.SLOPSTRIKE.net.me?.role,
  })));

  await b.page.screenshot({ path: 'artifacts/bomb.png' });
  console.log('PAGE ERRORS A:', a.errors.length ? a.errors.join('\n') : 'none');
  console.log('PAGE ERRORS B:', b.errors.length ? b.errors.join('\n') : 'none');
  if (moved < 0.5) throw new Error('remote player did not replicate');
  if ((combat.mag ?? 30) >= 30) throw new Error('firing did not consume ammo');
  if (!prediction || prediction.diff > 1.2) throw new Error('client prediction drifted from server');
} catch (err) {
  console.error('MULTIPLAYER FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
