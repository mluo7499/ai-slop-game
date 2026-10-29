import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROFILE, sanitizeEquipped, sanitizeLoadout, publicProfile, applyXp } from '../shared/shop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'data');
const PROFILE_FILE = path.join(DATA_DIR, 'profiles.json');

function fresh(token, name) {
  return {
    token,
    name: (name || 'Recruit').slice(0, 16),
    ...structuredClone(DEFAULT_PROFILE),
    created: Date.now(),
    lastSeen: Date.now(),
  };
}

export class ProfileStore {
  constructor() {
    this.profiles = {};
    this.dirty = false;
    this.load();
    this.timer = setInterval(() => this.flush(), 4000);
    this.timer.unref?.();
  }

  load() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(PROFILE_FILE)) {
        this.profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      }
    } catch (err) {
      console.warn('[profiles] could not load:', err.message);
      this.profiles = {};
    }
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PROFILE_FILE, JSON.stringify(this.profiles));
    } catch (err) {
      console.warn('[profiles] could not save:', err.message);
    }
  }

  get(token, name) {
    if (!token || typeof token !== 'string' || token.length < 8) token = 'anon-' + Math.random().toString(36).slice(2, 12);
    let p = this.profiles[token];
    if (!p) {
      p = fresh(token, name);
      this.profiles[token] = p;
      this.dirty = true;
    }
    if (name && name !== p.name) {
      p.name = String(name).slice(0, 16);
      this.dirty = true;
    }
    p.lastSeen = Date.now();
    p.owned = Array.from(new Set([...(p.owned || []), ...DEFAULT_PROFILE.owned]));
    p.equipped = sanitizeEquipped(p.equipped, p.owned);
    p.loadout = sanitizeLoadout(p.loadout);
    return p;
  }

  view(token) {
    return publicProfile(this.get(token));
  }

  rename(token, name) {
    const p = this.get(token);
    p.name = String(name || 'Recruit').slice(0, 16) || 'Recruit';
    this.dirty = true;
    return p.name;
  }

  buy(token, kind, id) {
    const p = this.get(token);
    const key = `${kind}:${id}`;
    return { key, profile: p };
  }

  purchase(token, item) {
    const p = this.get(token);
    const key = `${item.kind}:${item.id}`;
    if (p.owned.includes(key)) return { ok: false, error: 'Already owned' };
    if (p.coins < item.price) return { ok: false, error: 'Not enough credits' };
    p.coins -= item.price;
    p.owned.push(key);
    this.dirty = true;
    return { ok: true, profile: publicProfile(p) };
  }

  equip(token, kind, id) {
    const p = this.get(token);
    const key = `${kind}:${id}`;
    if (!p.owned.includes(key)) return { ok: false, error: 'Not owned' };
    if (kind === 'finish') p.equipped.finishPrimary = id;
    else if (kind === 'body') p.equipped.body = id;
    else if (kind === 'tracer') p.equipped.tracer = id;
    p.equipped = sanitizeEquipped(p.equipped, p.owned);
    this.dirty = true;
    return { ok: true, profile: publicProfile(p) };
  }

  setLoadout(token, loadout) {
    const p = this.get(token);
    p.loadout = sanitizeLoadout(loadout);
    this.dirty = true;
    return p.loadout;
  }

  /** Award match rewards once. */
  reward(token, { coins = 0, xp = 0, kills = 0, deaths = 0, headshots = 0, win = false, seconds = 0 }) {
    const p = this.get(token);
    p.coins += Math.max(0, Math.min(3000, coins));
    p.kills += kills;
    p.deaths += deaths;
    p.headshots += headshots;
    p.matches += 1;
    p.playtime += seconds;
    if (win) p.wins += 1;
    const levels = applyXp(p, Math.max(0, Math.min(5000, xp)));
    this.dirty = true;
    return { profile: publicProfile(p), levels };
  }
}
