import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_MAPS, MAP_BY_ID, sanitizeMap } from '../shared/maps.js';
import { MODE_DEFS, DEFAULT_SETTINGS, clamp, TICK_HZ } from '../shared/constants.js';
import { Room } from './room.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'data');
const MAP_FILE = path.join(DATA_DIR, 'maps.json');

export class RoomManager {
  constructor(profiles) {
    this.profiles = profiles;
    this.rooms = new Map();
    this.maps = new Map(BUILTIN_MAPS.map((m) => [m.id, m]));
    this.customMaps = [];
    this.loadCustomMaps();
    setInterval(() => this.cleanup(), 20000).unref?.();
    this.startLoop();
  }

  /** Single fixed-timestep loop drives every room: stable physics, low CPU. */
  startLoop() {
    this.lastLoop = performance.now();
    this.accumulator = 0;
    const step = 1 / TICK_HZ;
    this.loop = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(0.25, (now - this.lastLoop) / 1000);
      this.lastLoop = now;
      this.accumulator += elapsed;
      let guard = 0;
      while (this.accumulator >= step && guard++ < 8) {
        this.accumulator -= step;
        for (const room of this.rooms.values()) {
          try { room.tick(step); } catch (err) {
            console.error(`[room ${room.id}] tick error:`, err);
          }
        }
      }
    }, 1000 / TICK_HZ);
    this.loop.unref?.();
  }

  loadCustomMaps() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(MAP_FILE)) {
        const list = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
        for (const raw of list.slice(0, 60)) {
          try {
            const map = sanitizeMap(raw);
            if (map.custom) {
              this.customMaps.push(map);
              this.maps.set(map.id, map);
            }
          } catch { /* skip broken entry */ }
        }
      }
    } catch (err) {
      console.warn('[maps] load failed:', err.message);
    }
  }

  saveCustomMaps() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(MAP_FILE, JSON.stringify(this.customMaps.slice(-60)));
    } catch (err) {
      console.warn('[maps] save failed:', err.message);
    }
  }

  mapCatalog() {
    return [
      ...BUILTIN_MAPS.map((m) => ({ id: m.id, name: m.name, tagline: m.tagline, custom: false })),
      ...this.customMaps.map((m) => ({ id: m.id, name: m.name, tagline: m.tagline, custom: true })),
    ];
  }

  getMap(id) {
    if (!id) return BUILTIN_MAPS[0];
    return this.maps.get(id) || MAP_BY_ID[id] || BUILTIN_MAPS[0];
  }

  publishMap(raw) {
    const map = sanitizeMap(raw);
    map.id = map.id && !this.maps.has(map.id) ? map.id : `c${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;
    this.customMaps.push(map);
    this.maps.set(map.id, map);
    this.saveCustomMaps();
    return { id: map.id, name: map.name, maps: this.mapCatalog() };
  }

  deleteMap(id, token) {
    const idx = this.customMaps.findIndex((m) => m.id === id);
    if (idx >= 0) {
      const [map] = this.customMaps.splice(idx, 1);
      this.maps.delete(map.id);
      this.saveCustomMaps();
    }
    return this.mapCatalog();
  }

  listRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic)
      .sort((a, b) => (b.players.size + b.bots.size) - (a.players.size + a.bots.size))
      .map((r) => r.publicInfo());
  }

  create(profile, ws, opts = {}) {
    const mode = MODE_DEFS[opts.mode] ? opts.mode : 'tdm';
    let map;
    if (opts.customMap) {
      try { map = sanitizeMap(opts.customMap); } catch { map = this.getMap(opts.mapId); }
    } else {
      map = this.getMap(opts.mapId);
    }
    const room = new Room(this, {
      mode,
      map,
      name: opts.name,
      isPublic: opts.isPublic !== false,
      password: opts.password,
      maxPlayers: opts.maxPlayers,
      bots: opts.bots,
      settings: opts.settings,
      hostToken: profile.token,
    });
    this.rooms.set(room.id, room);
    // the creator implicitly knows their own password
    return this.joinRoom(profile, ws, room, room.password);
  }

  joinRoom(profile, ws, room, password) {
    if (room.password && room.password !== password) throw new Error('Wrong room password');
    if (room.players.size >= room.maxPlayers) throw new Error('Room is full');
    const player = room.addHuman(profile, ws, profile.name);
    return { room, player };
  }

  joinById(profile, ws, { roomId, code, password }) {
    let room = roomId ? this.rooms.get(roomId) : null;
    if (!room && code) {
      const c = String(code).toUpperCase().trim();
      room = [...this.rooms.values()].find((r) => r.code === c);
    }
    if (!room) throw new Error('Room not found');
    return this.joinRoom(profile, ws, room, password);
  }

  quickplay(profile, ws, mode) {
    const candidates = [...this.rooms.values()].filter((r) =>
      r.isPublic && !r.password && r.players.size < r.maxPlayers && (!mode || r.modeId === mode) && (r.phase !== 'ended'));
    candidates.sort((a, b) => (b.players.size + b.bots.size) - (a.players.size + a.bots.size));
    if (candidates.length) return this.joinRoom(profile, ws, candidates[0]);
    return this.create(profile, ws, {
      mode: mode || 'tdm',
      mapId: BUILTIN_MAPS[Math.floor(Math.random() * BUILTIN_MAPS.length)].id,
      bots: 4, isPublic: true, maxPlayers: 12,
      name: `${MODE_DEFS[mode || 'tdm'].short} · QUICKPLAY`,
    });
  }

  leave(profile, ws) {
    for (const room of this.rooms.values()) {
      const p = [...room.players.values()].find((pl) => pl.token === profile.token);
      if (p) {
        room.removePlayer(p);
        if (room.players.size === 0) room.syncBots();
      }
    }
    return this.listRooms();
  }

  cleanup() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.players.size === 0 && now - room.lastHumanAt > 120000) {
        this.rooms.delete(id);
      }
    }
  }

  awardMatch(room) {
    if (room.awarded) return;
    room.awarded = true;
    const winnerTeam = typeof room.winner === 'number' && room.winner >= 0 ? room.winner : -1;
    for (const p of room.players.values()) {
      if (!p.token) continue;
      const win = room.mode.teamBased
        ? winnerTeam >= 0 && p.team === winnerTeam
        : winnerTeam === p.id;
      const coins = Math.min(900, 25 + p.kills * 9 + Math.round(p.score * 1.5) + (win ? 140 : 25));
      const xp = Math.min(1400, 40 + p.kills * 12 + (p.headshots || 0) * 4 + (win ? 150 : 0));
      const reward = this.profiles.reward(p.token, {
        coins, xp, kills: p.kills, deaths: p.deaths,
        headshots: p.headshots || 0, win,
        seconds: Math.round((Date.now() - room.createdAt) / 1000),
      });
      if (p.ws && p.ws.readyState === 1) {
        p.ws.send(JSON.stringify({
          t: 'rewards', coins, xp, levels: reward.levels,
          profile: reward.profile, win,
        }));
      }
    }
  }

  broadcastLobby() {
    const rooms = this.listRooms();
    // lobby browsers get refreshed on demand instead of pushed, to keep traffic tiny
    return rooms;
  }
}
