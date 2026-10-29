import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';
import { ProfileStore } from './profiles.js';
import { MODE_DEFS, BUY_ITEMS, clamp } from '../shared/constants.js';
import { CATALOG, ITEM_BY_ID, sanitizeEquipped } from '../shared/shop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const THREE_FILE = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function sendFile(res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function json(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const profiles = new ProfileStore();
const manager = new RoomManager(profiles);

function readBody(req, limit = 600 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = '/'; }

  if (pathname === '/api/health') return json(res, { ok: true, rooms: manager.rooms.size, uptime: process.uptime() });
  if (pathname === '/api/maps' && req.method === 'GET') return json(res, { maps: manager.mapCatalog(), custom: manager.customMaps });
  if (pathname === '/api/maps' && req.method === 'POST') {
    try {
      const raw = JSON.parse(await readBody(req));
      const out = manager.publishMap(raw);
      return json(res, out);
    } catch (err) {
      return json(res, { error: err.message }, 400);
    }
  }
  if (pathname.startsWith('/api/maps/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    return json(res, { maps: manager.deleteMap(id) });
  }
  if (pathname === '/api/catalog') return json(res, { catalog: CATALOG, buy: BUY_ITEMS, modes: Object.values(MODE_DEFS) });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }

  if (pathname === '/vendor/three.module.js') return sendFile(res, THREE_FILE);
  if (pathname.startsWith('/shared/')) {
    const target = path.join(SHARED_DIR, pathname.slice('/shared/'.length));
    if (!target.startsWith(SHARED_DIR)) { res.writeHead(403); res.end(); return; }
    return sendFile(res, target);
  }
  if (pathname.startsWith('/data/')) { res.writeHead(404); res.end(); return; }
  let target = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  if (!target.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(target) && !path.extname(target)) target = path.join(PUBLIC_DIR, 'index.html');
  sendFile(res, target);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 700 * 1024, perMessageDeflate: true, clientTracking: true });

const MAX_ROOMS = 120;
function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* socket closed */ }
}

function joinClient(client, room, player) {
  client.room = room;
  client.player = player;
  player.ws = client.ws;
  safeSend(client.ws, {
    t: 'joined',
    room: room.roomInfo(),
    map: room.mapSummary(),
    roster: room.roster(),
    youId: player.id,
    hostToken: room.hostToken,
    modeDef: room.mode,
    buyItems: BUY_ITEMS,
  });
  room.sendRoster();
  room.broadcast({ t: 'sys', text: `${player.name} joined`, kind: 'join' }, player.id);
}

function leaveRoom(client, silent = false) {
  const room = client.room;
  const player = client.player;
  if (!room || !player) { client.room = null; client.player = null; return; }
  if (!silent) room.broadcast({ t: 'sys', text: `${player.name} left`, kind: 'leave' });
  room.removePlayer(player);
  client.room = null;
  client.player = null;
}

wss.on('connection', (ws) => {
  const client = { ws, token: null, profile: null, room: null, player: null, alive: true, msgs: 0, windowStart: Date.now() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  safeSend(ws, { t: 'hello', serverTime: Date.now(), modes: Object.keys(MODE_DEFS), maps: manager.mapCatalog() });

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - client.windowStart > 1000) { client.windowStart = now; client.msgs = 0; }
    if (++client.msgs > 400) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    try {
      switch (msg.t) {
        case 'hello': {
          client.token = String(msg.token || '').slice(0, 64) || null;
          const profile = profiles.get(client.token, String(msg.name || 'Recruit').slice(0, 16));
          client.token = profile.token;
          client.profile = profile;
          safeSend(ws, {
            t: 'profile', profile: profiles.view(profile.token),
            rooms: manager.listRooms(), maps: manager.mapCatalog(),
            serverTime: Date.now(),
          });
          break;
        }
        case 'rename': {
          if (!client.profile) return;
          const name = profiles.rename(client.profile.token, msg.name);
          client.profile = profiles.get(client.profile.token);
          if (client.player) client.player.name = name;
          if (client.room) client.room.sendRoster();
          safeSend(ws, { t: 'profile', profile: profiles.view(client.profile.token) });
          break;
        }
        case 'loadout': {
          if (!client.profile) return;
          const loadout = profiles.setLoadout(client.profile.token, msg.loadout);
          client.profile = profiles.get(client.profile.token);
          if (client.player) client.player.loadout = loadout;
          safeSend(ws, { t: 'profile', profile: profiles.view(client.profile.token) });
          break;
        }
        case 'purchase': {
          if (!client.profile) return;
          const item = ITEM_BY_ID[`${msg.kind}:${msg.id}`];
          if (!item) return safeSend(ws, { t: 'error', msg: 'Unknown item' });
          const out = profiles.purchase(client.profile.token, item);
          client.profile = profiles.get(client.profile.token);
          safeSend(ws, out.ok
            ? { t: 'profile', profile: out.profile, toast: `Purchased ${item.name}` }
            : { t: 'error', msg: out.error });
          break;
        }
        case 'equip': {
          if (!client.profile) return;
          const out = profiles.equip(client.profile.token, msg.kind, msg.id);
          client.profile = profiles.get(client.profile.token);
          if (out.ok) safeSend(ws, { t: 'profile', profile: out.profile });
          else safeSend(ws, { t: 'error', msg: out.error });
          if (client.room) client.room.sendRoster();
          break;
        }
        case 'equipSlot': {
          if (!client.profile) return;
          const p = profiles.get(client.profile.token);
          const slotKinds = { finishPrimary: 'finish', finishSecondary: 'finish', finishKnife: 'finish', body: 'body', tracer: 'tracer' };
          const kind = slotKinds[msg.slot];
          if (!kind) return;
          const id = String(msg.id || '');
          if (!p.owned.includes(`${kind}:${id}`)) return safeSend(ws, { t: 'error', msg: 'Item not owned' });
          p.equipped[msg.slot] = id;
          p.equipped = sanitizeEquipped(p.equipped, p.owned);
          profiles.dirty = true;
          client.profile = p;
          safeSend(ws, { t: 'profile', profile: profiles.view(p.token) });
          if (client.room) client.room.sendRoster();
          break;
        }
        case 'rooms': {
          safeSend(ws, { t: 'rooms', rooms: manager.listRooms() });
          break;
        }
        case 'create': {
          if (!client.profile) return;
          if (client.room) leaveRoom(client);
          if (manager.rooms.size >= MAX_ROOMS) throw new Error('Server is at capacity');
          const out = manager.create(client.profile, ws, msg);
          joinClient(client, out.room, out.player);
          safeSend(ws, { t: 'rooms', rooms: manager.listRooms() });
          break;
        }
        case 'join': {
          if (!client.profile) return;
          if (client.room) leaveRoom(client);
          const out = manager.joinById(client.profile, ws, msg);
          joinClient(client, out.room, out.player);
          break;
        }
        case 'quickplay': {
          if (!client.profile) return;
          if (client.room) leaveRoom(client);
          const out = manager.quickplay(client.profile, ws, msg.mode);
          joinClient(client, out.room, out.player);
          break;
        }
        case 'leave': {
          leaveRoom(client);
          safeSend(ws, { t: 'left', rooms: manager.listRooms() });
          break;
        }
        case 'input': {
          if (client.room && client.player) {
            if (msg.rtt) client.player.pingMs = client.player.pingMs * 0.8 + clamp(Number(msg.rtt) || 0, 0, 500) * 0.2;
            client.room.handleInput(client.player, msg);
          }
          break;
        }
        case 'nade': {
          if (client.room && client.player) client.room.throwGrenade(client.player, Number(msg.yaw) || 0, Number(msg.pitch) || 0);
          break;
        }
        case 'buy': {
          if (!client.room || !client.player) return;
          const out = client.room.buyItem(client.player, String(msg.item || ''));
          if (!out.ok) safeSend(ws, { t: 'error', msg: out.error });
          else safeSend(ws, { t: 'buyOk', item: msg.item });
          break;
        }
        case 'chat': {
          if (!client.room || !client.player) return;
          const text = String(msg.text || '').replace(/[<>&\u0000-\u001f]/g, '').trim().slice(0, 140);
          if (!text) return;
          if (Date.now() - (client.lastChat || 0) < 700) return;
          client.lastChat = Date.now();
          client.room.broadcast({ t: 'chat', id: client.player.id, name: client.player.name, text });
          break;
        }
        case 'cmd': {
          if (!client.room || !client.player) return;
          const room = client.room;
          const host = room.isHost(client.player);
          if (msg.a === 'restart') {
            room.restart();
            room.broadcast({ t: 'sys', text: `${client.player.name} restarted the match` });
          } else if (msg.a === 'kick' && host) {
            const target = room.players.get(Number(msg.id));
            if (target && target.ws) {
              safeSend(target.ws, { t: 'kicked', msg: 'Removed by host' });
              leaveRoom({ room, player: target, ws: target.ws });
            }
          } else if (msg.a === 'settings' && host) {
            room.settings = {
              ...room.settings,
              ...Object.fromEntries(Object.entries(msg.settings || {}).filter(([k]) => k in room.settings)),
            };
            room.pushEvent({ k: 'sys', text: 'Rules updated by host' });
            room.sendRoster();
          } else if (msg.a === 'bots' && host) {
            room.botsWanted = clamp(Number(msg.count) || 0, 0, 10);
            room.syncBots();
          }
          break;
        }
        case 'publishMap': {
          const out = manager.publishMap(msg.map);
          safeSend(ws, { t: 'mapSaved', ...out });
          break;
        }
        case 'ping': {
          safeSend(ws, { t: 'pong', c: msg.c, s: Date.now() });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      safeSend(ws, { t: 'error', msg: err.message });
    }
  });

  ws.on('close', () => {
    client.alive = false;
    if (client.room && client.player) {
      client.room.broadcast({ t: 'sys', text: `${client.player.name} disconnected`, kind: 'leave' });
      client.room.removePlayer(client.player);
    }
    client.room = null;
    client.player = null;
  });
  ws.on('error', () => { /* ignore */ });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 25000);
heartbeat.unref?.();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[slopstrike] listening on http://0.0.0.0:${PORT}`);
  console.log(`[slopstrike] rooms=${manager.rooms.size} maps=${manager.mapCatalog().length}`);
});

function shutdown() {
  console.log('[slopstrike] shutting down');
  clearInterval(heartbeat);
  profiles.flush();
  for (const ws of wss.clients) ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
