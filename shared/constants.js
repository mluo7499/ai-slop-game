// Shared gameplay constants. Imported by the Node server AND the browser client so
// that movement, weapons and scoring are simulated with identical numbers.

export const TICK_HZ = 60;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 60;
export const INTERP_MS = 90;
export const MAX_ROOM_PLAYERS = 16;

export const TEAM = { A: 0, B: 1, SPEC: 2, FFA: -1 };
export const TEAM_INFO = [
  { id: 0, name: 'Vanguard', short: 'ATK', color: 0xff5a3c, css: '#ff6b4a', spawn: 'a' },
  { id: 1, name: 'Sentinel', short: 'DEF', color: 0x3fa9ff, css: '#4aa8ff', spawn: 'b' },
];

export const PHYS = {
  gravity: 20.0,
  maxSpeed: 6.5,
  walkSpeed: 2.7,
  crouchSpeed: 2.5,
  accel: 62,
  airAccel: 14,
  friction: 9.2,
  jumpVel: 6.5,
  stepHeight: 0.42,
  radius: 0.34,
  height: 1.82,
  crouchHeight: 1.24,
  eye: 1.64,
  crouchEye: 1.06,
  maxFall: 45,
  jumpCooldown: 0.28,
};

export const ECONOMY = {
  start: 800,
  max: 16000,
  killBonusDefault: 300,
  winRound: 3250,
  loseRound: 1400,
  loseStreakStep: 500,
  maxLoseStreak: 4,
  plantReward: 300,
  defuseReward: 300,
  teamKillPenalty: -300,
};

// buttons bitmask sent with every input frame
export const BTN = {
  FORWARD: 1, BACK: 2, LEFT: 4, RIGHT: 8,
  JUMP: 16, CROUCH: 32, WALK: 64, FIRE: 128,
  RELOAD: 256, USE: 512, SCORE: 1024, INSPECT: 2048,
};

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'TRENCH KNIFE', short: 'KNIFE', slot: 3, price: 0,
    damage: 52, rpm: 90, mag: 0, reserve: 0, reload: 0, spread: 0, recoil: 0,
    range: 2.4, headMult: 3.2, armorPen: 1, speedMult: 1.06, killReward: 1500,
    falloff: 1, automatic: false, sound: 'knife',
  },
  p9: {
    id: 'p9', name: 'P9 SIDEARM', short: 'P9', slot: 2, price: 0,
    damage: 27, rpm: 430, mag: 15, reserve: 60, reload: 1.7, spread: 0.55,
    recoil: 0.75, range: 55, headMult: 4, armorPen: 0.55, speedMult: 1.0,
    killReward: 300, falloff: 0.86, automatic: false, sound: 'pistol',
  },
  deagle: {
    id: 'deagle', name: 'D-50 HAND CANNON', short: 'D-50', slot: 2, price: 700,
    damage: 58, rpm: 240, mag: 7, reserve: 35, reload: 2.2, spread: 0.8,
    recoil: 2.6, range: 70, headMult: 4, armorPen: 0.9, speedMult: 0.97,
    killReward: 300, falloff: 0.9, automatic: false, sound: 'deagle',
  },
  mp9: {
    id: 'mp9', name: 'SP-9 RAPID', short: 'SP-9', slot: 1, price: 1250,
    damage: 23, rpm: 900, mag: 30, reserve: 90, reload: 2.0, spread: 0.95,
    recoil: 0.62, range: 40, headMult: 3.6, armorPen: 0.5, speedMult: 1.03,
    killReward: 600, falloff: 0.8, automatic: true, sound: 'smg',
  },
  ak: {
    id: 'ak', name: 'VK-47 RIFLE', short: 'VK-47', slot: 1, price: 2700,
    damage: 34, rpm: 600, mag: 30, reserve: 90, reload: 2.4, spread: 0.34,
    recoil: 1.55, range: 90, headMult: 4, armorPen: 0.78, speedMult: 0.94,
    killReward: 300, falloff: 0.94, automatic: true, sound: 'rifle',
  },
  m4: {
    id: 'm4', name: 'M4-S WARDEN', short: 'M4-S', slot: 1, price: 3100,
    damage: 30, rpm: 680, mag: 30, reserve: 90, reload: 2.2, spread: 0.27,
    recoil: 1.05, range: 95, headMult: 4, armorPen: 0.7, speedMult: 0.96,
    killReward: 300, falloff: 0.95, automatic: true, sound: 'rifle2',
  },
  awp: {
    id: 'awp', name: 'LR-50 LONGSHOT', short: 'LR-50', slot: 1, price: 4750,
    damage: 118, rpm: 41, mag: 5, reserve: 25, reload: 3.4, spread: 0.12,
    recoil: 4.2, range: 160, headMult: 2.4, armorPen: 1, speedMult: 0.78,
    killReward: 100, falloff: 1, automatic: false, sound: 'sniper', scope: 2.6,
  },
  breacher: {
    id: 'breacher', name: 'BR-12 BREACHER', short: 'BR-12', slot: 1, price: 1200,
    damage: 13, pellets: 8, rpm: 78, mag: 6, reserve: 24, reload: 2.8,
    spread: 3.4, recoil: 3.0, range: 28, headMult: 2.6, armorPen: 0.45,
    speedMult: 0.92, killReward: 900, falloff: 0.6, automatic: false, sound: 'shotgun',
  },
  he: {
    id: 'he', name: 'FRAG GRENADE', short: 'FRAG', slot: 4, price: 300,
    damage: 105, rpm: 40, mag: 1, reserve: 1, reload: 0, spread: 0, recoil: 0,
    range: 9, headMult: 1, armorPen: 0.5, speedMult: 1, killReward: 300,
    falloff: 1, automatic: false, sound: 'throw', radius: 8.5, fuse: 2.0,
  },
};

export const PRIMARY_ORDER = ['ak', 'm4', 'awp', 'mp9', 'breacher'];
export const SECONDARY_ORDER = ['p9', 'deagle'];
export const BUY_ITEMS = [
  { kind: 'weapon', id: 'ak', price: 2700, label: 'VK-47 RIFLE' },
  { kind: 'weapon', id: 'm4', price: 3100, label: 'M4-S WARDEN' },
  { kind: 'weapon', id: 'awp', price: 4750, label: 'LR-50 LONGSHOT' },
  { kind: 'weapon', id: 'mp9', price: 1250, label: 'SP-9 RAPID' },
  { kind: 'weapon', id: 'breacher', price: 1200, label: 'BR-12 BREACHER' },
  { kind: 'weapon', id: 'deagle', price: 700, label: 'D-50 HAND CANNON' },
  { kind: 'weapon', id: 'p9', price: 0, label: 'P9 SIDEARM' },
  { kind: 'armor', id: 'kevlar', price: 650, label: 'KEVLAR VEST' },
  { kind: 'armor', id: 'helmet', price: 1000, label: 'KEVLAR + HELMET' },
  { kind: 'util', id: 'he', price: 300, label: 'FRAG GRENADE' },
];

export const MODE_DEFS = {
  tdm: {
    id: 'tdm', name: 'TEAM DEATHMATCH', short: 'TDM', teamBased: true,
    respawn: true, scoreLimit: 75, timeLimit: 900, respawnDelay: 3.2, warmup: 5,
    desc: 'Two squads, one scoreline. First team to 75 frags takes it.',
    buyTime: 999, icon: '◈',
  },
  ffa: {
    id: 'ffa', name: 'FREE FOR ALL', short: 'FFA', teamBased: false,
    respawn: true, scoreLimit: 35, timeLimit: 720, respawnDelay: 2.6, warmup: 5,
    desc: 'No allies. No mercy. First to 35 kills wins.',
    buyTime: 999, icon: '✳',
  },
  bomb: {
    id: 'bomb', name: 'BOMB DEFUSAL', short: 'BOMB', teamBased: true,
    respawn: false, scoreLimit: 8, roundTime: 115, freezeTime: 7, warmup: 4,
    plantTime: 3.2, bombTime: 40, defuseTime: 7, halftimeAt: 4,
    desc: 'Plant the spike or stop the plant. First to 8 rounds, roles swap at half.',
    buyTime: 12, icon: '◉', roundBased: true,
  },
  gungame: {
    id: 'gungame', name: 'GUN GAME', short: 'GUN', teamBased: false,
    respawn: true, scoreLimit: 11, timeLimit: 900, respawnDelay: 1.6, warmup: 4,
    desc: 'Every frag upgrades your gun. Finish the ladder with a knife kill to win.',
    buyTime: 0, icon: '⬆',
  },
  koth: {
    id: 'koth', name: 'KING OF THE HILL', short: 'KOTH', teamBased: true,
    respawn: true, scoreLimit: 250, timeLimit: 720, respawnDelay: 3.0, warmup: 5,
    hillRadius: 7.5, hillScorePerSec: 5, hillRotateTime: 45, hillCount: 3,
    desc: 'Hold the zone to bleed the enemy score. The hill relocates every 45s.',
    buyTime: 999, icon: '▲',
  },
};

export const DEFAULT_SETTINGS = {
  scoreLimit: 0,
  timeLimit: 0,
  respawnDelay: 0,
  speedScale: 1,
  gravityScale: 1,
  jumpScale: 1,
  damageScale: 1,
  health: 100,
  armorStart: 0,
  headshotsOnly: false,
  friendlyFire: false,
  infiniteAmmo: false,
  infiniteGrenades: false,
  maxBots: 4,
  botDifficulty: 'normal',
};

export const CUSTOM_RULES = [
  { key: 'headshotsOnly', label: 'HEADSHOTS ONLY', type: 'bool' },
  { key: 'friendlyFire', label: 'FRIENDLY FIRE', type: 'bool' },
  { key: 'infiniteAmmo', label: 'INFINITE AMMO', type: 'bool' },
  { key: 'infiniteGrenades', label: 'INFINITE GRENADES', type: 'bool' },
  { key: 'speedScale', label: 'MOVE SPEED', type: 'range', min: 0.5, max: 2, step: 0.05 },
  { key: 'gravityScale', label: 'GRAVITY', type: 'range', min: 0.2, max: 2, step: 0.05 },
  { key: 'jumpScale', label: 'JUMP POWER', type: 'range', min: 0.4, max: 2.2, step: 0.05 },
  { key: 'damageScale', label: 'DAMAGE SCALE', type: 'range', min: 0.2, max: 3, step: 0.05 },
  { key: 'health', label: 'MAX HEALTH', type: 'range', min: 25, max: 300, step: 5 },
  { key: 'armorStart', label: 'START ARMOR', type: 'range', min: 0, max: 100, step: 5 },
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function eyeHeight(crouchAmount) {
  return PHYS.eye + (PHYS.crouchEye - PHYS.eye) * crouchAmount;
}

export function playerHeight(crouchAmount) {
  return PHYS.height + (PHYS.crouchHeight - PHYS.height) * crouchAmount;
}

/** Deterministic spray pattern shared by client (visual kick) and server (bullet path). */
export function recoilOffset(weapon, shotIndex) {
  if (!weapon.recoil) return [0, 0];
  const i = Math.min(shotIndex, 24);
  const climb = Math.min(i, 9) * weapon.recoil * 0.55;
  const drift = Math.sin(i * 0.55) * weapon.recoil * 0.62 * Math.min(i / 6, 1);
  const wobble = Math.cos(i * 1.7) * weapon.recoil * 0.16;
  return [drift + wobble, climb];
}

export function spreadFor(weapon, player) {
  let spread = weapon.spread;
  if (player.onGround === false) spread *= 3.4;
  const speed = Math.hypot(player.vel[0], player.vel[2]);
  if (speed > PHYS.walkSpeed) spread *= 1 + (speed - PHYS.walkSpeed) * 0.55;
  if (player.crouchAmount > 0.5) spread *= 0.72;
  if (player.scoped) spread *= 0.35;
  return spread;
}

export const DEG = Math.PI / 180;
