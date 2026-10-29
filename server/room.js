// Authoritative game room. Simulates movement, weapons, modes and broadcasts
// compact snapshots at SNAPSHOT_HZ.
import {
  TICK_HZ, SNAPSHOT_HZ, PHYS, BTN, WEAPONS, MODE_DEFS, ECONOMY, DEFAULT_SETTINGS,
  clamp, INTERP_MS, spreadFor, playerHeight, eyeHeight, DEG, BUY_ITEMS,
} from '../shared/constants.js';
import {
  createPlayerState, stepPlayer, makeWorld, rayWorld, rayPlayer, directionFromAngles,
  angleFromDirection, hasLineOfSight, groundHeight, stepProjectile,
} from '../shared/physics.js';
import { updateBot } from './bots.js';

const GUN_LADDER = ['p9', 'mp9', 'breacher', 'ak', 'm4', 'deagle', 'awp', 'knife'];
const SAFE_CHARS = /[<>&"]/g;
const cleanName = (s) => String(s || 'Recruit').replace(SAFE_CHARS, '').trim().slice(0, 16) || 'Recruit';

let ROOM_SEQ = 1;

export class Room {
  constructor(manager, opts) {
    this.manager = manager;
    this.id = `r${ROOM_SEQ++}-${Math.random().toString(36).slice(2, 6)}`;
    this.code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    this.modeId = MODE_DEFS[opts.mode] ? opts.mode : 'tdm';
    this.mode = MODE_DEFS[this.modeId];
    this.map = opts.map;
    this.world = makeWorld(this.map.blocks);
    this.name = String(opts.name || `${this.mode.short} · ${this.map.name}`).slice(0, 34);
    this.isPublic = opts.isPublic !== false;
    this.password = String(opts.password || '').slice(0, 24);
    this.maxPlayers = clamp(Number(opts.maxPlayers) || 12, 2, 16);
    this.hostToken = opts.hostToken || null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...Object.fromEntries(Object.entries(opts.settings || {}).filter(([k]) => k in DEFAULT_SETTINGS)),
    };
    this.settings = {
      scoreLimit: this.settings.scoreLimit || 0,
      timeLimit: this.settings.timeLimit || 0,
      speedScale: clamp(this.settings.speedScale, 0.4, 2.2),
      gravityScale: clamp(this.settings.gravityScale, 0.15, 2.2),
      jumpScale: clamp(this.settings.jumpScale, 0.3, 2.4),
      damageScale: clamp(this.settings.damageScale, 0.15, 3.5),
      health: clamp(this.settings.health, 25, 400),
      armorStart: clamp(this.settings.armorStart, 0, 100),
      headshotsOnly: !!this.settings.headshotsOnly,
      friendlyFire: !!this.settings.friendlyFire,
      infiniteAmmo: !!this.settings.infiniteAmmo,
      infiniteGrenades: !!this.settings.infiniteGrenades,
      respawnDelay: this.settings.respawnDelay || 0,
      maxBots: clamp(this.settings.maxBots, 0, 10),
      botDifficulty: ['easy', 'normal', 'hard', 'insane'].includes(this.settings.botDifficulty) ? this.settings.botDifficulty : 'normal',
    };
    this.botsWanted = clamp(Number(opts.bots) || 0, 0, 10);
    if (this.modeId === 'bomb') this.botsWanted = Math.max(this.botsWanted, 2);
    this.players = new Map();
    this.bots = new Map();
    this.nextId = 1;
    this.now = 0;
    this.tickCount = 0;
    this.scores = [0, 0];
    this.phase = 'warmup';
    this.phaseTime = this.mode.warmup || 5;
    this.round = 0;
    this.roundTimer = 0;
    this.roundResult = null;
    this.winner = null;
    this.bomb = null;
    this.hillIndex = 0;
    this.hillOwner = -1;
    this.hillRotateIn = this.mode.hillRotateTime || 45;
    this.hill = this.map.hills?.[0] || { x: 0, z: 0, r: 7, label: 'HILL' };
    this.events = [];
    this.chat = [];
    this.projectiles = [];
    this.startedAt = Date.now();
    this.createdAt = Date.now();
    this.lastHumanAt = Date.now();
    this.awarded = false;
    this.timeLimitLeft = (this.settings.timeLimit || this.mode.timeLimit || 600);
    this.syncBots();
  }

  // --------------------------------------------------------------- lifecycle
  addHuman(profile, ws, name) {
    const existing = [...this.players.values()].find((p) => p.token === profile.token);
    if (existing) {
      existing.ws = ws;
      existing.disconnectedAt = 0;
      existing.name = cleanName(name || profile.name);
      return existing;
    }
    if (this.players.size >= this.maxPlayers) throw new Error('Room is full');
    const id = this.nextId++;
    const team = this.mode.teamBased ? (this.teamCount(0) <= this.teamCount(1) ? 0 : 1) : -1;
    const p = this.makePlayer({
      id, token: profile.token, name: cleanName(name || profile.name),
      team, ws, isBot: false, profile,
    });
    p.equipped = profile.equipped || null;
    p.loadout = profile.loadout || p.loadout;
    this.players.set(id, p);
    this.lastHumanAt = Date.now();
    this.spawnPlayer(p, { resetWeapons: true });
    this.pushEvent({ k: 'join', id: p.id, name: p.name });
    return p;
  }

  makePlayer(base) {
    const p = {
      ...base,
      kills: 0, deaths: 0, assists: 0, headshots: 0, score: 0,
      money: this.modeId === 'bomb' ? ECONOMY.start : 4000,
      health: this.settings.health, armor: this.settings.armorStart, helmet: false,
      alive: false, respawnAt: 0, spawnProtectedUntil: 0,
      phys: createPlayerState(0, 0, 0),
      loadout: base.profile?.loadout || { primary: 'ak', secondary: 'p9' },
      slots: { 1: null, 2: 'p9', 3: 'knife' },
      ammo: {}, active: 'p9', activeSlot: 2,
      fireHeld: false, useHeld: false, reloadUntil: 0, nextFireAt: 0, shotIndex: 0,
      lastShotAt: -9, scoped: false, grenades: 0, lastNadeAt: -9,
      plantProgress: 0, defuseProgress: 0, lastUseAt: -9,
      inputQueue: [], lastSeq: 0, ping: 60, history: [],
      pending: [], color: null, gunLevel: 0, role: 'atk',
      protectedUntil: 0, lastDamageFrom: null, lastDamageAt: 0,
      spawnAt: 0, deathPos: null, connectedAt: Date.now(),
      disconnectedAt: 0, pingMs: 60, jitter: 0,
    };
    p.color = base.isBot ? (base.team === 1 ? '#4aa8ff' : '#ff6b4a') : null;
    return p;
  }

  addBot(team, difficulty) {
    const id = this.nextId++;
    const bot = this.makePlayer({
      id, token: null, name: `BOT ${String(id).padStart(2, '0')}`,
      team: this.mode.teamBased ? (team ?? (this.teamCount(0) <= this.teamCount(1) ? 0 : 1)) : -1,
      ws: null, isBot: true,
      profile: { name: 'BOT', loadout: { primary: Math.random() < 0.5 ? 'ak' : 'm4', secondary: 'p9' } },
    });
    bot.difficulty = difficulty || this.settings.botDifficulty;
    bot.brain = {
      think: 0, goal: null, targetId: 0, reactAt: 0, strafe: 1,
      strafeTimer: 0, burstUntil: 0, burstPause: 0, stuck: 0, lastGoalAt: 0,
    };
    this.bots.set(id, bot);
    this.botBuy(bot);
    this.spawnPlayer(bot, { resetWeapons: true });
    return bot;
  }

  removeBot() {
    const bots = [...this.bots.values()];
    const bot = bots[bots.length - 1];
    if (!bot) return;
    this.bots.delete(bot.id);
    this.players.delete(bot.id);
  }

  syncBots() {
    let guard = 0;
    while (this.bots.size < this.botsWanted && guard++ < 20) this.addBot();
    while (this.bots.size > this.botsWanted && guard++ < 40) this.removeBot();
  }

  teamCount(team, excludeId = 0) {
    let n = 0;
    for (const p of this.allPlayers()) if (p.team === team && p.id !== excludeId) n++;
    return n;
  }

  allPlayers() {
    return [...this.players.values(), ...this.bots.values()];
  }

  humanCount() {
    return this.players.size;
  }

  removePlayer(p) {
    this.players.delete(p.id);
    this.pushEvent({ k: 'leave', id: p.id, name: p.name });
    if (this.hostToken === p.token) {
      const next = this.players.values().next().value;
      this.hostToken = next ? next.token : null;
      if (next) this.pushEvent({ k: 'host', id: next.id });
    }
    if (this.players.size === 0) this.lastHumanAt = Date.now();
    else this.syncBots();
  }

  isHost(p) {
    return p && p.token && p.token === this.hostToken;
  }

  // ------------------------------------------------------------------ spawns
  pickSpawn(team, role) {
    const spawns = this.map.spawns?.length ? this.map.spawns : [{ x: 0, y: 0, z: 0, team: 0 }];
    let list = spawns.filter((s) => s.team === team);
    if (this.modeId === 'bomb') {
      const wantTeam = role === 'atk' ? 0 : 1;
      list = spawns.filter((s) => s.team === wantTeam);
    }
    if (!list.length) list = spawns;
    const base = list[Math.floor(Math.random() * list.length)];
    const jitter = () => (Math.random() - 0.5) * 3;
    let best = { x: base.x + jitter(), z: base.z + jitter() };
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = base.x + jitter();
      const z = base.z + jitter();
      const y = groundHeight(this.world, x, z, 40);
      const clear = !this.allPlayers().some((o) => o !== null && o.alive && Math.hypot(o.phys.pos[0] - x, o.phys.pos[2] - z) < 1.2);
      if (clear) { best = { x, z, y }; break; }
      best = { x, z, y };
    }
    const y = best.y ?? groundHeight(this.world, best.x, best.z, 40);
    return [best.x, y + 0.02, best.z];
  }

  spawnPlayer(p, { resetWeapons = false } = {}) {
    if (!p.isBot && p.role === undefined) p.role = 'atk';
    if (this.modeId === 'bomb') {
      p.role = (p.team === 0) !== (this.halftimeSwapped === true) ? 'atk' : 'def';
    }
    const spawn = this.pickSpawn(p.team, p.role);
    p.phys = createPlayerState(spawn[0], spawn[1], spawn[2]);
    p.phys.yaw = Math.atan2(-(0 - spawn[0]), -(0 - spawn[2]));
    p.health = this.settings.health;
    p.armor = Math.max(p.armor, this.settings.armorStart);
    p.alive = true;
    p.plantProgress = 0;
    p.defuseProgress = 0;
    p.respawnAt = 0;
    p.spawnAt = this.now;
    p.spawnProtectedUntil = this.now + (this.mode.respawn ? 1.3 : 0);
    p.scoped = false;
    p.reloadUntil = 0;
    p.nextFireAt = 0;
    p.shotIndex = 0;
    p.lastDamageFrom = null;
    if (resetWeapons || !p.slots[1] || p.deaths > 0 || this.modeId === 'gungame') {
      if (this.modeId === 'gungame') this.giveGunGameWeapon(p);
      else if (this.modeId === 'bomb') this.giveRoundLoadout(p);
      else this.giveDmLoadout(p);
    }
    p.pending.push({ k: 'spawn', pos: p.phys.pos.slice() });
  }

  giveAmmo(p, id) {
    const w = WEAPONS[id];
    if (!w) return;
    const reserve = this.settings.infiniteAmmo ? 999 : w.reserve;
    p.ammo[id] = { mag: w.mag || 0, reserve };
  }

  equipWeapon(p, id, slot) {
    const w = WEAPONS[id];
    if (!w) return;
    p.slots[slot] = id;
    this.giveAmmo(p, id);
    p.active = id;
    p.activeSlot = slot;
    p.nextFireAt = this.now + 0.35;
    p.reloadUntil = 0;
  }

  giveDmLoadout(p) {
    const primary = WEAPONS[p.loadout.primary] ? p.loadout.primary : 'ak';
    const secondary = WEAPONS[p.loadout.secondary] ? p.loadout.secondary : 'p9';
    p.slots = { 1: primary, 2: secondary, 3: 'knife' };
    p.ammo = {};
    this.giveAmmo(p, primary);
    this.giveAmmo(p, secondary);
    this.giveAmmo(p, 'knife');
    p.active = primary;
    p.activeSlot = 1;
    p.grenades = this.settings.infiniteGrenades ? 4 : 1;
  }

  giveRoundLoadout(p) {
    const secondary = WEAPONS[p.loadout.secondary] ? p.loadout.secondary : 'p9';
    p.slots = { 1: null, 2: secondary, 3: 'knife' };
    p.ammo = {};
    this.giveAmmo(p, secondary);
    this.giveAmmo(p, 'knife');
    p.active = secondary;
    p.activeSlot = 2;
    p.grenades = 0;
    p.armor = this.settings.armorStart;
    p.helmet = false;
  }

  giveGunGameWeapon(p) {
    const id = GUN_LADDER[Math.min(p.gunLevel, GUN_LADDER.length - 1)];
    p.slots = { 1: id === 'knife' ? null : id, 2: 'p9', 3: 'knife' };
    p.ammo = {};
    if (id !== 'knife') this.giveAmmo(p, id);
    this.giveAmmo(p, 'p9');
    this.giveAmmo(p, 'knife');
    p.active = id === 'knife' ? 'knife' : id;
    p.activeSlot = id === 'knife' ? 3 : 1;
    p.grenades = 0;
  }

  botBuy(bot) {
    if (this.modeId !== 'bomb') { this.giveDmLoadout(bot); return; }
    const money = bot.money;
    const rifle = Math.random() < 0.5 ? 'ak' : 'm4';
    if (money >= WEAPONS[rifle].price + 650) {
      bot.money -= WEAPONS[rifle].price;
      this.equipWeapon(bot, rifle, 1);
      bot.money -= 650;
      bot.armor = 100;
    } else if (money >= WEAPONS[rifle].price) {
      bot.money -= WEAPONS[rifle].price;
      this.equipWeapon(bot, rifle, 1);
    } else if (money >= 1250) {
      bot.money -= 1250;
      this.equipWeapon(bot, 'mp9', 1);
    } else if (money >= 700 && Math.random() < 0.5) {
      bot.money -= 700;
      this.equipWeapon(bot, 'deagle', 2);
    }
  }

  // ------------------------------------------------------------------- input
  handleInput(p, msg) {
    if (!p || !p.alive || this.phase === 'ended') return;
    const nowWall = Date.now();
    if (!p.rateStart || nowWall - p.rateStart > 1000) { p.rateStart = nowWall; p.rateCount = 0; }
    if (++p.rateCount > 100) return;
    const seq = Number(msg.seq) | 0;
    if (seq && seq <= p.lastSeq) return;
    const dt = clamp(Number(msg.dt) || 1 / 60, 0.004, 0.05);
    p.inputQueue.push({
      buttons: Number(msg.b) | 0,
      yaw: Number(msg.yaw) || 0,
      pitch: clamp(Number(msg.pitch) || 0, -89, 89),
      dt, seq, slot: Number(msg.slot) | 0, scoped: !!msg.scope,
    });
    if (p.inputQueue.length > 14) p.inputQueue.splice(0, p.inputQueue.length - 14);
  }

  drainInputs(p, dt) {
    let budget = 3;
    while (p.inputQueue.length && budget-- > 0) {
      const inp = p.inputQueue.shift();
      this.applyInput(p, inp);
      p.lastSeq = inp.seq;
    }
  }

  applyInput(p, inp) {
    if (!p.alive) return;
    const frozen = this.phase === 'freeze' || this.phase === 'warmup';
    const buttons = frozen ? (inp.buttons & ~(BTN.FIRE | BTN.JUMP)) : inp.buttons;
    p.scoped = !!inp.scoped && !!WEAPONS[p.active]?.scope;
    if (inp.slot && inp.slot !== p.activeSlot && !frozen) this.setActive(p, inp.slot);
    const cfg = this.moveCfg(p);
    stepPlayer(p.phys, { buttons, yaw: inp.yaw, pitch: inp.pitch }, this.world, inp.dt, cfg);

    if (frozen) { p.fireHeld = false; p.useHeld = false; return; }

    const firing = (buttons & BTN.FIRE) !== 0;
    if (firing) {
      const w = WEAPONS[p.active];
      if (w && (w.automatic || !p.fireHeld)) this.tryFire(p);
    }
    p.fireHeld = firing;
    if (buttons & BTN.RELOAD) this.startReload(p);
    p.useHeld = (buttons & BTN.USE) !== 0;
    if (!p.useHeld) { p.plantProgress = 0; p.defuseProgress = 0; }
  }

  moveCfg(p) {
    const w = p ? WEAPONS[p.active] : null;
    return {
      speedScale: this.settings.speedScale,
      gravityScale: this.settings.gravityScale,
      jumpScale: this.settings.jumpScale,
      speedMult: w?.speedMult || 1,
    };
  }

  __stepBot(bot, inp, dt) {
    stepPlayer(bot.phys, inp, this.world, dt, this.moveCfg(bot));
  }

  teamForRole(role) {
    const p = this.allPlayers().find((pl) => pl.role === role && !pl.isBot) ||
      this.allPlayers().find((pl) => pl.role === role);
    if (p) return p.team;
    return role === 'atk' ? 0 : 1;
  }

  setActive(p, slot) {
    const id = p.slots[slot];
    if (!id || !WEAPONS[id] || !p.ammo[id]) return;
    if (p.active === id) return;
    p.active = id;
    p.activeSlot = slot;
    p.shotIndex = 0;
    p.reloadUntil = 0;
    p.nextFireAt = this.now + 0.35;
    p.scoped = false;
  }

  startReload(p) {
    const w = WEAPONS[p.active];
    const a = p.ammo[p.active];
    if (!w || !a || !w.mag || a.mag >= w.mag || a.reserve <= 0) return;
    if (p.reloadUntil > this.now) return;
    p.reloadUntil = this.now + w.reload;
    p.pending.push({ k: 'reload', w: p.active, dur: w.reload });
  }

  // ------------------------------------------------------------------- combat
  tryFire(p) {
    if (this.phase !== 'live' || !p.alive) return;
    const w = WEAPONS[p.active];
    const ammo = p.ammo[p.active];
    if (!w || !ammo || w.slot === 4) return;
    if (p.reloadUntil > this.now || p.nextFireAt > this.now) return;
    if (p.spawnProtectedUntil > this.now) p.spawnProtectedUntil = 0;
    if (w.slot === 3) { this.meleeAttack(p, w); return; }
    if (ammo.mag <= 0) { this.startReload(p); return; }

    ammo.mag--;
    p.nextFireAt = this.now + 60 / w.rpm;
    if (this.now - p.lastShotAt > 0.55) p.shotIndex = 0;
    p.lastShotAt = this.now;
    const bloom = 1 + Math.min(p.shotIndex, 14) * 0.05;
    p.shotIndex++;

    const origin = [
      p.phys.pos[0],
      p.phys.pos[1] + eyeHeight(p.phys.crouchAmount),
      p.phys.pos[2],
    ];
    const baseSpread = spreadFor(w, {
      onGround: p.phys.onGround, vel: p.phys.vel,
      crouchAmount: p.phys.crouchAmount, scoped: p.scoped,
    }) * bloom;

    let hitAny = false;
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * baseSpread * DEG;
      const yaw = p.phys.yaw + Math.cos(angle) * radius;
      const pitch = p.phys.pitch + Math.sin(angle) * radius / Math.max(0.25, Math.cos(p.phys.pitch * DEG));
      const dir = directionFromAngles(yaw, pitch);
      const result = this.traceShot(p, origin, dir, w);
      if (result.hitPlayer) hitAny = true;
      if (i === 0 || pellets <= 3) {
        this.pushEvent({
          k: 'shot', id: p.id, w: p.active,
          o: origin.map((v) => +v.toFixed(2)),
          e: result.end.map((v) => +v.toFixed(2)),
        });
      }
    }
    if (p.grenades > 0 && this.settings.infiniteGrenades) p.grenades = 4;
    if (w.recoil > 2 && !p.isBot) p.pending.push({ k: 'kick', amount: w.recoil });
    if (hitAny) p.pending.push({ k: 'confirm' });
  }

  meleeAttack(p, w) {
    p.nextFireAt = this.now + 60 / w.rpm;
    const origin = [p.phys.pos[0], p.phys.pos[1] + eyeHeight(p.phys.crouchAmount), p.phys.pos[2]];
    const dir = directionFromAngles(p.phys.yaw, p.phys.pitch);
    this.pushEvent({ k: 'swing', id: p.id });
    let best = null;
    for (const target of this.allPlayers()) {
      if (target.id === p.id || !target.alive) continue;
      const state = this.historicalState(target, this.now * 1000 - clamp(p.pingMs * 0.5 + INTERP_MS, 0, 200));
      const hit = rayPlayer(origin, dir, w.range, state);
      if (!hit) continue;
      if (!best || hit.t < best.hit.t) best = { target, hit, state };
    }
    if (!best) return;
    if (!this.canDamage(p, best.target)) return;
    const toAttacker = [p.phys.pos[0] - best.state.pos[0], p.phys.pos[2] - best.state.pos[2]];
    const len = Math.hypot(toAttacker[0], toAttacker[1]) || 1;
    const facing = [-Math.sin(best.target.phys.yaw), -Math.cos(best.target.phys.yaw)];
    const behind = (facing[0] * toAttacker[0] + facing[1] * toAttacker[1]) / len;
    const dmg = w.damage * (behind > 0.35 ? 2.6 : 1);
    this.applyDamage(best.target, p, dmg, false, w, dir, best.hit.t);
    if (behind > 0.35) p.pending.push({ k: 'backstab' });
  }

  traceShot(shooter, origin, dir, weapon) {
    const maxDist = weapon.range || 100;
    const worldHit = rayWorld(this.world, origin, dir, maxDist);
    let end = worldHit
      ? [origin[0] + dir[0] * worldHit.t, origin[1] + dir[1] * worldHit.t, origin[2] + dir[2] * worldHit.t]
      : [origin[0] + dir[0] * maxDist, origin[1] + dir[1] * maxDist, origin[2] + dir[2] * maxDist];
    let best = null;
    const rewindMs = clamp(shooter.pingMs * 0.5 + INTERP_MS, 0, 240);
    for (const target of this.allPlayers()) {
      if (target.id === shooter.id || !target.alive) continue;
      if (!this.canDamage(shooter, target)) continue;
      const state = this.historicalState(target, this.now * 1000 - rewindMs);
      const dist = Math.hypot(state.pos[0] - origin[0], state.pos[1] - origin[1], state.pos[2] - origin[2]);
      if (dist > maxDist + 2) continue;
      const hit = rayPlayer(origin, dir, maxDist, state);
      if (!hit) continue;
      if (worldHit && worldHit.t < hit.t) continue;
      if (!best || hit.t < best.hit.t) best = { target, hit };
    }
    if (best) {
      const dist = best.hit.t;
      const falloff = Math.pow(weapon.falloff ?? 1, dist / 9);
      let dmg = weapon.damage * falloff;
      end = [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist];
      this.applyDamage(best.target, shooter, dmg, best.hit.headshot, weapon, dir, dist);
      return { hitPlayer: true, end };
    }
    return { hitPlayer: false, end };
  }

  historicalState(target, ms) {
    const h = target.history;
    if (!h || h.length < 2) return { pos: target.phys.pos.slice(), crouchAmount: target.phys.crouchAmount, vel: target.phys.vel };
    if (ms >= h[h.length - 1].t) {
      const last = h[h.length - 1];
      return { pos: last.pos.slice(), crouchAmount: last.crouch, vel: last.vel };
    }
    for (let i = h.length - 2; i >= 0; i--) {
      if (h[i].t <= ms) {
        const a = h[i], b = h[i + 1];
        const t = clamp((ms - a.t) / Math.max(1, b.t - a.t), 0, 1);
        return {
          pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * t, a.pos[1] + (b.pos[1] - a.pos[1]) * t, a.pos[2] + (b.pos[2] - a.pos[2]) * t],
          crouchAmount: a.crouch + (b.crouch - a.crouch) * t,
          vel: a.vel,
        };
      }
    }
    return { pos: h[0].pos.slice(), crouchAmount: h[0].crouch, vel: h[0].vel };
  }

  canDamage(attacker, victim) {
    if (victim.spawnProtectedUntil > this.now) return false;
    if (this.settings.headshotsOnly) return true;
    if (attacker.team === -1 || victim.team === -1) return attacker.id !== victim.id;
    return this.settings.friendlyFire || attacker.team !== victim.team;
  }

  applyDamage(victim, attacker, amount, headshot, weapon, dir, dist) {
    if (!victim.alive || this.phase !== 'live') return;
    if (victim.spawnProtectedUntil > this.now) return;
    let dmg = amount * this.settings.damageScale;
    if (weapon.pellets) dmg *= 1;
    if (this.settings.headshotsOnly && !headshot) dmg = 0;
    if (headshot) {
      dmg *= weapon.headMult || 1;
      if (victim.helmet) dmg *= 0.68;
    }
    if (victim.armor > 0 && !headshot) {
      const absorbed = Math.min(victim.armor, dmg * 0.5);
      victim.armor -= absorbed;
      dmg -= absorbed;
    } else if (victim.armor > 0 && headshot && victim.helmet) {
      const absorbed = Math.min(victim.armor, dmg * 0.3);
      victim.armor -= absorbed;
      dmg -= absorbed;
    }
    dmg = Math.max(0, Math.round(dmg));
    if (dmg <= 0) return;
    victim.health -= dmg;
    victim.lastDamageFrom = attacker.id;
    victim.lastDamageAt = this.now;
    const dmgDir = [-dir[0], -dir[1], -dir[2]];
    victim.pending.push({ k: 'dmg', from: attacker.id, amt: dmg, dir: dmgDir, hp: Math.max(0, victim.health) });
    attacker.pending.push({ k: 'hit', hs: !!headshot, amt: dmg, target: victim.id });
    if (attacker.isBot) this.botAlert(attacker, victim);
    if (victim.health <= 0) this.onDeath(victim, attacker, weapon, headshot);
  }

  botAlert(bot, victim) {
    if (!bot || !bot.brain) return;
    if (!bot.brain.targetId) bot.brain.targetId = victim.id;
  }

  onDeath(victim, killer, weapon, headshot) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.deathPos = victim.phys.pos.slice();
    victim.respawnAt = this.now + (this.settings.respawnDelay || this.mode.respawnDelay || 3);
    victim.plantProgress = 0;
    victim.defuseProgress = 0;
    victim.deadAt = this.now;
    const teamKill = this.mode.teamBased && killer.team === victim.team;
    if (killer && killer.id !== victim.id) {
      killer.kills++;
      if (!teamKill) killer.score++;
      if (headshot) killer.headshots++;
      const reward = teamKill ? ECONOMY.teamKillPenalty : (weapon.killReward ?? 300);
      killer.money = clamp(killer.money + reward, 0, ECONOMY.max);
      if (this.mode.teamBased) {
        if (!teamKill) this.scores[killer.team]++;
        else this.scores[killer.team] = Math.max(0, this.scores[killer.team] - 1);
      }
      if (this.modeId === 'gungame' && !teamKill) this.gunGameKill(killer);
    }
    this.pushEvent({
      k: 'kill', killer: killer?.id || 0, victim: victim.id,
      w: weapon?.id || 'world', hs: !!headshot, tk: teamKill,
      kname: killer?.name, vname: victim.name,
    });
    if (this.modeId === 'bomb') this.checkBombRoundEnd();
    if (this.mode.teamBased && this.scores.some((s) => s >= this.effectiveScoreLimit())) {
      this.endMatch(this.scores[0] > this.scores[1] ? 0 : 1);
      return;
    }
    if (!this.mode.teamBased && killer && !killer.isBot && killer.score >= this.effectiveScoreLimit()) {
      this.endMatch(killer.id);
    }
    if (!this.mode.teamBased && killer?.isBot && killer.score >= this.effectiveScoreLimit()) {
      this.endMatch(killer.id);
    }
  }

  gunGameKill(killer) {
    const last = GUN_LADDER.length - 1;
    if (killer.gunLevel >= last) {
      this.endMatch(killer.id);
      return;
    }
    killer.gunLevel++;
    this.pushEvent({ k: 'level', id: killer.id, level: killer.gunLevel, w: GUN_LADDER[killer.gunLevel] });
    this.giveGunGameWeapon(killer);
    killer.pending.push({ k: 'levelup', level: killer.gunLevel, w: GUN_LADDER[killer.gunLevel] });
  }

  // --------------------------------------------------------------- grenades
  throwGrenade(p, yaw, pitch) {
    if (!p.alive || this.phase !== 'live') return;
    if (p.grenades <= 0) return;
    if (this.now - p.lastNadeAt < 0.7) return;
    p.lastNadeAt = this.now;
    if (!this.settings.infiniteGrenades) p.grenades--;
    const dir = directionFromAngles(clamp(yaw, -Math.PI, Math.PI), clamp(pitch, -89, 89));
    const origin = [p.phys.pos[0], p.phys.pos[1] + eyeHeight(p.phys.crouchAmount) - 0.1, p.phys.pos[2]];
    const proj = {
      id: this.nextId++, owner: p.id, team: p.team,
      pos: origin, vel: [dir[0] * 17 + p.phys.vel[0], dir[1] * 17 + 2.6, dir[2] * 17 + p.phys.vel[2]],
      fuseAt: this.now + WEAPONS.he.fuse,
    };
    this.projectiles.push(proj);
    this.pushEvent({ k: 'nade', id: p.id, pos: origin.map((v) => +v.toFixed(2)) });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      stepProjectile(pr, this.world, dt);
      if (this.now >= pr.fuseAt) {
        this.explode(pr);
        this.projectiles.splice(i, 1);
      }
    }
  }

  explode(pr) {
    const owner = this.players.get(pr.owner) || this.bots.get(pr.owner);
    this.pushEvent({ k: 'boom', pos: pr.pos.map((v) => +v.toFixed(2)) });
    if (this.phase !== 'live') return;
    for (const target of this.allPlayers()) {
      if (!target.alive) continue;
      const dx = target.phys.pos[0] - pr.pos[0];
      const dy = (target.phys.pos[1] + 1) - pr.pos[1];
      const dz = target.phys.pos[2] - pr.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > WEAPONS.he.radius) continue;
      const losOrigin = [pr.pos[0], pr.pos[1] + 0.15, pr.pos[2]];
      if (!hasLineOfSight(this.world, losOrigin, target.phys.pos, 1.0)) continue;
      if (owner && target.id !== owner.id && !this.canDamage(owner, target)) continue;
      const falloff = 1 - d / WEAPONS.he.radius;
      const dmg = WEAPONS.he.damage * falloff * falloff * this.settings.damageScale;
      const dir = [dx / (d || 1), dy / (d || 1), dz / (d || 1)];
      this.applyDamage(target, owner || { id: 0, team: -1, pending: [], isBot: false, money: 0, kills: 0 }, WEAPONS.he, dir, d);
    }
  }

  // ------------------------------------------------------------------- modes
  effectiveScoreLimit() {
    return this.settings.scoreLimit || this.mode.scoreLimit || 30;
  }

  effectiveTimeLimit() {
    return this.settings.timeLimit || this.mode.timeLimit || 600;
  }

  startMatch() {
    this.scores = [0, 0];
    for (const p of this.allPlayers()) { p.kills = 0; p.deaths = 0; p.score = 0; p.gunLevel = 0; }
    this.round = 0;
    this.winner = null;
    this.awarded = false;
    this.timeLimitLeft = this.effectiveTimeLimit();
    this.halftimeSwapped = false;
    if (this.mode.roundBased) {
      this.startRound();
    } else {
      this.phase = 'live';
      this.phaseTime = 0;
      this.round = 1;
      this.roundResult = null;
      for (const p of this.allPlayers()) this.spawnPlayer(p, { resetWeapons: true });
      this.pushEvent({ k: 'matchStart', mode: this.modeId });
    }
  }

  startRound() {
    this.round++;
    const first = this.round === 1;
    if (this.round === (this.mode.halftimeAt || 4) + 1 && !this.halftimeSwapped) {
      this.halftimeSwapped = true;
      this.pushEvent({ k: 'halftime' });
    }
    this.phase = 'freeze';
    this.phaseTime = this.mode.freezeTime || 6;
    this.roundResult = null;
    this.bomb = null;
    this.projectiles = [];
    this.roundTimer = this.mode.roundTime || 115;
    for (const p of this.allPlayers()) {
      p.alive = true;
      p.armor = 0;
      p.helmet = false;
      p.grenades = 0;
      p.money = first ? ECONOMY.start : clamp(p.money, 0, ECONOMY.max);
      if (p.isBot) this.botBuy(p);
      this.spawnPlayer(p, { resetWeapons: true });
    }
    this.pushEvent({ k: 'roundStart', round: this.round, scores: this.scores.slice(), swapped: this.halftimeSwapped });
  }

  endRound(winnerTeam, reason) {
    if (this.phase !== 'live' && this.phase !== 'freeze') return;
    this.phase = 'roundEnd';
    this.phaseTime = 5.2;
    this.scores[winnerTeam]++;
    this.roundResult = { winner: winnerTeam, reason };
    const loser = 1 - winnerTeam;
    this.loseStreak = this.loseStreak || [0, 0];
    this.loseStreak[winnerTeam] = 0;
    this.loseStreak[loser] = Math.min((this.loseStreak[loser] || 0) + 1, ECONOMY.maxLoseStreak);
    for (const p of this.allPlayers()) {
      if (p.team === winnerTeam) p.money = clamp(p.money + ECONOMY.winRound, 0, ECONOMY.max);
      else p.money = clamp(p.money + ECONOMY.loseRound + this.loseStreak[loser] * ECONOMY.loseStreakStep, 0, ECONOMY.max);
    }
    this.pushEvent({ k: 'roundEnd', winner: winnerTeam, reason, scores: this.scores.slice(), round: this.round });
    if (winnerTeam !== undefined && this.scores[winnerTeam] >= this.effectiveScoreLimit()) {
      this.endMatch(winnerTeam);
    }
  }

  endMatch(winnerId) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.phaseTime = 999;
    this.winner = winnerId;
    this.pushEvent({ k: 'matchEnd', winner: winnerId, scores: this.scores.slice() });
    this.manager.awardMatch(this);
  }

  restart() {
    this.phase = 'warmup';
    this.phaseTime = this.mode.warmup || 5;
    this.round = 0;
    this.bomb = null;
    this.projectiles = [];
    this.roundResult = null;
    this.winner = null;
    this.awarded = false;
    this.hillIndex = 0;
    this.hillOwner = -1;
    this.scores = [0, 0];
    this.timeLimitLeft = this.effectiveTimeLimit();
    for (const p of this.allPlayers()) {
      p.kills = 0; p.deaths = 0; p.score = 0; p.money = this.modeId === 'bomb' ? ECONOMY.start : 4000;
      this.spawnPlayer(p, { resetWeapons: true });
    }
    this.pushEvent({ k: 'restart' });
  }

  // -------------------------------------------------------------------- buy
  canBuy(p) {
    if (!p.alive) return false;
    if (this.modeId === 'bomb') return this.phase === 'freeze' || this.phase === 'roundEnd';
    return this.now - p.spawnAt < 12 || this.settings.infiniteAmmo;
  }

  buyItem(p, itemId) {
    const item = BUY_ITEMS.find((i) => i.id === itemId);
    if (!item) return { ok: false, error: 'Unknown item' };
    if (!this.canBuy(p)) return { ok: false, error: 'Buy zone closed' };
    if (p.money < item.price) return { ok: false, error: 'Not enough funds' };
    if (item.kind === 'weapon') {
      const w = WEAPONS[item.id];
      const slot = w.slot;
      const current = p.slots[slot];
      if (current === item.id) return { ok: false, error: 'Already equipped' };
      p.money -= item.price;
      this.equipWeapon(p, item.id, slot);
      this.pushEvent({ k: 'buy', id: p.id, item: item.id });
      return { ok: true };
    }
    if (item.kind === 'armor') {
      if (item.id === 'kevlar') {
        if (p.armor >= 100) return { ok: false, error: 'Already armored' };
        p.money -= item.price;
        p.armor = 100;
      } else {
        p.money -= item.price;
        p.armor = 100;
        p.helmet = true;
      }
      this.pushEvent({ k: 'buy', id: p.id, item: item.id });
      return { ok: true };
    }
    if (item.kind === 'util') {
      if (p.grenades >= 2) return { ok: false, error: 'Grenade limit' };
      p.money -= item.price;
      p.grenades++;
      this.pushEvent({ k: 'buy', id: p.id, item: item.id });
      return { ok: true };
    }
    return { ok: false, error: 'Invalid purchase' };
  }

  // ------------------------------------------------------------------- tick
  tick(dt) {
    this.now += dt;
    this.tickCount++;
    this.updatePhase(dt);

    for (const p of this.allPlayers()) {
      if ((p.disconnectedAt && this.now * 1000 - p.disconnectedAt > 12000) || p.ws === undefined) { /* noop */ }
      if (!p.alive) {
        if (this.mode.respawn && this.phase === 'live' && this.now >= p.respawnAt) {
          this.spawnPlayer(p, { resetWeapons: true });
        }
        continue;
      }
      if (p.isBot) {
        updateBot(this, p, dt);
      } else {
        this.drainInputs(p, dt);
        if (p.reloadUntil && this.now >= p.reloadUntil) {
          const w = WEAPONS[p.active], a = p.ammo[p.active];
          if (w && a && w.mag) {
            const take = Math.min(w.mag - a.mag, a.reserve);
            a.mag += take;
            if (!this.settings.infiniteAmmo) a.reserve -= take;
          }
          p.reloadUntil = 0;
        }
      }
      if (p.ammo[p.active] && p.ammo[p.active].mag <= 0 && p.ammo[p.active].reserve > 0 && p.reloadUntil <= 0) {
        this.startReload(p);
      }
      if (this.settings.infiniteAmmo) {
        for (const id of Object.keys(p.ammo)) {
          p.ammo[id].reserve = 999;
          const def = WEAPONS[id];
          if (def?.mag) p.ammo[id].mag = def.mag;
        }
      }
      this.updateObjectives(p, dt);
      if (this.tickCount % 2 === 0) {
        p.history.push({
          t: this.now * 1000,
          pos: p.phys.pos.slice(),
          crouch: p.phys.crouchAmount,
          vel: p.phys.vel.slice(),
        });
        if (p.history.length > 80) p.history.shift();
      }
    }
    this.updateProjectiles(dt);
    if (this.modeId === 'koth') this.updateKoth(dt);
    if (this.modeId === 'bomb') this.updateBomb(dt);
    if (!this.mode.roundBased) {
      this.timeLimitLeft -= dt;
      if (this.timeLimitLeft <= 0) {
        const winner = this.mode.teamBased
          ? (this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1)
          : (this.allPlayers().sort((a, b) => b.score - a.score)[0]?.id ?? -1);
        this.endMatch(winner);
      }
    }
    if (this.tickCount % Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ)) === 0) {
      this.broadcastSnapshot();
    }
  }

  updatePhase(dt) {
    this.phaseTime -= dt;
    if (this.phase === 'warmup') {
      if (this.phaseTime <= 0) this.startMatch();
      return;
    }
    if (this.phase === 'freeze') {
      if (this.phaseTime <= 0) {
        this.phase = 'live';
        this.phaseTime = this.roundTimer || this.mode.roundTime || 115;
        for (const p of this.allPlayers()) p.spawnProtectedUntil = this.now + 0.6;
        this.pushEvent({ k: 'live' });
      }
      return;
    }
    if (this.phase === 'live') {
      if (this.mode.roundBased) {
        this.phaseTime -= 0;
        this.roundTimer -= dt;
        if (this.bomb?.planted) {
          this.bomb.timeLeft -= dt;
          if (this.bomb.timeLeft <= 0) {
            this.bomb.exploded = true;
            this.pushEvent({ k: 'explode', pos: [this.bomb.x, this.bomb.y, this.bomb.z] });
            this.endRound(this.teamForRole('atk'), 'BOMB DETONATED');
          }
        } else if (this.roundTimer <= 0) {
          this.endRound(this.teamForRole('def'), 'TIME EXPIRED');
        }
      }
      return;
    }
    if (this.phase === 'roundEnd' && this.phaseTime <= 0) {
      if (this.scores.some((s) => s >= this.effectiveScoreLimit())) this.endMatch(this.scores[0] > this.scores[1] ? 0 : 1);
      else this.startRound();
    }
  }

  updateObjectives(p, dt) {      if (this.phase !== 'live' || this.modeId !== 'bomb' || !p.useHeld) return;
      if (p.plantProgress < 0) p.plantProgress = 0;
    if (p.role === 'atk' && !this.bomb?.planted) {
      const site = (this.map.sites || []).find((s) => Math.hypot(p.phys.pos[0] - s.x, p.phys.pos[2] - s.z) <= s.r);
      if (site) {
        p.plantProgress += dt;
        if (p.plantProgress >= (this.mode.plantTime || 3.2)) {
          p.plantProgress = 0;
          this.bomb = {
            x: p.phys.pos[0], y: p.phys.pos[1] + 0.15, z: p.phys.pos[2],
            site: site.label, planted: true, timeLeft: this.mode.bombTime || 40,
            time: this.mode.bombTime || 40, defuseProgress: 0, defuserId: 0,
          };
          this.pushEvent({ k: 'plant', id: p.id, site: site.label, pos: [this.bomb.x, this.bomb.y, this.bomb.z] });
          p.money = clamp(p.money + ECONOMY.plantReward, 0, ECONOMY.max);
          if (this.teamCount(this.teamForRole('def')) === 0) this.endRound(this.teamForRole('atk'), 'SITE SECURED');
        }
      } else if (!site) p.plantProgress = 0;
    }
    if (p.role === 'def' && this.bomb?.planted) {
      const d = Math.hypot(p.phys.pos[0] - this.bomb.x, p.phys.pos[2] - this.bomb.z);
      if (d <= 2.2) {
        this.bomb.defuseProgress += dt;
        this.bomb.defuserId = p.id;
        if (this.bomb.defuseProgress >= (this.mode.defuseTime || 7)) {
          this.pushEvent({ k: 'defuse', id: p.id, pos: [this.bomb.x, this.bomb.y, this.bomb.z] });
          p.money = clamp(p.money + ECONOMY.defuseReward, 0, ECONOMY.max);
          this.endRound(this.teamForRole('def'), 'BOMB DEFUSED');
        }
      } else {
        p.defuseProgress = 0;
      }
    }
  }

  updateBomb(dt) {
    if (this.phase !== 'live') return;
    if (!this.bomb?.planted) {
      const attackers = this.allPlayers().filter((p) => p.alive && p.role === 'atk');
      const defenders = this.allPlayers().filter((p) => p.alive && p.role === 'def');
      if (attackers.length === 0) this.endRound(this.teamForRole('def'), 'ATTACKERS ELIMINATED');
      else if (defenders.length === 0) this.endRound(this.teamForRole('atk'), 'DEFENDERS ELIMINATED');
      return;
    }
    const defenders = this.allPlayers().filter((p) => p.alive && p.role === 'def');
    if (defenders.length === 0) this.endRound(this.teamForRole('atk'), 'DEFENDERS ELIMINATED');
    else if (this.bomb.defuserId && !this.allPlayers().find((p) => p.id === this.bomb.defuserId)?.useHeld) {
      this.bomb.defuserId = 0;
    }
  }

  checkBombRoundEnd() {
    if (this.phase === 'live' && this.modeId === 'bomb') this.updateBomb(0);
  }

  updateKoth(dt) {
    if (this.phase !== 'live') return;
    this.hillRotateIn -= dt;
    if (this.hillRotateIn <= 0) {
      this.hillRotateIn = this.mode.hillRotateTime || 45;
      const hills = this.map.hills || [];
      if (hills.length) {
        this.hillIndex = (this.hillIndex + 1) % hills.length;
        this.hill = hills[this.hillIndex];
        this.hillOwner = -1;
        this.pushEvent({ k: 'hill', label: this.hill.label, x: this.hill.x, z: this.hill.z, r: this.hill.r });
      }
    }
    const inside = this.allPlayers().filter((p) => p.alive &&
      Math.hypot(p.phys.pos[0] - this.hill.x, p.phys.pos[2] - this.hill.z) <= this.hill.r);
    if (!inside.length) { this.hillOwner = -1; return; }
    if (this.mode.teamBased) {
      const teams = new Set(inside.map((p) => p.team));
      if (teams.size !== 1) { this.hillOwner = -1; return; }
      const team = [...teams][0];
      this.hillOwner = team;
      this.scores[team] = Math.min(this.effectiveScoreLimit(), this.scores[team] + (this.mode.hillScorePerSec || 5) * dt);
      if (this.scores[team] >= this.effectiveScoreLimit()) this.endMatch(team);
    } else {
      const byPlayer = new Map();
      for (const p of inside) byPlayer.set(p.id, (byPlayer.get(p.id) || 0) + 1);
      if (byPlayer.size === 1) {
        const [id] = byPlayer.keys();
        const p = this.players.get(id) || this.bots.get(id);
        if (p) {
          p.score += (this.mode.hillScorePerSec || 5) * dt;
          this.hillOwner = p.id;
          if (p.score >= this.effectiveScoreLimit()) this.endMatch(id);
        }
      } else this.hillOwner = -1;
    }
  }

  // -------------------------------------------------------------- networking
  pushEvent(ev) {
    this.events.push(ev);
    if (this.events.length > 80) this.events.shift();
  }

  publicInfo() {
    return {
      id: this.id, code: this.code, name: this.name, mode: this.modeId,
      map: this.map.name, mapId: this.map.id, players: this.players.size + this.bots.size,
      humans: this.players.size, maxPlayers: this.maxPlayers, isPublic: this.isPublic,
      hasPassword: !!this.password, phase: this.phase, bots: this.bots.size,
      scores: this.scores.slice(), uptime: Math.floor((Date.now() - this.createdAt) / 1000),
    };
  }

  roster() {
    return this.allPlayers().map((p) => ({
      id: p.id, name: p.name, team: p.team, bot: p.isBot, color: p.color,
      kills: p.kills, deaths: p.deaths, score: p.score, ping: Math.round(p.pingMs),
      equipped: p.equipped || null,
    }));
  }

  roomInfo() {
    return {
      id: this.id, code: this.code, name: this.name, mode: this.modeId,
      map: this.mapSummary(), settings: this.settings, isPublic: this.isPublic,
      maxPlayers: this.maxPlayers, hostToken: this.hostToken, phase: this.phase,
      bots: this.botsWanted,
    };
  }

  mapSummary() {
    return {
      id: this.map.id, name: this.map.name, tagline: this.map.tagline,
      halfX: this.map.halfX, halfZ: this.map.halfZ, theme: this.map.theme,
      custom: !!this.map.custom, blocks: this.map.blocks, spawns: this.map.spawns,
      sites: this.map.sites, hills: this.map.hills,
    };
  }

  buildBase() {
    const players = [];
    for (const p of this.allPlayers()) {
      const a = p.ammo[p.active] || { mag: 0, reserve: 0 };
      let flags = 0;
      if (!p.alive) flags |= 8;
      else {
        if (p.phys.onGround) flags |= 1;
        if (p.phys.crouchAmount > 0.4) flags |= 2;
        if (p.reloadUntil > this.now) flags |= 4;
        if (p.useHeld) flags |= 16;
        if (p.spawnProtectedUntil > this.now) flags |= 32;
      }
      players.push([
        p.id, +p.phys.pos[0].toFixed(2), +p.phys.pos[1].toFixed(2), +p.phys.pos[2].toFixed(2),
        +p.phys.yaw.toFixed(3), +p.phys.pitch.toFixed(1), flags,
        Math.round(p.alive ? p.health : 0), Math.round(p.armor), p.team, p.active,
        a.mag, a.reserve, +p.phys.crouchAmount.toFixed(2), p.alive ? 1 : 0,
        p.scoped ? 1 : 0, p.gunLevel, p.kills, p.deaths,
        p.grenades, p.score,
      ]);
    }
    const bomb = this.bomb ? {
      x: +this.bomb.x.toFixed(2), y: +this.bomb.y.toFixed(2), z: +this.bomb.z.toFixed(2),
      t: +Math.max(0, this.bomb.timeLeft).toFixed(1), d: +this.bomb.defuseProgress.toFixed(2),
      site: this.bomb.site,
    } : null;
    const hill = this.modeId === 'koth' && this.hill ? {
      x: this.hill.x, z: this.hill.z, r: this.hill.r, label: this.hill.label,
      owner: this.hillOwner, rotate: +this.hillRotateIn.toFixed(1),
    } : null;
    return {
      t: 's', st: Math.round(this.now * 1000), tick: this.tickCount,
      phase: this.phase, left: +Math.max(0, this.phaseTime).toFixed(1),
      roundLeft: this.mode.roundBased ? +Math.max(0, this.roundTimer || 0).toFixed(1) : 0,
      maxLeft: this.mode.roundBased ? 0 : +Math.max(0, this.timeLimitLeft).toFixed(1),
      scores: this.mode.teamBased ? this.scores.map((s) => Math.round(s)) : [],
      round: this.round, result: this.roundResult, winner: this.winner,
      bomb, hill, players,
      nades: this.projectiles.map((pr) => [+pr.pos[0].toFixed(2), +pr.pos[1].toFixed(2), +pr.pos[2].toFixed(2)]),
      limit: this.effectiveScoreLimit(),
      halftime: !!this.halftimeSwapped,
      mode: this.modeId, map: this.map.id,
    };
  }

  broadcastSnapshot() {
    if (!this.players.size) { this.events.length = 0; return; }
    const base = this.buildBase();
    const events = this.events.slice();
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) { p.pending.length = 0; continue; }
      const payload = {
        ...base,
        you: {
          id: p.id, hp: Math.round(p.health), armor: Math.round(p.armor), helmet: p.helmet,
          money: Math.round(p.money), alive: p.alive,
          respawnIn: Math.max(0, +(p.respawnAt - this.now).toFixed(1)),
          active: p.active, mag: p.ammo[p.active]?.mag ?? 0, reserve: p.ammo[p.active]?.reserve ?? 0,
          reloadIn: Math.max(0, +(p.reloadUntil - this.now).toFixed(2)),
          reloadTotal: WEAPONS[p.active]?.reload || 0,
          canBuy: this.canBuy(p), grenades: p.grenades, score: p.score,
          kills: p.kills, deaths: p.deaths, headshots: p.headshots, gunLevel: p.gunLevel,
          role: p.role, team: p.team, seq: p.lastSeq,
          plantProgress: +(p.plantProgress / (this.mode.plantTime || 3.2)).toFixed(3),
          defuseProgress: +(p.defuseProgress / (this.mode.defuseTime || 7)).toFixed(3),
          ping: Math.round(p.pingMs), protected: p.spawnProtectedUntil > this.now,
          vel: p.phys.vel.map((v) => +v.toFixed(2)), onGround: p.phys.onGround,
          slots: p.slots, ammo: p.ammo,
        },
        ev: events,
        pe: p.pending.slice(),
        roster: null,
      };
      p.pending.length = 0;
      try { p.ws.send(JSON.stringify(payload)); } catch { /* socket closing */ }
    }
    this.events.length = 0;
  }

  broadcast(obj, exceptId = 0) {
    for (const p of this.players.values()) {
      if (p.id === exceptId || !p.ws || p.ws.readyState !== 1) continue;
      try { p.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }

  sendRoster() {
    this.broadcast({ t: 'roster', players: this.roster(), hostToken: this.hostToken });
  }
}
