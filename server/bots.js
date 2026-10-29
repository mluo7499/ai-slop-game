// Server-side bot brains. They drive the same stepPlayer physics and tryFire path
// as humans, so they obey every rule and are indistinguishable in the snapshot.
import { BTN, WEAPONS, clamp, DEG, eyeHeight, playerHeight } from '../shared/constants.js';
import { angleFromDirection, hasLineOfSight, groundHeight } from '../shared/physics.js';

const DIFFICULTY = {
  easy: { reaction: 0.52, error: 5.5, tolerance: 8, burst: 0.28, pause: [0.45, 0.9], speed: 0.8, engage: 30 },
  normal: { reaction: 0.34, error: 3.0, tolerance: 5, burst: 0.36, pause: [0.3, 0.65], speed: 0.92, engage: 45 },
  hard: { reaction: 0.22, error: 1.6, tolerance: 3, burst: 0.45, pause: [0.2, 0.45], speed: 1.0, engage: 65 },
  insane: { reaction: 0.12, error: 0.75, tolerance: 2, burst: 0.6, pause: [0.12, 0.3], speed: 1.0, engage: 85 },
};

function eye(bot) {
  return [bot.phys.pos[0], bot.phys.pos[1] + eyeHeight(bot.phys.crouchAmount), bot.phys.pos[2]];
}

function aimAt(bot, point, errorDeg) {
  const o = eye(bot);
  const dx = point[0] - o[0];
  const dy = point[1] - o[1];
  const dz = point[2] - o[2];
  const { yaw, pitch } = angleFromDirection(dx, dy, dz);
  const err = errorDeg * DEG * (0.5 + Math.random() * 0.9);
  return {
    yaw: yaw + (Math.random() - 0.5) * err,
    pitch: clamp(pitch + (Math.random() - 0.5) * err, -85, 85),
  };
}

function chooseTarget(room, bot, maxDist) {
  let best = null;
  let bestDist = Infinity;
  const o = eye(bot);
  for (const other of room.allPlayers()) {
    if (other.id === bot.id || !other.alive) continue;
    if (room.mode.teamBased && !room.settings.friendlyFire && other.team === bot.team) continue;
    const dx = other.phys.pos[0] - bot.phys.pos[0];
    const dz = other.phys.pos[2] - bot.phys.pos[2];
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist || dist >= bestDist) continue;
    const visible = hasLineOfSight(room.world, o, other.phys.pos, 1.15);
    const recentlyShot = bot.lastDamageFrom === other.id && room.now - bot.lastDamageAt < 2.5;
    if (!visible && !recentlyShot) continue;
    bestDist = dist;
    best = other;
  }
  return best ? { target: best, dist: bestDist } : null;
}

function objectivePoint(room, bot) {
  const mode = room.modeId;
  if (mode === 'bomb') {
    if (room.bomb?.planted) {
      return { x: room.bomb.x, z: room.bomb.z, r: 2 };
    }
    const sites = room.map.sites || [];
    if (sites.length) {
      if (bot.role === 'def') {
        const site = sites[bot.id % sites.length];
        return { x: site.x + (Math.random() - 0.5) * 8, z: site.z + (Math.random() - 0.5) * 8, r: 3 };
      }
      const site = sites[Math.floor(Math.random() * sites.length)];
      return { x: site.x, z: site.z, r: site.r };
    }
  }
  if (mode === 'koth' && room.hill) {
    return { x: room.hill.x + (Math.random() - 0.5) * 4, z: room.hill.z + (Math.random() - 0.5) * 4, r: 3 };
  }
  // deathmatch: prefer areas around the enemy, otherwise wander between anchors
  const anchors = [];
  for (const s of room.map.spawns || []) anchors.push({ x: s.x, z: s.z });
  for (const s of room.map.sites || []) anchors.push({ x: s.x, z: s.z });
  for (const h of room.map.hills || []) anchors.push({ x: h.x, z: h.z });
  if (!anchors.length) return { x: 0, z: 0, r: 4 };
  if (Math.random() < 0.55) {
    const enemies = room.allPlayers().filter((p) => p.alive && p.id !== bot.id && p.team !== bot.team);
    if (enemies.length) {
      const e = enemies[Math.floor(Math.random() * enemies.length)];
      return { x: e.phys.pos[0] + (Math.random() - 0.5) * 10, z: e.phys.pos[2] + (Math.random() - 0.5) * 10, r: 4 };
    }
  }
  const a = anchors[Math.floor(Math.random() * anchors.length)];
  return { x: a.x + (Math.random() - 0.5) * 6, z: a.z + (Math.random() - 0.5) * 6, r: 3 };
}

export function updateBot(room, bot, dt) {
  const brain = bot.brain;
  if (!brain || !bot.alive) return;
  const diff = DIFFICULTY[bot.difficulty] || DIFFICULTY.normal;
  brain.think -= dt;
  brain.strafeTimer -= dt;
  if (brain.strafeTimer <= 0) {
    brain.strafeTimer = 0.4 + Math.random() * 0.8;
    brain.strafe = Math.random() < 0.5 ? -1 : 1;
  }

  const ammo = bot.ammo[bot.active];
  const w = WEAPONS[bot.active];
  if (room.phase !== 'live') {
    room.__stepBot(bot, { buttons: 0, yaw: bot.phys.yaw, pitch: bot.phys.pitch, dt }, dt);
    return;
  }
  if (w && w.mag && ammo && ammo.mag <= 0 && bot.reloadUntil <= room.now) room.startReload(bot);
  if (bot.reloadUntil > room.now) {
    bot.phys.vel[0] *= 0.9;
    bot.phys.vel[2] *= 0.9;
  }

  let target = null;
  let targetDist = 0;
  if (brain.think <= 0) {
    brain.think = 0.16 + Math.random() * 0.14;
    const found = chooseTarget(room, bot, diff.engage);
    if (found) {
      if (brain.targetId !== found.target.id) brain.reactAt = room.now + diff.reaction * (0.7 + Math.random() * 0.6);
      brain.targetId = found.target.id;
      target = found.target;
      targetDist = found.dist;
      brain.goal = { x: target.phys.pos[0], z: target.phys.pos[2], r: 6 };
      brain.aimErr = (Math.random() - 0.5) * diff.error;
    } else {
      brain.targetId = 0;
    }
    if (!brain.goal || room.now - brain.lastGoalAt > 3.2) {
      brain.goal = objectivePoint(room, bot);
      brain.lastGoalAt = room.now;
    }
  } else if (brain.targetId) {
    target = room.allPlayers().find((p) => p.id === brain.targetId && p.alive) || null;
    if (target) targetDist = Math.hypot(target.phys.pos[0] - bot.phys.pos[0], target.phys.pos[2] - bot.phys.pos[2]);
  }

  const buttons = [];
  let aimYaw = bot.phys.yaw;
  let aimPitch = bot.phys.pitch;
  const pos = bot.phys.pos;
  const goal = brain.goal || { x: 0, z: 0, r: 4 };
  const goalDist = Math.hypot(goal.x - pos[0], goal.z - pos[2]);

  if (target) {
    const tPos = target.phys.pos;
    const aimPoint = [tPos[0], tPos[1] + playerHeight(target.phys.crouchAmount) * 0.78, tPos[2]];
    const aim = aimAt(bot, aimPoint, Math.abs(brain.aimErr || 0));
    aimYaw = aim.yaw;
    aimPitch = aim.pitch;
    const aimErrorAbs = Math.abs(((aim.yaw - bot.phys.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (targetDist > 9 || Math.random() < 0.4) buttons.push(BTN.FORWARD);
    if (targetDist < 4) buttons.push(BTN.BACK);
    if (brain.strafe > 0) buttons.push(BTN.RIGHT); else buttons.push(BTN.LEFT);
    if (bot.health < 45 && Math.random() < 0.5) { buttons.length = 0; buttons.push(BTN.BACK); }
    const canShoot = room.now >= (brain.reactAt || 0) && targetDist <= diff.engage;
    if (canShoot && aimErrorAbs < diff.tolerance * DEG * 8 && bot.reloadUntil <= room.now) {
      if (brain.burstPause && room.now < brain.burstPause) {
        // holding fire pause
      } else {
        buttons.push(BTN.FIRE);
        brain.burstUntil = brain.burstUntil || room.now + diff.burst;
        if (room.now > brain.burstUntil) {
          brain.burstPause = room.now + diff.pause[0] + Math.random() * (diff.pause[1] - diff.pause[0]);
          brain.burstUntil = 0;
        }
      }
    }
  } else {
    const aim = aimAt(bot, [goal.x, bot.phys.pos[1], goal.z], 2.5);
    aimYaw = aim.yaw;
    aimPitch = clamp(aim.pitch, -20, 20);
    if (goalDist > 2.5) buttons.push(BTN.FORWARD);
    if (brain.strafe > 0 && Math.random() < 0.15) buttons.push(BTN.RIGHT);
    if (goalDist < 2) { brain.lastGoalAt = 0; brain.goal = null; }
  }

  // objective interaction
  const sites = room.map.sites || [];
  if (room.modeId === 'bomb' && room.phase === 'live') {
    if (bot.role === 'atk' && !room.bomb?.planted) {
      const site = sites.find((s) => Math.hypot(pos[0] - s.x, pos[2] - s.z) <= s.r * 0.85);
      if (site) { buttons.length = 0; buttons.push(BTN.USE); }
    }
    if (bot.role === 'def' && room.bomb?.planted) {
      if (Math.hypot(pos[0] - room.bomb.x, pos[2] - room.bomb.z) < 1.8) {
        buttons.length = 0;
        buttons.push(BTN.USE);
      }
    }
  }

  // stuck detection: hop and repick
  const moved = Math.hypot(bot.phys.vel[0], bot.phys.vel[2]);
  if (moved < 0.6 && (buttons.includes(BTN.FORWARD))) {
    brain.stuck = (brain.stuck || 0) + dt;
    if (brain.stuck > 0.5) {
      buttons.push(BTN.JUMP);
      if (brain.stuck > 1.4) { brain.goal = null; brain.lastGoalAt = 0; brain.stuck = 0; brain.strafe *= -1; }
    }
  } else brain.stuck = 0;

  let mask = 0;
  for (const b of buttons) mask |= b;
  const inp = { buttons: mask, yaw: aimYaw, pitch: aimPitch, dt };
  const prevYaw = bot.phys.yaw;
  // physics (also applies yaw/pitch)
  room.__stepBot(bot, inp, dt);
  bot.fireHeld = (mask & BTN.FIRE) !== 0;
  bot.useHeld = (mask & BTN.USE) !== 0;
  if (mask & BTN.FIRE && room.phase === 'live') room.tryFire(bot);
  if (Math.abs(prevYaw - aimYaw) > Math.PI) { /* wrapped, no-op */ }
  if (bot.phys.pos[1] < -6) {
    bot.phys.pos[0] = goal.x;
    bot.phys.pos[2] = goal.z;
    bot.phys.pos[1] = groundHeight(room.world, goal.x, goal.z, 30) + 0.1;
  }
}
