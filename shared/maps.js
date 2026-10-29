// Built-in maps. Pure data, shared by the server (collision) and client (rendering).
// y is the CENTER of a block; the floor top sits at y = 0.

const B = (x, y, z, w, h, d, m = 'concrete', extra = {}) => ({ x, y, z, w, h, d, m, ...extra });
const strip = (x, z, w, d, color = 'neonOrange') => B(x, 0.03, z, w, 0.06, d, color, { solid: false });

function boundary(halfX, halfZ, height, mat = 'concrete') {
  const t = 2;
  return [
    B(0, height / 2, -halfZ - t / 2, halfX * 2 + t * 2, height, t, mat),
    B(0, height / 2, halfZ + t / 2, halfX * 2 + t * 2, height, t, mat),
    B(-halfX - t / 2, height / 2, 0, t, height, halfZ * 2, mat),
    B(halfX + t / 2, height / 2, 0, t, height, halfZ * 2, mat),
  ];
}

function stairs(cx, cz, steps, rise, run, axis, sign, width, mat = 'metal') {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const h = rise * (i + 1);
    const off = run * (i + 0.5) * sign;
    out.push(B(
      axis === 'x' ? cx + off : cx,
      h / 2,
      axis === 'z' ? cz + off : cz,
      axis === 'x' ? run : width,
      h,
      axis === 'z' ? run : width,
      mat,
    ));
  }
  return out;
}

const crate = (x, z, size = 2.2, mat = 'crate', y = size / 2) => B(x, y, z, size, size, size, mat);

// ------------------------------------------------------------------ SLOPYARD
function slopyard() {
  const half = 38;
  const blocks = [B(0, -0.5, 0, half * 2, 1, half * 2, 'floor'), ...boundary(half, half, 8, 'concrete')];
  // central raised deck
  blocks.push(B(0, 0.8, 0, 18, 1.6, 12, 'metal'));
  blocks.push(B(0, 0.86, 0, 17, 0.02, 11, 'deck', { solid: false }));
  blocks.push(...stairs(-5, -10.875, 4, 0.4, 1.25, 'z', 1, 3.4));
  blocks.push(...stairs(5, -10.875, 4, 0.4, 1.25, 'z', 1, 3.4));
  blocks.push(...stairs(-5, 10.875, 4, 0.4, 1.25, 'z', -1, 3.4));
  blocks.push(...stairs(5, 10.875, 4, 0.4, 1.25, 'z', -1, 3.4));
  // deck railings
  blocks.push(B(-8.5, 2.05, 0, 0.4, 0.9, 11, 'hazard'));
  blocks.push(B(8.5, 2.05, 0, 0.4, 0.9, 11, 'hazard'));
  // sightline walls flanking mid
  blocks.push(B(-14, 1.4, -13, 1.2, 2.8, 16, 'concrete'));
  blocks.push(B(14, 1.4, -13, 1.2, 2.8, 16, 'concrete'));
  blocks.push(B(-14, 1.4, 13, 1.2, 2.8, 16, 'concrete'));
  blocks.push(B(14, 1.4, 13, 1.2, 2.8, 16, 'concrete'));
  // corner buildings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    blocks.push(B(25 * sx, 2.6, 25 * sz, 9, 5.2, 9, 'concrete'));
    blocks.push(B(25 * sx, 5.2, 25 * sz, 7, 0.18, 7, 'metal', { solid: false }));
    blocks.push(B(25 * sx, 5.45, 25 * sz, 3.4, 0.28, 3.4, 'neonCyan', { solid: false }));
  }
  // lane cover
  blocks.push(B(-25, 0.65, -8, 8, 1.3, 1, 'hazard'));
  blocks.push(B(25, 0.65, 8, 8, 1.3, 1, 'hazard'));
  blocks.push(B(-24, 0.65, 8, 7, 1.3, 1, 'hazard'));
  blocks.push(B(24, 0.65, -8, 7, 1.3, 1, 'hazard'));
  // crates
  [[-20, 0], [20, 0], [-10, -22], [10, 22], [0, -25], [0, 25], [-7, 22], [7, -22], [19, 15], [-19, -15]]
    .forEach(([x, z], i) => blocks.push(crate(x, z, i % 3 === 0 ? 2.8 : 2.2, 'crate')));
  blocks.push(crate(22, 0, 2.6, 'crateRed'));
  blocks.push(crate(-22, 0, 2.6, 'crateRed'));
  // decorative neon guides
  blocks.push(strip(0, -33, 16, 0.35, 'neonOrange'));
  blocks.push(strip(0, 33, 16, 0.35, 'neonCyan'));
  blocks.push(strip(-16, 0, 0.35, 20, 'neonCyan'));
  blocks.push(strip(16, 0, 0.35, 20, 'neonOrange'));
  blocks.push(B(-25, 5.9, 21, 0.3, 1.2, 8, 'neonOrange', { solid: false }));
  blocks.push(B(25, 5.9, -21, 0.3, 1.2, 8, 'neonCyan', { solid: false }));

  const spawns = [];
  for (let i = 0; i < 6; i++) {
    spawns.push({ x: -10 + i * 4, y: 0, z: 33, team: 0 });
    spawns.push({ x: -10 + i * 4, y: 0, z: -33, team: 1 });
  }
  return {
    id: 'slopyard', name: 'SLOPYARD', tagline: 'Neon freight terminal · balanced three-lane',
    halfX: half, halfZ: half, blocks, spawns,
    sites: [{ x: -18, z: -24, r: 5.5, label: 'A' }, { x: 18, z: 24, r: 5.5, label: 'B' }],
    hills: [{ x: 0, z: 0, r: 7, label: 'DECK' }, { x: -26, z: 12, r: 6, label: 'WEST' }, { x: 26, z: -12, r: 6, label: 'EAST' }],
    theme: {
      skyTop: '#1a2740', skyBottom: '#e0803f', fog: '#38435c', fogNear: 30, fogFar: 120,
      sun: [0.45, 0.35, 0.2], sunColor: '#ffd7a8', sunIntensity: 2.1, ambient: '#7d8ba8',
    },
  };
}

// -------------------------------------------------------------- NEON DISTRICT
function neonDistrict() {
  const half = 30;
  const blocks = [B(0, -0.5, 0, half * 2, 1, half * 2, 'floorDark'), ...boundary(half, half, 9, 'concrete')];
  // mid walls with a gap at the centre
  for (const sx of [-1, 1]) {
    blocks.push(B(7 * sx, 1.4, -13.5, 1, 2.8, 13, 'concrete'));
    blocks.push(B(7 * sx, 1.4, 13.5, 1, 2.8, 13, 'concrete'));
    blocks.push(B(7 * sx, 2.95, -13.5, 1.1, 0.3, 13, 'neonCyan', { solid: false }));
    blocks.push(B(7 * sx, 2.95, 13.5, 1.1, 0.3, 13, 'neonOrange', { solid: false }));
  }
  // sites
  for (const [sx, sz, label] of [[-1, -1, 'A'], [1, 1, 'B']]) {
    blocks.push(B(18 * sx, 0.3, 16 * sz, 11, 0.6, 11, 'deck'));
    blocks.push(B(18 * sx, 0.66, 14.5 * sz, 3, 0.12, 3, 'hazard', { solid: false }));
    blocks.push(B(18 * sx, 1.5, 20.5 * sz, 5, 2.4, 1.2, 'concrete'));
    blocks.push(crate(14 * sx, 18 * sz, 2.2, 'crate'));
    blocks.push(crate(21 * sx, 15 * sz, 2.2, 'crateRed'));
    blocks.push(B(18 * sx, 4.4, 16 * sz, 12, 0.3, 0.3, 'neonOrange', { solid: false }));
  }
  // far corner blocks
  blocks.push(B(22, 3.5, -22, 10, 7, 8, 'concrete'));
  blocks.push(B(-22, 3.5, 22, 10, 7, 8, 'concrete'));
  blocks.push(B(22, 7.1, -22, 8, 0.2, 6, 'metal', { solid: false }));
  // catwalk
  blocks.push(B(0, 3.1, 19, 12, 0.5, 6, 'metal'));
  blocks.push(...stairs(-9.5, 19, 8, 0.4, 0.9, 'x', 1, 3));
  blocks.push(B(0, 3.7, 21.9, 12, 0.9, 0.3, 'hazard'));
  blocks.push(B(0, 3.7, 16.1, 12, 0.9, 0.3, 'hazard'));
  // cover
  blocks.push(B(-16, 0.8, 0, 7, 1.6, 1.1, 'hazard'));
  blocks.push(B(16, 0.8, 0, 7, 1.6, 1.1, 'hazard'));
  blocks.push(B(0, 0.8, -22, 8, 1.6, 1.1, 'hazard'));
  blocks.push(B(-22, 2.0, -6, 1.2, 4, 8, 'concrete'));
  blocks.push(B(22, 2.0, 6, 1.2, 4, 8, 'concrete'));
  [[-12, 10], [12, -10], [-4, 24], [4, -24], [24, 0], [-24, 0]].forEach(([x, z], i) =>
    blocks.push(crate(x, z, i % 2 ? 2.4 : 2.9, i % 2 ? 'crate' : 'crateRed')));
  // neon signage (decorative)
  blocks.push(B(-29.4, 5.5, 0, 0.3, 3, 10, 'neonCyan', { solid: false }));
  blocks.push(B(29.4, 5.5, 0, 0.3, 3, 10, 'neonOrange', { solid: false }));
  blocks.push(B(0, 5.5, -29.4, 12, 3, 0.3, 'neonOrange', { solid: false }));
  blocks.push(B(0, 0.03, -3, 12, 0.06, 0.35, 'neonCyan', { solid: false }));
  blocks.push(B(0, 0.03, 3, 12, 0.06, 0.35, 'neonOrange', { solid: false }));

  const spawns = [];
  for (let i = 0; i < 7; i++) {
    spawns.push({ x: -12 + i * 4, y: 0, z: 26, team: 0 });
    spawns.push({ x: -12 + i * 4, y: 0, z: -26, team: 1 });
  }
  return {
    id: 'neondistrict', name: 'NEON DISTRICT', tagline: 'Rain-slick blocks · vertical mid control',
    halfX: half, halfZ: half, blocks, spawns,
    sites: [{ x: -18, z: -16, r: 5.5, label: 'A' }, { x: 18, z: 16, r: 5.5, label: 'B' }],
    hills: [{ x: 0, z: 0, r: 6.5, label: 'MID' }, { x: 0, z: 19, r: 5.5, label: 'CATWALK' }, { x: -18, z: 16, r: 5.5, label: 'B' }],
    theme: {
      skyTop: '#05060f', skyBottom: '#16214a', fog: '#0c1226', fogNear: 25, fogFar: 105,
      sun: [-0.3, 0.4, -0.2], sunColor: '#b9d5ff', sunIntensity: 1.2, ambient: '#3a4a78',
    },
  };
}

// ------------------------------------------------------------------ FROSTLINE
function frostline() {
  const halfX = 44, halfZ = 30;
  const blocks = [B(0, -0.5, 0, halfX * 2, 1, halfZ * 2, 'snow'), ...boundary(halfX, halfZ, 7, 'snowWall')];
  // central bunker, walkable roof reached from both sides
  blocks.push(B(0, 1.6, 0, 14, 3.2, 10, 'concrete'));
  blocks.push(B(0, 3.25, 0, 14.2, 0.12, 10.2, 'snow', { solid: false }));
  blocks.push(...stairs(-7.5, 7, 8, 0.4, 0.9, 'x', 1, 3.4));
  blocks.push(...stairs(7.5, -7, 8, 0.4, 0.9, 'x', -1, 3.4));
  blocks.push(B(-6, 3.6, 0, 2, 0.6, 9, 'hazard'));
  blocks.push(B(6, 3.6, 0, 2, 0.6, 9, 'hazard'));
  // sniper towers
  for (const [tx, tz] of [[-32, 22], [32, -22]]) {
    blocks.push(B(tx, 2.0, tz, 8, 4, 8, 'concrete'));
    blocks.push(B(tx, 4.15, tz, 8.4, 0.3, 8.4, 'metal'));
    blocks.push(B(tx, 4.8, tz - 3.6, 8.4, 0.9, 0.3, 'hazard'));
    blocks.push(B(tx, 4.8, tz + 3.6, 8.4, 0.9, 0.3, 'hazard'));
    blocks.push(...stairs(tx + (tx < 0 ? 5.6 : -5.6), tz, 8, 0.4, 0.85, 'z', tz > 0 ? -1 : 1, 3.0));
  }
  // rock cover (snow-capped)
  const rocks = [[-20, 8, 4.5, 2.2], [-20, -8, 4.5, 2.2], [20, 8, 4.5, 2.2], [20, -8, 4.5, 2.2],
    [-12, 18, 3.4, 1.8], [12, -18, 3.4, 1.8], [0, 22, 6, 1.6], [0, -22, 6, 1.6],
    [-36, 0, 3, 2.4], [36, 0, 3, 2.4], [-34, 12, 4, 2.6], [34, -12, 4, 2.6]];
  for (const [x, z, w, h] of rocks) {
    blocks.push(B(x, h / 2, z, w, h, w * 0.8, 'rock'));
    blocks.push(B(x, h + 0.06, z, w * 0.9, 0.12, w * 0.72, 'snow', { solid: false }));
  }
  // long lane walls
  blocks.push(B(-14, 0.7, 0, 1.1, 1.4, 16, 'hazard'));
  blocks.push(B(14, 0.7, 0, 1.1, 1.4, 16, 'hazard'));
  blocks.push(B(0, 0.7, 17, 10, 1.4, 1.1, 'hazard'));
  blocks.push(B(0, 0.7, -17, 10, 1.4, 1.1, 'hazard'));
  blocks.push(B(-25, 0.03, 0, 0.4, 0.06, 24, 'neonCyan', { solid: false }));
  blocks.push(B(25, 0.03, 0, 0.4, 0.06, 24, 'neonOrange', { solid: false }));

  const spawns = [];
  for (let i = 0; i < 7; i++) {
    spawns.push({ x: 38, y: 0, z: -12 + i * 4, team: 0 });
    spawns.push({ x: -38, y: 0, z: -12 + i * 4, team: 1 });
  }
  return {
    id: 'frostline', name: 'FROSTLINE', tagline: 'High-altitude relay · long-range duels',
    halfX, halfZ, blocks, spawns,
    sites: [{ x: -28, z: -22, r: 6, label: 'A' }, { x: 28, z: 22, r: 6, label: 'B' }],
    hills: [{ x: 0, z: 0, r: 7, label: 'BUNKER' }, { x: 0, z: -22, r: 5.5, label: 'SNOWLINE' }, { x: 0, z: 22, r: 5.5, label: 'RELAY' }],
    theme: {
      skyTop: '#8fb6d9', skyBottom: '#dfeaf2', fog: '#c8dbe8', fogNear: 45, fogFar: 160,
      sun: [0.5, 0.7, 0.25], sunColor: '#fff3dc', sunIntensity: 2.6, ambient: '#cfe0ee',
    },
  };
}

// ------------------------------------------------------------------ CARGOHOLD
function cargohold() {
  const half = 26;
  const blocks = [B(0, -0.5, 0, half * 2, 1, half * 2, 'floorDark'), ...boundary(half, half, 8, 'metal')];
  const container = (x, z, w, d, h = 2.8, y = 1.4, mat = 'containerA') => B(x, y, z, w, h, d, mat);
  // long containers create a tight, angled maze
  blocks.push(container(-14, -8, 3.2, 12, 2.8, 1.4, 'containerA'));
  blocks.push(container(14, 8, 3.2, 12, 2.8, 1.4, 'containerB'));
  blocks.push(container(-8, 14, 12, 3.2, 2.8, 1.4, 'containerB'));
  blocks.push(container(8, -14, 12, 3.2, 2.8, 1.4, 'containerA'));
  blocks.push(container(-14, -8, 3.2, 12, 2.8, 4.2, 'containerB')); // stacked
  blocks.push(container(14, 8, 3.2, 12, 2.8, 4.2, 'containerA'));
  // centre stack
  blocks.push(container(0, 0, 6, 3.2, 2.8, 1.4, 'containerRed'));
  blocks.push(container(0, 0, 6, 3.2, 2.8, 4.2, 'containerGreen'));
  blocks.push(...stairs(-5.6, 0, 3, 0.4, 1.0, 'x', -1, 3.0));
  blocks.push(container(-18, 18, 8, 3.2, 2.8, 1.4, 'containerGreen'));
  blocks.push(container(18, -18, 8, 3.2, 2.8, 1.4, 'containerRed'));
  blocks.push(container(-18, 18, 8, 3.2, 2.8, 4.2, 'containerA'));
  blocks.push(container(18, -18, 8, 3.2, 2.8, 4.2, 'containerB'));
  // ground cover
  [[-6, -20], [6, 20], [20, 2], [-20, -2], [-2, 20], [2, -20], [8, 0], [-8, 0]].forEach(([x, z], i) =>
    blocks.push(crate(x, z, i % 2 ? 2.0 : 2.6, i % 2 ? 'crate' : 'crateRed')));
  // hazard markings + lights
  blocks.push(B(0, 0.03, 0, 36, 0.06, 0.35, 'hazard', { solid: false }));
  blocks.push(B(0, 0.03, 0, 0.35, 0.06, 36, 'hazard', { solid: false }));
  for (const [x, z] of [[-22, -22], [22, 22], [-22, 22], [22, -22]]) {
    blocks.push(B(x, 3.2, z, 0.45, 6.4, 0.45, 'metal'));
    blocks.push(B(x, 6.5, z, 1.4, 0.4, 1.4, 'neonCyan', { solid: false }));
  }
  const spawns = [];
  for (let i = 0; i < 6; i++) {
    spawns.push({ x: -10 + i * 4, y: 0, z: 23, team: 0 });
    spawns.push({ x: -10 + i * 4, y: 0, z: -23, team: 1 });
  }
  return {
    id: 'cargohold', name: 'CARGOHOLD', tagline: 'Stacked steel · close-quarters chaos',
    halfX: half, halfZ: half, blocks, spawns,
    sites: [{ x: -16, z: -16, r: 5.5, label: 'A' }, { x: 16, z: 16, r: 5.5, label: 'B' }],
    hills: [{ x: 0, z: 0, r: 6, label: 'CENTER' }, { x: -18, z: 18, r: 5.5, label: 'A' }, { x: 18, z: -18, r: 5.5, label: 'B' }],
    theme: {
      skyTop: '#101822', skyBottom: '#3f5260', fog: '#2b3a46', fogNear: 24, fogFar: 95,
      sun: [0.35, 0.55, 0.1], sunColor: '#eaf2ff', sunIntensity: 1.7, ambient: '#8ba0af',
    },
  };
}

export const BUILTIN_MAPS = [slopyard(), neonDistrict(), frostline(), cargohold()];
export const MAP_BY_ID = Object.fromEntries(BUILTIN_MAPS.map((m) => [m.id, m]));

export function getMap(id) {
  return MAP_BY_ID[id] || BUILTIN_MAPS[0];
}

export function mapSummary(map) {
  return {
    id: map.id, name: map.name, tagline: map.tagline,
    halfX: map.halfX, halfZ: map.halfZ, theme: map.theme,
    custom: !!map.custom,
  };
}

/** Sanitise maps received from the editor before they touch the server. */
export function sanitizeMap(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid map');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const blocks = Array.isArray(raw.blocks) ? raw.blocks.slice(0, 1400).map((b) => ({
    x: clamp(b.x, -120, 120), y: clamp(b.y, -20, 80), z: clamp(b.z, -120, 120),
    w: clamp(b.w, 0.2, 40), h: clamp(b.h, 0.2, 40), d: clamp(b.d, 0.2, 40),
    m: typeof b.m === 'string' ? b.m.slice(0, 20) : 'concrete',
    solid: b.solid !== false,
  })) : [];
  if (!blocks.length) throw new Error('Map has no blocks');
  const spawns = (Array.isArray(raw.spawns) ? raw.spawns : []).slice(0, 32).map((s) => ({
    x: clamp(s.x, -120, 120), y: clamp(s.y, 0, 80), z: clamp(s.z, -120, 120),
    team: s.team === 1 ? 1 : 0,
  }));
  const sites = (Array.isArray(raw.sites) ? raw.sites : []).slice(0, 4).map((s, i) => ({
    x: clamp(s.x, -120, 120), z: clamp(s.z, -120, 120), r: clamp(s.r, 2, 20), label: String.fromCharCode(65 + i),
  }));
  const hills = (Array.isArray(raw.hills) ? raw.hills : []).slice(0, 4).map((h, i) => ({
    x: clamp(h.x, -120, 120), z: clamp(h.z, -120, 120), r: clamp(h.r, 2, 20),
    label: ['HILL', 'WEST', 'EAST', 'SOUTH'][i % 4],
  }));
  const name = String(raw.name || 'CUSTOM MAP').slice(0, 28).toUpperCase();
  const boundary = Math.max(-120, Math.min(120, Number(raw.halfX) || 30));
  const boundaryZ = Math.max(-120, Math.min(120, Number(raw.halfZ) || boundary));
  return {
    id: raw.id && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : undefined,
    name, tagline: String(raw.tagline || 'Player-built arena').slice(0, 90),
    custom: true, halfX: boundary, halfZ: boundaryZ, blocks, spawns, sites, hills,
    theme: {
      skyTop: '#0a0f1a', skyBottom: '#1d2b42', fog: '#131b2a', fogNear: 25, fogFar: 110,
      sun: [0.4, 0.6, 0.2], sunColor: '#dce9ff', sunIntensity: 1.8, ambient: '#7d90ab',
    },
  };
}
