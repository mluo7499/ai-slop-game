// Cosmetic catalog + account progression. Shared so the client can render the shop
// and the server can validate purchases.

export const RARITY = {
  common: { name: 'STANDARD', css: '#9aa7b5', order: 0 },
  rare: { name: 'RARE', css: '#3fa9ff', order: 1 },
  epic: { name: 'EPIC', css: '#b46bff', order: 2 },
  legendary: { name: 'LEGENDARY', css: '#ffb347', order: 3 },
};

export const FINISHES = [
  { id: 'stock', name: 'STOCK', price: 0, rarity: 'common', a: '#7f8791', b: '#4b525b', pattern: 'solid', metalness: 0.35, roughness: 0.65 },
  { id: 'carbon', name: 'CARBON WEAVE', price: 300, rarity: 'common', a: '#2b3138', b: '#12161b', pattern: 'weave', metalness: 0.55, roughness: 0.5 },
  { id: 'hazard', name: 'HAZARD TAPE', price: 450, rarity: 'common', a: '#e8c53a', b: '#1b1b1b', pattern: 'stripe', metalness: 0.25, roughness: 0.6 },
  { id: 'neondusk', name: 'NEON DUSK', price: 750, rarity: 'rare', a: '#ff4f9a', b: '#5b5bff', pattern: 'gradient', metalness: 0.5, roughness: 0.35 },
  { id: 'glacier', name: 'GLACIER', price: 750, rarity: 'rare', a: '#cfefff', b: '#2b6a8f', pattern: 'camo', metalness: 0.45, roughness: 0.42 },
  { id: 'bloodrust', name: 'BLOOD RUST', price: 950, rarity: 'rare', a: '#8f2e1f', b: '#3a1a14', pattern: 'camo', metalness: 0.3, roughness: 0.78 },
  { id: 'voidsignal', name: 'VOID SIGNAL', price: 1500, rarity: 'epic', a: '#7a3cff', b: '#0b0618', pattern: 'hex', metalness: 0.65, roughness: 0.3 },
  { id: 'solarflare', name: 'SOLAR FLARE', price: 1500, rarity: 'epic', a: '#ffb03a', b: '#7a1f0b', pattern: 'gradient', metalness: 0.6, roughness: 0.34 },
  { id: 'chromeprism', name: 'CHROME PRISM', price: 2400, rarity: 'legendary', a: '#e9f7ff', b: '#6d8cff', pattern: 'hex', metalness: 0.95, roughness: 0.14 },
  { id: 'slopcore', name: 'SLOPCORE', price: 2600, rarity: 'legendary', a: '#a3ff3a', b: '#0d2a00', pattern: 'weave', metalness: 0.4, roughness: 0.45, glow: '#a3ff3a' },
];

export const BODY_SKINS = [
  { id: 'stock', name: 'FIELD STANDARD', price: 0, rarity: 'common', body: '#4b5563', legs: '#2f3743', accent: '#8a96a5' },
  { id: 'blackout', name: 'BLACKOUT', price: 350, rarity: 'common', body: '#171b21', legs: '#0d1014', accent: '#3a4450' },
  { id: 'ghost', name: 'DESERT GHOST', price: 600, rarity: 'rare', body: '#b7a582', legs: '#7d6f52', accent: '#e3d6b4' },
  { id: 'ronin', name: 'NEON RONIN', price: 950, rarity: 'rare', body: '#1c2434', legs: '#121724', accent: '#ff3d81' },
  { id: 'gilded', name: 'GILDED', price: 2100, rarity: 'legendary', body: '#3a2f14', legs: '#241c0b', accent: '#ffc84a' },
];

export const TRACERS = [
  { id: 'white', name: 'STANDARD', price: 0, rarity: 'common', color: '#ffe6b0' },
  { id: 'cyan', name: 'ION', price: 250, rarity: 'common', color: '#59f2ff' },
  { id: 'magenta', name: 'PLASMA', price: 250, rarity: 'common', color: '#ff5cf0' },
  { id: 'toxic', name: 'TOXIC', price: 400, rarity: 'rare', color: '#9dff3a' },
  { id: 'rainbow', name: 'SPECTRUM', price: 900, rarity: 'epic', color: '#ffffff', rainbow: true },
];

export const CATALOG = [
  ...FINISHES.map((f) => ({ ...f, kind: 'finish' })),
  ...BODY_SKINS.map((b) => ({ ...b, kind: 'body' })),
  ...TRACERS.map((t) => ({ ...t, kind: 'tracer' })),
];

export const ITEM_BY_ID = Object.fromEntries(CATALOG.map((i) => [`${i.kind}:${i.id}`, i]));

export const DEFAULT_LOADOUT = {
  primary: 'ak',
  secondary: 'p9',
};

export const DEFAULT_PROFILE = {
  name: 'Recruit',
  coins: 900,
  xp: 0,
  level: 1,
  kills: 0,
  deaths: 0,
  headshots: 0,
  wins: 0,
  matches: 0,
  playtime: 0,
  owned: ['finish:stock', 'body:stock', 'tracer:white', 'finish:carbon'],
  equipped: {
    finishPrimary: 'stock',
    finishSecondary: 'carbon',
    finishKnife: 'stock',
    body: 'stock',
    tracer: 'white',
  },
  loadout: { ...DEFAULT_LOADOUT },
};

export function xpForLevel(level) {
  return Math.round(120 * Math.pow(level, 1.35));
}

export function levelFromXp(xp) {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level) && level < 200) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, into: remaining, need: xpForLevel(level) };
}

export function applyXp(profile, amount) {
  const before = levelFromXp(profile.xp).level;
  profile.xp += amount;
  const after = levelFromXp(profile.xp);
  profile.level = after.level;
  return after.level - before;
}

export function sanitizeLoadout(raw) {
  const ok = (id, list) => list.some((w) => w === id);
  return {
    primary: ok(raw?.primary, ['ak', 'm4', 'awp', 'mp9', 'breacher']) ? raw.primary : 'ak',
    secondary: ok(raw?.secondary, ['p9', 'deagle']) ? raw.secondary : 'p9',
  };
}

export function sanitizeEquipped(raw, owned) {
  const has = (key) => owned.includes(key);
  const pick = (value, kind, fallback) => (has(`${kind}:${value}`) ? value : fallback);
  return {
    finishPrimary: pick(raw?.finishPrimary, 'finish', 'stock'),
    finishSecondary: pick(raw?.finishSecondary, 'finish', 'stock'),
    finishKnife: pick(raw?.finishKnife, 'finish', 'stock'),
    body: pick(raw?.body, 'body', 'stock'),
    tracer: pick(raw?.tracer, 'tracer', 'white'),
  };
}

export function publicProfile(p) {
  return {
    name: p.name, coins: p.coins, xp: p.xp, level: p.level,
    kills: p.kills, deaths: p.deaths, headshots: p.headshots,
    wins: p.wins, matches: p.matches, playtime: p.playtime,
    owned: p.owned, equipped: p.equipped, loadout: p.loadout,
  };
}
