// Exercises every gamemode, custom-map hosting and the cosmetic purchase protocol
// against the live server over a real WebSocket.
import WebSocket from 'ws';

const URL = process.env.WS_URL || 'ws://127.0.0.1:3000/ws';
const results = [];
let ws;

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(URL);
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}
function send(obj) { ws.send(JSON.stringify(obj)); }
function waitFor(type, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === type) { clearTimeout(timer); ws.off('message', handler); resolve(msg); }
      if (msg.t === 'error' && type !== 'error') {
        clearTimeout(timer); ws.off('message', handler); reject(new Error(msg.msg));
      }
    };
    ws.on('message', handler);
  });
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

try {
  await connect();
  send({ t: 'hello', token: `modes-${Math.random().toString(36).slice(2)}`, name: 'MODETEST' });
  const prof = await waitFor('profile');
  console.log('profile coins:', prof.profile.coins);

  for (const mode of ['tdm', 'ffa', 'bomb', 'gungame', 'koth']) {
    const joinedP = waitFor('joined');
    send({ t: 'create', mode, mapId: mode === 'koth' ? 'cargohold' : 'slopyard', bots: 2, maxPlayers: 8, isPublic: false, name: `MODE ${mode}` });
    const joined = await joinedP;
    let snapshots = 0;
    const onS = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 's') snapshots++;
    };
    ws.on('message', onS);
    await wait(5500);
    ws.off('message', onS);
    const state = await new Promise((resolve) => {
      const h = (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.t === 's') { ws.off('message', h); resolve(m); }
      };
      ws.on('message', h);
    });
    results.push({ mode, snapshots, phase: state.phase, players: state.players.length, limit: state.limit, role: state.you?.role });
    send({ t: 'leave' });
    await wait(250);
  }
  console.log('modes:', results);

  // custom map hosting
  const customMap = {
    name: 'TEST BOX', tagline: 'unit test', halfX: 20, halfZ: 20,
    blocks: [
      { x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, m: 'floor', solid: true },
      { x: 0, y: 2, z: -20, w: 40, h: 4, d: 2, m: 'concrete', solid: true },
      { x: 0, y: 2, z: 20, w: 40, h: 4, d: 2, m: 'concrete', solid: true },
      { x: -20, y: 2, z: 0, w: 2, h: 4, d: 40, m: 'concrete', solid: true },
      { x: 20, y: 2, z: 0, w: 2, h: 4, d: 40, m: 'concrete', solid: true },
      { x: 0, y: 1, z: 0, w: 6, h: 2, d: 6, m: 'metal', solid: true },
    ],
    spawns: [{ x: 0, y: 0, z: 14, team: 0 }, { x: 0, y: 0, z: -14, team: 1 }],
    sites: [{ x: -8, z: 8, r: 4 }, { x: 8, z: -8, r: 4 }],
    hills: [{ x: 0, z: 0, r: 5 }],
  };
  const joinedP = waitFor('joined');
  send({ t: 'create', mode: 'tdm', customMap, bots: 0, maxPlayers: 8, isPublic: false, name: 'CUSTOM TEST' });
  const joined = await joinedP;
  console.log('custom map blocks:', joined.map.blocks.length, 'name:', joined.map.name);
  if (joined.map.blocks.length < 6) throw new Error('custom map not applied');
  send({ t: 'leave' });
  await wait(300);

  // shop purchase + equip slot
  send({ t: 'purchase', kind: 'finish', id: 'neondusk' });
  const bought = await waitFor('profile');
  const owned = bought.profile.owned.includes('finish:neondusk');
  console.log('purchase neondusk:', owned, 'coins now:', bought.profile.coins);
  if (!owned) throw new Error('purchase failed');
  send({ t: 'equipSlot', slot: 'finishPrimary', id: 'neondusk' });
  const equippedMsg = await waitFor('profile');
  console.log('equipped primary finish:', equippedMsg.profile.equipped.finishPrimary);
  if (equippedMsg.profile.equipped.finishPrimary !== 'neondusk') throw new Error('equip slot failed');

  // password-protected room: wrong then right password
  send({ t: 'create', mode: 'tdm', mapId: 'cargohold', bots: 0, maxPlayers: 8, isPublic: false, name: 'LOCKED', password: 'pw123' });
  const locked = await waitFor('joined');
  const code = locked.room.code;
  ws.close();
  await wait(300);

  ws = new WebSocket(URL);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  send({ t: 'hello', token: `modes2-${Math.random().toString(36).slice(2)}`, name: 'INTRUDER' });
  await waitFor('profile');
  send({ t: 'join', code, password: 'wrong' });
  const bad = await waitFor('error');
  console.log('wrong password rejected:', bad.msg);
  send({ t: 'join', code, password: 'pw123' });
  const good = await waitFor('joined');
  console.log('correct password joined:', good.room.code);

  console.log('MODES OK');
  process.exit(0);
} catch (err) {
  console.error('MODES FAILED:', err.message);
  process.exit(1);
}
