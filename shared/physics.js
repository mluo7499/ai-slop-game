// Deterministic player movement + collision. Runs identically on the authoritative
// server and in the browser for client-side prediction.
import { PHYS, BTN, clamp, playerHeight } from './constants.js';

const EPS = 1e-4;

export function makeWorld(blocks) {
  const boxes = [];
  for (const b of blocks) {
    if (b.solid === false) continue;
    const hx = b.w / 2, hy = b.h / 2, hz = b.d / 2;
    boxes.push({
      min: [b.x - hx, b.y - hy, b.z - hz],
      max: [b.x + hx, b.y + hy, b.z + hz],
      mat: b.m || 'concrete',
    });
  }
  return { boxes };
}

export function createPlayerState(x, y, z) {
  return {
    pos: [x, y, z],
    vel: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    onGround: false,
    crouchAmount: 0,
    crouched: false,
    jumpTimer: 0,
    stepPhase: 0,
    lastLand: 0,
    fallSpeed: 0,
  };
}

export function playerBounds(pos, height, radius = PHYS.radius) {
  return [
    pos[0] - radius, pos[1], pos[2] - radius,
    pos[0] + radius, pos[1] + height, pos[2] + radius,
  ];
}

export function collidesAt(world, pos, height, radius = PHYS.radius) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = playerBounds(pos, height, radius);
  for (let i = 0; i < world.boxes.length; i++) {
    const b = world.boxes[i];
    if (maxX > b.min[0] + EPS && minX < b.max[0] - EPS &&
        maxY > b.min[1] + EPS && minY < b.max[1] - EPS &&
        maxZ > b.min[2] + EPS && minZ < b.max[2] - EPS) return b;
  }
  return null;
}

/** Height of walkable ground under a point (used for spawning / editor). */
export function groundHeight(world, x, z, from = 40) {
  let best = 0;
  for (const b of world.boxes) {
    if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
    if (b.max[1] <= from && b.max[1] > best) best = b.max[1];
  }
  return best;
}

function applyFriction(p, dt, friction) {
  const speed = Math.hypot(p.vel[0], p.vel[2]);
  if (speed < 0.08) { p.vel[0] = 0; p.vel[2] = 0; return; }
  const drop = Math.max(speed, 2.5) * friction * dt;
  const k = Math.max(0, speed - drop) / speed;
  p.vel[0] *= k;
  p.vel[2] *= k;
}

function accelerate(p, wx, wz, wishSpeed, accel, dt) {
  const current = p.vel[0] * wx + p.vel[2] * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let accelSpeed = accel * wishSpeed * dt;
  if (accelSpeed > add) accelSpeed = add;
  p.vel[0] += accelSpeed * wx;
  p.vel[2] += accelSpeed * wz;
}

function resolveVertical(p, world, dt) {
  const height = playerHeight(p.crouchAmount);
  const r = PHYS.radius;
  const startY = p.pos[1] - p.vel[1] * dt; // previous feet height
  p.onGround = false;
  const [px, , pz] = p.pos;
  for (const b of world.boxes) {
    if (p.pos[0] + r <= b.min[0] + EPS || p.pos[0] - r >= b.max[0] - EPS) continue;
    if (p.pos[2] + r <= b.min[2] + EPS || p.pos[2] - r >= b.max[2] - EPS) continue;
    if (p.pos[1] + height <= b.min[1] + EPS || p.pos[1] >= b.max[1] - EPS) continue;
    if (p.vel[1] <= 0) {
      if (startY >= b.max[1] - 0.35) {
        p.pos[1] = b.max[1];
        p.vel[1] = 0;
        p.onGround = true;
        p.fallSpeed = 0;
      }
    } else {
      p.pos[1] = b.min[1] - height - EPS;
      p.vel[1] = 0;
    }
  }
  if (p.pos[1] <= 0) {
    p.pos[1] = 0;
    p.vel[1] = 0;
    p.onGround = true;
  }
  // fail-safe: if we somehow ended up inside geometry, push up to the nearest surface
  if (!p.onGround) {
    const blocked = collidesAt(world, p.pos, height);
    if (blocked && blocked.max[1] >= p.pos[1] && blocked.max[1] - p.pos[1] < 2.5) {
      if (!collidesAt(world, [px, blocked.max[1] + EPS, pz], height)) {
        p.pos[1] = blocked.max[1] + EPS;
        p.vel[1] = 0;
        p.onGround = true;
      }
    }
  }
}

function moveAxis(p, world, axis, dt) {
  const r = PHYS.radius;
  const height = playerHeight(p.crouchAmount);
  p.pos[axis] += p.vel[axis] * dt;
  for (let iter = 0; iter < 3; iter++) {
    let hit = false;
    for (const b of world.boxes) {
      const minX = p.pos[0] - r, maxX = p.pos[0] + r;
      const minY = p.pos[1], maxY = p.pos[1] + height;
      const minZ = p.pos[2] - r, maxZ = p.pos[2] + r;
      if (maxX <= b.min[0] + EPS || minX >= b.max[0] - EPS) continue;
      if (maxY <= b.min[1] + EPS || minY >= b.max[1] - EPS) continue;
      if (maxZ <= b.min[2] + EPS || minZ >= b.max[2] - EPS) continue;

      // step up small ledges while grounded
      if (p.onGround && b.max[1] > p.pos[1] && b.max[1] - p.pos[1] <= PHYS.stepHeight + 0.02) {
        const lifted = [p.pos[0], b.max[1] + EPS, p.pos[2]];
        if (!collidesAt(world, lifted, height)) {
          p.pos[1] = b.max[1] + EPS;
          continue;
        }
      }
      if (p.vel[axis] > 0) p.pos[axis] = b.min[axis] - r - EPS;
      else if (p.vel[axis] < 0) p.pos[axis] = b.max[axis] + r + EPS;
      else p.pos[axis] = (p.pos[axis] > (b.min[axis] + b.max[axis]) / 2)
        ? b.max[axis] + r + EPS : b.min[axis] - r - EPS;
      p.vel[axis] = 0;
      hit = true;
      break;
    }
    if (!hit) break;
  }
}

function isOverlappingWorld(p, world) {
  return !!collidesAt(world, p.pos, playerHeight(p.crouchAmount));
}

/**
 * Advance a player one input frame. `cfg` carries custom-game rules:
 * {speedScale, gravityScale, jumpScale, speedMult}
 */
export function stepPlayer(p, input, world, dt, cfg = {}) {
  dt = clamp(dt, 0, 0.05);
  if (dt <= 0) return;
  const buttons = input.buttons | 0;
  p.yaw = input.yaw;
  p.pitch = clamp(input.pitch, -89, 89);

  const wantCrouch = (buttons & BTN.CROUCH) !== 0;
  const cannotStand = wantCrouch ? false : (() => {
    // check headroom before rising
    const testHeight = playerHeight(0);
    const saved = p.crouchAmount;
    p.crouchAmount = 0;
    const blocked = collidesAt(world, p.pos, testHeight);
    p.crouchAmount = saved;
    return !!blocked;
  })();
  p.crouched = wantCrouch || cannotStand;
  const target = p.crouched ? 1 : 0;
  const crouchRate = p.crouched ? 9 : 6;
  p.crouchAmount += clamp(target - p.crouchAmount, -dt * crouchRate, dt * crouchRate);

  const fwd = ((buttons & BTN.FORWARD) ? 1 : 0) - ((buttons & BTN.BACK) ? 1 : 0);
  const side = ((buttons & BTN.RIGHT) ? 1 : 0) - ((buttons & BTN.LEFT) ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * fwd + cy * side;
  let wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const speedScale = cfg.speedScale ?? 1;
  const weaponMult = cfg.speedMult ?? 1;
  const crouchMult = 1 - p.crouchAmount * (1 - PHYS.crouchSpeed / PHYS.maxSpeed);
  const walkMult = (buttons & BTN.WALK) && !p.crouched ? PHYS.walkSpeed / PHYS.maxSpeed : 1;
  const wishSpeed = PHYS.maxSpeed * speedScale * weaponMult * crouchMult * walkMult;

  p.jumpTimer = Math.max(0, p.jumpTimer - dt);
  if ((buttons & BTN.JUMP) && p.onGround && p.jumpTimer <= 0) {
    p.vel[1] = PHYS.jumpVel * (cfg.jumpScale ?? 1);
    p.onGround = false;
    p.jumpTimer = PHYS.jumpCooldown;
  }

  const gravity = PHYS.gravity * (cfg.gravityScale ?? 1);
  if (!p.onGround) {
    applyFriction(p, dt, PHYS.friction * 0.35);
    accelerate(p, wx, wz, wishSpeed, PHYS.airAccel, dt);
    p.vel[1] = Math.max(-PHYS.maxFall, p.vel[1] - gravity * dt);
  } else {
    applyFriction(p, dt, PHYS.friction);
    accelerate(p, wx, wz, wishSpeed, PHYS.accel, dt);
    p.vel[1] = -0.5;
  }

  const beforeY = p.pos[1];
  p.pos[0] += p.vel[0] * dt;
  p.pos[2] += p.vel[2] * dt;
  resolveVertical(p, world, dt);
  moveAxis(p, world, 0, 0);
  moveAxis(p, world, 2, 0);
  // resolve horizontal penetration introduced by the vertical pass
  if (isOverlappingWorld(p, world)) {
    moveAxis(p, world, 0, 0);
    moveAxis(p, world, 2, 0);
  }
  if (p.onGround && beforeY - p.pos[1] > 0.4) p.lastLand = beforeY - p.pos[1];
  const speed = Math.hypot(p.vel[0], p.vel[2]);
  p.stepPhase = (p.stepPhase + speed * dt * 1.55) % (Math.PI * 2);
  if (!p.onGround) p.fallSpeed = Math.max(p.fallSpeed, -p.vel[1]);
}

// ---------------------------------------------------------------- ray casting

export function rayAABB(ox, oy, oz, dx, dy, dz, maxT, b) {
  let tmin = 0, tmax = maxT;
  let nx = 0, ny = 0, nz = 0;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = b.min[axis], hi = b.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      let sign = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) {
        tmin = t1;
        nx = axis === 0 ? sign : 0; ny = axis === 1 ? sign : 0; nz = axis === 2 ? sign : 0;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return { t: tmin, nx, ny, nz };
}

export function rayWorld(world, origin, dir, maxDist) {
  let best = null;
  for (const b of world.boxes) {
    const hit = rayAABB(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], maxDist, b);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, box: b };
  }
  return best;
}

/** Ray vs a standing player. Body box + tighter head box for headshots. */
export function rayPlayer(origin, dir, maxDist, target) {
  const h = playerHeight(target.crouchAmount || 0);
  const r = 0.33;
  const px = target.pos[0], py = target.pos[1], pz = target.pos[2];
  const body = {
    min: [px - r, py + 0.15, pz - r],
    max: [px + r, py + h - 0.28, pz + r],
  };
  const head = {
    min: [px - 0.19, py + h - 0.3, pz - 0.19],
    max: [px + 0.19, py + h, pz + 0.19],
  };
  const bodyHit = rayAABB(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], maxDist, body);
  const headHit = rayAABB(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], maxDist, head);
  if (headHit && headHit.t <= maxDist) return { t: headHit.t, headshot: true };
  if (bodyHit && bodyHit.t <= maxDist) return { t: bodyHit.t, headshot: false };
  return null;
}

export function directionFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch * Math.PI / 180);
  return [-Math.sin(yaw) * cp, Math.sin(pitch * Math.PI / 180), -Math.cos(yaw) * cp];
}

export function angleFromDirection(dx, dy, dz) {
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.asin(clamp(dy, -1, 1)) * 180 / Math.PI,
  };
}

/** Simple bouncing projectile (frag grenades). */
export function stepProjectile(proj, world, dt) {
  const gravity = PHYS.gravity * 0.75;
  proj.vel[1] -= gravity * dt;
  const steps = 2;
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (let axis = 0; axis < 3; axis++) {
      proj.pos[axis] += proj.vel[axis] * sdt;
      // sample as an AABB around the projectile
      const box = {
        min: [proj.pos[0] - 0.12, proj.pos[1] - 0.12, proj.pos[2] - 0.12],
        max: [proj.pos[0] + 0.12, proj.pos[1] + 0.12, proj.pos[2] + 0.12],
      };
      for (const b of world.boxes) {
        if (box.max[0] <= b.min[0] || box.min[0] >= b.max[0]) continue;
        if (box.max[1] <= b.min[1] || box.min[1] >= b.max[1]) continue;
        if (box.max[2] <= b.min[2] || box.min[2] >= b.max[2]) continue;
        if (axis === 1) {
          proj.pos[1] = proj.vel[1] > 0 ? b.min[1] - 0.13 : b.max[1] + 0.13;
        } else if (axis === 0) {
          proj.pos[0] = proj.vel[0] > 0 ? b.min[0] - 0.13 : b.max[0] + 0.13;
        } else {
          proj.pos[2] = proj.vel[2] > 0 ? b.min[2] - 0.13 : b.max[2] + 0.13;
        }
        proj.vel[axis] *= -0.42;
        proj.vel[0] *= 0.86;
        proj.vel[2] *= 0.86;
        box.min[0] = proj.pos[0] - 0.12; box.max[0] = proj.pos[0] + 0.12;
        box.min[1] = proj.pos[1] - 0.12; box.max[1] = proj.pos[1] + 0.12;
        box.min[2] = proj.pos[2] - 0.12; box.max[2] = proj.pos[2] + 0.12;
      }
    }
  }
  if (proj.pos[1] < 0.12) { proj.pos[1] = 0.13; proj.vel[1] = Math.abs(proj.vel[1]) * 0.35; }
}

/** True when `target` is visible from `origin` (no world geometry between). */
export function hasLineOfSight(world, origin, target, targetHeight = 1.2) {
  const t = [target[0], target[1] + targetHeight, target[2]];
  const dx = t[0] - origin[0], dy = t[1] - origin[1], dz = t[2] - origin[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return true;
  const dir = [dx / dist, dy / dist, dz / dist];
  const hit = rayWorld(world, origin, dir, dist - 0.25);
  return !hit;
}
