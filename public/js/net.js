// Networking + client prediction. The movement code is the exact same module the
// server runs, so replaying unacknowledged inputs reproduces its result.
import { BTN, WEAPONS, PHYS, INTERP_MS, TICK_HZ, clamp, spreadFor, eyeHeight } from '/shared/constants.js';
import { createPlayerState, stepPlayer, makeWorld, rayWorld, rayPlayer, directionFromAngles } from '/shared/physics.js';
import { sanitizeLoadout } from '/shared/shop.js';

export class Net {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.handlers = new Map();
    this.profile = null;
    this.room = null;
    this.mapData = null;
    this.world = null;
    this.youId = 0;
    this.roster = [];
    this.rosterById = new Map();
    this.snapshots = [];
    this.latest = null;
    this.me = null;
    this.local = null;
    this.pending = [];
    this.inputSeq = 0;
    this.acc = 0;
    this.rtt = 80;
    this.jitter = 0;
    this.lastRtt = 80;
    this.clockOffset = 0;
    this.clockReady = false;
    this.correction = [0, 0, 0];
    this.stats = { snapshots: 0, bytes: 0, serverTick: 0, fps: 0 };
    this.settings = null;
    this.lastSnapshotWall = 0;
    this.lastPingAt = 0;
    this.pendingPings = new Map();
    this.connectedAt = 0;
    this.hostToken = null;
    this.inputSentThisSecond = 0;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) {
      try { fn(payload); } catch (err) { console.error(`[net handler ${type}]`, err); }
    }
  }

  setSettings(settings) {
    this.settings = settings;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/ws`;
      let settled = false;
      let ws;
      try { ws = new WebSocket(url); } catch (err) { reject(err); return; }
      this.ws = ws;
      const failTimer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Connection timed out')); ws.close(); }
      }, 9000);

      ws.onopen = () => {
        this.connected = true;
        this.connectedAt = Date.now();
        const token = localStorage.getItem('slopstrike.token') || (crypto.randomUUID?.() || `t-${Math.random().toString(36).slice(2)}-${Date.now()}`);
        localStorage.setItem('slopstrike.token', token);
        this.send({ t: 'hello', token, name: this.settings?.name || 'Recruit' });
      };
      ws.onmessage = (ev) => {
        this.stats.bytes += ev.data.length;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.handle(msg);
        if (!settled && msg.t === 'profile') { settled = true; clearTimeout(failTimer); resolve(msg.profile); }
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(failTimer); reject(new Error('Could not reach game server')); }
      };
      ws.onclose = () => {
        this.connected = false;
        this.emit('closed');
        if (!settled) { settled = true; clearTimeout(failTimer); reject(new Error('Connection closed')); }
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    }
    return false;
  }

  handle(msg) {
    switch (msg.t) {
      case 'profile':
        this.profile = msg.profile;
        this.emit('profile', msg);
        break;
      case 'joined':
        this.enterRoom(msg);
        this.emit('joined', msg);
        break;
      case 's':
        this.onSnapshot(msg);
        this.emit('snapshot', msg);
        break;
      case 'roster':
        this.roster = msg.players;
        this.rosterById = new Map(msg.players.map((p) => [p.id, p]));
        this.hostToken = msg.hostToken;
        this.emit('roster', msg);
        break;
      case 'chat':
        this.emit('chat', msg);
        break;
      case 'sys':
        this.emit('sys', msg);
        break;
      case 'error':
        this.emit('error', msg);
        break;
      case 'kicked':
        this.leaveLocal();
        this.emit('kicked', msg);
        break;
      case 'left':
        this.leaveLocal();
        this.emit('left', msg);
        break;
      case 'rewards':
        if (msg.profile) { this.profile = msg.profile; this.emit('profile', { profile: msg.profile }); }
        this.emit('rewards', msg);
        break;
      case 'pong': {
        const sent = this.pendingPings.get(msg.c);
        if (sent !== undefined) {
          const rtt = performance.now() - sent;
          this.pendingPings.delete(msg.c);
          this.jitter += (Math.abs(rtt - this.lastRtt) - this.jitter) * 0.25;
          this.lastRtt = rtt;
          this.rtt = this.rtt + (rtt - this.rtt) * 0.35;
        }
        break;
      }
      case 'rooms':
        this.emit('rooms', msg.rooms);
        break;
      case 'mapSaved':
        this.emit('mapSaved', msg);
        break;
      case 'buyOk':
        this.emit('buyOk', msg);
        break;
      default:
        this.emit(msg.t, msg);
    }
  }

  enterRoom(msg) {
    this.room = msg.room;
    this.mapData = msg.map;
    this.youId = msg.youId;
    this.hostToken = msg.hostToken;
    this.roster = msg.roster;
    this.rosterById = new Map(msg.roster.map((p) => [p.id, p]));
    this.world = makeWorld(msg.map.blocks);
    this.pending = [];
    this.snapshots = [];
    this.latest = null;
    this.me = null;
    this.inputSeq = 0;
    this.clockReady = false;
    this.correction = [0, 0, 0];
    this.stats.snapshots = 0;
    const mine = this.roster.find((p) => p.id === this.youId);
    const spawns = msg.map.spawns || [];
    const teamSpawns = spawns.filter((s) => s.team === (mine?.team ?? 0));
    const spawn = (teamSpawns.length ? teamSpawns : spawns)[0] || { x: 0, y: 0, z: 0 };
    this.local = createPlayerState(spawn.x, (spawn.y || 0) + 0.05, spawn.z);
    this.local.yaw = 0;
    this.room.phase = msg.room.phase;
    this.lastSnapshotWall = performance.now();
    this.inputAcc = 0;
  }

  leaveLocal() {
    this.room = null;
    this.mapData = null;
    this.local = null;
    this.latest = null;
    this.me = null;
    this.snapshots = [];
    this.pending = [];
    this.world = null;
  }

  // ------------------------------------------------------------------ actions
  quickplay(mode) { this.send({ t: 'quickplay', mode }); }
  create(opts) { this.send({ t: 'create', ...opts }); }
  join(roomId, password) { this.send({ t: 'join', roomId, password }); }
  joinCode(code, password) { this.send({ t: 'join', code, password }); }
  leave() {
    this.send({ t: 'leave' });
    this.leaveLocal();
  }
  refreshRooms() { this.send({ t: 'rooms' }); }
  buy(item) { this.send({ t: 'buy', item }); }
  chat(text) { this.send({ t: 'chat', text }); }
  rename(name) { this.send({ t: 'rename', name }); }
  purchase(kind, id) { this.send({ t: 'purchase', kind, id }); }
  equip(kind, id) { this.send({ t: 'equip', kind, id }); }
  saveLoadout(loadout) { this.send({ t: 'loadout', loadout }); }
  setLoadoutLocal(loadout) { if (this.profile) this.profile.loadout = sanitizeLoadout(loadout); }
  publishMap(map) { this.send({ t: 'publishMap', map }); }
  cmd(a, extra = {}) { this.send({ t: 'cmd', a, ...extra }); }
  throwGrenade(yaw, pitch) { this.send({ t: 'nade', yaw, pitch }); }

  // ------------------------------------------------------------------- input
  moveCfg() {
    const weapon = WEAPONS[this.me?.active] || WEAPONS.p9;
    return {
      speedScale: this.room?.settings?.speedScale ?? 1,
      gravityScale: this.room?.settings?.gravityScale ?? 1,
      jumpScale: this.room?.settings?.jumpScale ?? 1,
      speedMult: weapon.speedMult || 1,
    };
  }

  update(dt, input) {
    if (!this.local || !this.room || !this.world) return;
    if (this.room.phase === 'ended') return;
    if (!this.me?.alive) {
      this.decayCorrection(dt);
      return;
    }
    const step = 1 / 60;
    this.acc = Math.min(this.acc + dt, 0.2);
    let steps = 0;
    while (this.acc >= step && steps < 4) {
      this.acc -= step;
      this.stepAndSend(step, input);
      steps++;
    }
    this.decayCorrection(dt);
  }

  stepAndSend(dt, input) {
    const seq = ++this.inputSeq;
    const buttons = input.buttons | 0;
    const yaw = input.yaw;
    const pitch = input.pitch;
    stepPlayer(this.local, { buttons, yaw, pitch }, this.world, dt, this.moveCfg());
    const payload = {
      t: 'input', seq, dt: +dt.toFixed(4), b: buttons,
      yaw: +yaw.toFixed(4), pitch: +pitch.toFixed(2),
      slot: input.slot | 0, scope: input.scope ? 1 : 0,
      rtt: Math.round(this.rtt),
    };
    this.send(payload);
    this.pending.push({ seq, dt, buttons, yaw, pitch });
    if (this.pending.length > 240) this.pending.shift();
  }

  decayCorrection(dt) {
    const decay = Math.exp(-dt * 9);
    this.correction[0] *= decay;
    this.correction[1] *= decay;
    this.correction[2] *= decay;
    if (Math.abs(this.correction[0]) < 0.002) this.correction[0] = 0;
    if (Math.abs(this.correction[1]) < 0.002) this.correction[1] = 0;
    if (Math.abs(this.correction[2]) < 0.002) this.correction[2] = 0;
  }

  // -------------------------------------------------------------- snapshots
  onSnapshot(msg) {
    this.stats.snapshots++;
    this.stats.serverTick = msg.tick;
    this.lastSnapshotWall = performance.now();
    if (this.room) this.room.phase = msg.phase;
    this.me = msg.you;
    if (this.me) this.me.alive = !!(msg.players.find((p) => p[0] === this.youId)?.[14]);

    // clock sync: map server time onto the local performance clock
    const offset = msg.st - performance.now();
    if (!this.clockReady) { this.clockOffset = offset; this.clockReady = true; }
    else if (Math.abs(offset - this.clockOffset) < 900) this.clockOffset += (offset - this.clockOffset) * 0.08;

    this.snapshots.push({ msg, at: performance.now() });
    while (this.snapshots.length > 40) this.snapshots.shift();
    this.latest = msg;
    const current = this.snapshots[this.snapshots.length - 1];
    const cutoff = current.msg.st - 2500;
    while (this.snapshots.length > 2 && this.snapshots[0].msg.st < cutoff) this.snapshots.shift();

    this.reconcile(msg);

    if (performance.now() - this.lastPingAt > 2000) {
      this.lastPingAt = performance.now();
      const c = Math.round(performance.now() * 1000) % 2147483647;
      this.pendingPings.set(c, performance.now());
      this.send({ t: 'ping', c });
      if (this.pendingPings.size > 8) {
        const oldest = this.pendingPings.keys().next().value;
        this.pendingPings.delete(oldest);
      }
    }
  }

  reconcile(msg) {
    const arr = msg.players.find((p) => p[0] === this.youId);
    if (!arr || !this.local) return;
    const mine = msg.you;
    if (!mine) return;
    const alive = arr[14] === 1;
    this.me.alive = alive;
    if (!alive) return;

    const serverPos = [arr[1], arr[2], arr[3]];
    const before = this.local.pos.slice();
    const ack = mine.seq || 0;
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();

    const serverVel = mine.vel || [0, 0, 0];
    const distance = Math.hypot(this.local.pos[0] - serverPos[0], this.local.pos[1] - serverPos[1], this.local.pos[2] - serverPos[2]);
    const teleported = distance > 4;
    this.local.pos = serverPos.slice();
    this.local.vel = serverVel.slice();
    this.local.onGround = !!mine.onGround;
    this.local.crouchAmount = arr[13];
    this.local.yaw = arr[4];
    this.local.pitch = arr[5];
    if (!teleported) {
      for (const p of this.pending) {
        stepPlayer(this.local, { buttons: p.buttons, yaw: p.yaw, pitch: p.pitch }, this.world, p.dt, this.moveCfg());
      }
      const dx = before[0] - this.local.pos[0];
      const dy = before[1] - this.local.pos[1];
      const dz = before[2] - this.local.pos[2];
      if (Math.hypot(dx, dy, dz) < 1.6) {
        this.correction[0] = clamp(this.correction[0] + dx, -1.2, 1.2);
        this.correction[1] = clamp(this.correction[1] + dy, -1.2, 1.2);
        this.correction[2] = clamp(this.correction[2] + dz, -1.2, 1.2);
      }
    } else {
      this.correction = [0, 0, 0];
    }
  }

  renderTime() {
    return performance.now() + this.clockOffset - INTERP_MS - Math.min(40, this.jitter * 0.6);
  }

  getRemotePlayers() {
    const out = [];
    if (!this.snapshots.length) return out;
    const t = this.renderTime();
    let a = this.snapshots[0];
    let b = this.snapshots[this.snapshots.length - 1];
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].msg.st <= t && this.snapshots[i + 1].msg.st >= t) {
        a = this.snapshots[i];
        b = this.snapshots[i + 1];
        break;
      }
      if (this.snapshots[i + 1].msg.st < t) { a = this.snapshots[i + 1]; b = this.snapshots[i + 1]; }
    }
    const span = Math.max(1, b.msg.st - a.msg.st);
    const alpha = a === b ? 1 : clamp((t - a.msg.st) / span, 0, 1);
    const bMap = new Map(b.msg.players.map((p) => [p[0], p]));
    for (const [id, arrA] of a.msg.players.map((p) => [p[0], p])) {
      if (id === this.youId) continue;
      const arrB = bMap.get(id) || arrA;
      const dead = arrB[14] === 0;
      const teleport = Math.hypot(arrA[1] - arrB[1], arrA[3] - arrB[3]) > 4;
      const t2 = teleport ? 1 : alpha;
      const yawA = arrA[4], yawB = arrB[4];
      let dyaw = yawB - yawA;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const info = this.rosterById.get(id);
      out.push({
        id,
        pos: dead ? [arrA[1], arrA[2], arrA[3]] : [
          arrA[1] + (arrB[1] - arrA[1]) * t2,
          arrA[2] + (arrB[2] - arrA[2]) * t2,
          arrA[3] + (arrB[3] - arrA[3]) * t2,
        ],
        yaw: yawA + dyaw * t2,
        pitch: arrA[5] + (arrB[5] - arrA[5]) * t2,
        crouch: arrA[13] + (arrB[13] - arrA[13]) * t2,
        flags: arrB[6], hp: arrB[7], armor: arrB[8],
        team: arrB[9], weapon: arrB[10],
        alive: arrB[14] === 1, scoped: arrB[15] === 1,
        gunLevel: arrB[16], kills: arrB[17], deaths: arrB[18],
        name: info?.name || `PLAYER ${id}`,
        color: info?.color || null,
        bot: !!info?.bot,
        equipped: info?.equipped || null,
      });
    }
    return out;
  }

  getYouArray() {
    return this.latest?.players.find((p) => p[0] === this.youId) || null;
  }

  approximateSpread() {
    if (!this.local || !this.me) return 0;
    const w = WEAPONS[this.me.active];
    if (!w) return 0;
    return spreadFor(w, {
      onGround: this.local.onGround,
      vel: this.local.vel,
      crouchAmount: this.local.crouchAmount,
      scoped: !!this.me.scopeActive,
    });
  }

  /** Client-side visual trace (server remains authoritative for damage). */
  traceVisual(origin, dir, maxDist) {
    if (!this.world) return { end: origin };
    const hit = rayWorld(this.world, origin, dir, maxDist);
    let dist = hit ? hit.t : maxDist;
    for (const p of this.getRemotePlayers()) {
      if (!p.alive) continue;
      const h = rayPlayer(origin, dir, dist, { pos: p.pos, crouchAmount: p.crouch });
      if (h && h.t < dist) dist = h.t;
    }
    return { end: [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist], normal: hit ? [hit.nx, hit.ny, hit.nz] : null, dist };
  }
}
