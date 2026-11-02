// Deterministic movement regression: gravity, jumping, landing, ledge falls and
// step-up. Runs the exact shared physics module used by the server + client.
import { BTN, PHYS, computeLook } from '../shared/constants.js';
import { createPlayerState, makeWorld, stepPlayer } from '../shared/physics.js';

const DT = 1 / 60;
const blocks = [
  { x: 0, y: -0.5, z: 0, w: 60, h: 1, d: 60, m: 'floor' },
  { x: 5, y: 1, z: 0, w: 6, h: 2, d: 6, m: 'metal' },
  { x: -5, y: 0.2, z: 0, w: 4, h: 0.4, d: 4, m: 'concrete' },
  { x: 0, y: 2.2, z: 12, w: 8, h: 0.4, d: 8, m: 'metal' },
];
const world = makeWorld(blocks);

function run(p, ticks, buttons = 0, yaw = 0) {
  let maxY = p.pos[1];
  let minY = p.pos[1];
  let minVel = p.vel[1];
  for (let i = 0; i < ticks; i++) {
    stepPlayer(p, { buttons, yaw, pitch: 0 }, world, DT, {});
    maxY = Math.max(maxY, p.pos[1]);
    minY = Math.min(minY, p.pos[1]);
    minVel = Math.min(minVel, p.vel[1]);
  }
  return { maxY, minY, minVel };
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// 1. Free fall from 5 m must actually descend and land.
{
  const p = createPlayerState(0, 5, 0);
  const { minY } = run(p, 180);
  check('free fall reaches the floor', Math.abs(p.pos[1]) < 0.01 && p.onGround, `y=${p.pos[1].toFixed(3)} minY=${minY.toFixed(2)}`);
}

// 2. Standing on a platform, then walking off the edge must fall to the ground.
{
  const p = createPlayerState(5, 2, 0);
  run(p, 5);
  const before = p.pos[1];
  // yaw -PI/2 makes forward point along +X, off the platform
  run(p, 120, BTN.FORWARD, -Math.PI / 2);
  check('walking off a ledge falls', p.pos[1] < 0.01 && p.onGround, `platform y=${before.toFixed(2)} → y=${p.pos[1].toFixed(3)}, x=${p.pos[0].toFixed(2)}`);
}

// 3. Jump height and air time are CS-like (~1.08 m, ~0.75 s).
{
  const p = createPlayerState(0, 0, 0);
  run(p, 3);
  const groundY = p.pos[1];
  let maxY = groundY;
  let airTicks = 0;
  let wasAir = false;
  for (let i = 0; i < 90; i++) {
    stepPlayer(p, { buttons: i === 0 ? BTN.JUMP : 0, yaw: 0, pitch: 0 }, world, DT, {});
    maxY = Math.max(maxY, p.pos[1]);
    if (!p.onGround) { wasAir = true; airTicks++; }
  }
  const height = maxY - groundY;
  check('jump height is ~1.0 m', height > 0.9 && height < 1.2, `${height.toFixed(3)} m`);
  check('jump lands again', wasAir && p.onGround, `${airTicks} airborne ticks (${(airTicks * DT).toFixed(2)} s)`);
}

// 4. Holding jump must not auto-bhop; a fresh press is required.
{
  const p = createPlayerState(0, 0, 0);
  run(p, 3);
  let jumps = 0;
  let prevAir = false;
  for (let i = 0; i < 120; i++) {
    stepPlayer(p, { buttons: BTN.JUMP, yaw: 0, pitch: 0 }, world, DT, {});
    if (!p.onGround && !prevAir) jumps++;
    prevAir = !p.onGround;
  }
  check('holding jump does not auto-bhop', jumps === 1, `${jumps} takeoff(s)`);
}

// 5. Ceiling collision stops upward motion at head height.
{
  const p = createPlayerState(0, 0, 12);
  run(p, 3);
  const maxHead = run(p, 60, BTN.JUMP).maxY + PHYS.height;
  check('jumping into a ceiling is blocked', maxHead <= 2.01, `head reached ${maxHead.toFixed(2)} m (underside 2.00)`);
}

// 5b. Falling onto a platform lands on top rather than sliding through it.
{
  const p = createPlayerState(5, 6, 0);
  run(p, 120);
  check('falling onto a platform lands on top', Math.abs(p.pos[1] - 2) < 0.01 && p.onGround, `y=${p.pos[1].toFixed(3)}`);
}

// 6. A 0.4 m lip is stepped over while walking.
{
  const p = createPlayerState(-8, 0, 0);
  run(p, 3);
  run(p, 60, BTN.FORWARD, -Math.PI / 2);
  check('0.4 m step is climbed', Math.abs(p.pos[1] - 0.4) < 0.02 && p.onGround, `y=${p.pos[1].toFixed(3)}, x=${p.pos[0].toFixed(2)}`);
}

// 7. Ground stick: standing still must not drift or sink.
{
  const p = createPlayerState(0, 0, 0);
  run(p, 180);
  check('standing still is stable', p.pos[1] === 0 && p.onGround && Math.hypot(p.vel[0], p.vel[2]) < 0.001, `y=${p.pos[1]}`);
}

// 8. Terminal fall speed is clamped.
{
  const p = createPlayerState(0, 200, 0);
  const { minVel } = run(p, 600);
  check('fall speed is clamped', minVel >= -PHYS.maxFall - 0.001 && minVel < -PHYS.maxFall + 1, `min vel.y=${minVel.toFixed(2)}`);
}

// 9. Vertical mouse look must have the same sensitivity as horizontal. This was
// the original bug: pitch is in degrees, yaw in radians, and the raw delta made
// vertical look ~57x slower.
{
  const right = computeLook(0, 0, 300, 0);
  const up = computeLook(0, 0, 0, -300);
  check('vertical look matches horizontal', Math.abs(Math.abs(right.yaw) - Math.abs(up.pitch * Math.PI / 180)) < 1e-6,
    `yaw ${right.yaw.toFixed(3)} rad vs pitch ${up.pitch.toFixed(2)}°`);
  check('300 px up looks up ~32.6°', up.pitch > 30 && up.pitch < 35, `${up.pitch.toFixed(2)}°`);
  check('pitch clamps at +89°', computeLook(0, 0, 0, -100000).pitch === 89);
  check('pitch clamps at -89°', computeLook(0, 0, 0, 100000).pitch === -89);
  check('scoped look is slower', computeLook(0, 0, 0, -100, 1, true).pitch < computeLook(0, 0, 0, -100, 1, false).pitch);
}

console.log(failures ? `\n${failures} PHYSICS CHECK(S) FAILED` : '\nPHYSICS OK');
process.exit(failures ? 1 : 0);
