// Headless integration test: joins a room, streams inputs, and asserts that the
// authoritative simulation produces snapshots, movement, and match progress.
import WebSocket from 'ws';

const URL = process.env.WS_URL || 'ws://127.0.0.1:3000/ws';
const results = { snapshots: 0, events: [], errors: [], phases: new Set(), maxPlayers: 0, moved: 0, shots: 0, kills: 0 };

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitFor(ws, type, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

async function run(mode, seconds = 12) {
  const ws = await connect();
  ws.send(JSON.stringify({ t: 'hello', token: `smoke-${mode}-token-1234`, name: 'SmokeBot' }));
  const prof = await waitFor(ws, 'profile');
  if (!prof.profile) throw new Error('no profile returned');

  const joinedP = waitFor(ws, 'joined');
  ws.send(JSON.stringify({
    t: 'create', mode, mapId: mode === 'bomb' ? 'neondistrict' : 'slopyard',
    bots: 4, isPublic: false, name: `SMOKE ${mode}`,
  }));
  const joined = await joinedP;
  if (!joined.map?.blocks?.length) throw new Error('map blocks missing');
  const me = joined.youId;

  let seq = 0;
  let yaw = 0;
  const started = Date.now();
  const interval = setInterval(() => {
    seq++;
    yaw += 0.01;
    ws.send(JSON.stringify({
      t: 'input', seq, dt: 1 / 60, b: 1 | 128, yaw, pitch: 0, rtt: 48,
      slot: 1,
    }));
  }, 16);

  let myPos = null;
  const onMsg = (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'error') results.errors.push(msg.msg);
    if (msg.t !== 's') return;
    results.snapshots++;
    results.phases.add(msg.phase);
    results.maxPlayers = Math.max(results.maxPlayers, msg.players.length);
    if (msg.you?.hp !== undefined && msg.you.id === me) {
      const arr = msg.players.find((p) => p[0] === me);
      if (arr) {
        if (!myPos) myPos = { x: arr[1], z: arr[3] };
        else results.moved = Math.max(results.moved, Math.hypot(arr[1] - myPos.x, arr[3] - myPos.z));
      }
    }
    for (const ev of msg.ev || []) {
      if (ev.k === 'shot') results.shots++;
      if (ev.k === 'kill') results.kills++;
      if (['roundStart', 'roundEnd', 'live', 'plant', 'explode', 'matchStart'].includes(ev.k)) results.events.push(ev.k);
    }
  };
  ws.on('message', onMsg);

  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(interval);
  ws.off('message', onMsg);
  ws.send(JSON.stringify({ t: 'leave' }));
  await new Promise((r) => setTimeout(r, 250));
  ws.close();
  console.log(`[${mode}] ${seconds}s → snapshots=${results.snapshots} players=${results.maxPlayers} moved=${results.moved.toFixed(2)}m shots=${results.shots} kills=${results.kills}`);
  console.log(`[${mode}] phases=${[...results.phases].join(',')} events=${[...new Set(results.events)].join(',')} errors=${results.errors.length ? results.errors.join(';') : 'none'}`);
  if (results.snapshots < 40) throw new Error('too few snapshots — server loop may be stalled');
  if (results.moved < 0.5) throw new Error('player did not move');
  if (![...results.phases].includes('live')) throw new Error('match never went live');
  if (results.errors.length) throw new Error('server errors: ' + results.errors.join('; '));
}

try {
  await run('tdm', 10);
  results.snapshots = 0; results.events = []; results.errors = []; results.phases.clear();
  results.maxPlayers = 0; results.moved = 0; results.shots = 0; results.kills = 0;
  await run('bomb', 16);
  console.log('SMOKE OK');
  process.exit(0);
} catch (err) {
  console.error('SMOKE FAILED:', err.message);
  process.exit(1);
}
