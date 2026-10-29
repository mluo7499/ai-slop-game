// App controller: menus, server browser, shop, loadout, match flow.
import {
  WEAPONS, MODE_DEFS, CUSTOM_RULES, PRIMARY_ORDER, SECONDARY_ORDER, BUY_ITEMS,
  clamp,
} from '/shared/constants.js';
import {
  CATALOG, FINISHES, BODY_SKINS, TRACERS, RARITY, levelFromXp,
} from '/shared/shop.js';
import { BUILTIN_MAPS } from '/shared/maps.js';
import { Net } from './net.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { AudioEngine } from './audio.js';
import { MapEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const DEFAULT_PREFS = {
  name: 'Recruit', sensitivity: 1, fov: 78, quality: 'high',
  upscale: 'quality', dynamicRes: true, volume: 0.65,
  crosshair: '#3aff9e', shadows: true, radar: true,
};

const loadPrefs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('slopstrike.prefs') || '{}');
    return { ...DEFAULT_PREFS, ...raw };
  } catch { return { ...DEFAULT_PREFS }; }
};

const settings = loadPrefs();
let profile = null;
let rooms = [];
let maps = [];
let customMaps = [];
let uiBlocking = false;
let wasLocked = false;
let currentTab = 'play';
let shopCategory = 'finish';
let pendingMapSetup = null;

const audio = new AudioEngine();
audio.setVolume(settings.volume ?? 0.65);

const net = new Net();
net.setSettings(settings);

const hud = new Hud({
  buy: (item) => { net.buy(item); audio.ui(true); },
  onBuyToggle: (open) => {
    uiBlocking = open;
    game.lockAllowed = !open;
    if (open) { game.releaseLock(); hud.toggleScoreboard(false); }
    else if (game.active) game.requestLock();
  },
  onChatOpen: (open) => {
    uiBlocking = open;
    game.lockAllowed = !open;
    if (open) game.releaseLock();
    else if (game.active) game.requestLock();
  },
  crosshairColor: () => settings.crosshair,
  showRadar: () => settings.radar !== false,
  winSound: () => audio.win(),
  loseSound: () => audio.lose(),
  levelSound: () => audio.levelUp(),
});

const game = new Game({
  canvas: $('viewport'), net, audio, settings, hud,
});
hud.mount(net, game, profile);
game.hooks = {
  onPointerLock: (locked) => {
    if (locked) { wasLocked = true; hud.togglePause(false); if (game.active) uiBlocking = false; return; }
    if (!game.active) return;
    if (uiBlocking) return;
    if (game.matchEnded) return;
    if (!wasLocked) return;
    hud.togglePause(true);
    game.firing = false;
  },
  onKey: (code) => handleGameKey(code),
};

// ---------------------------------------------------------------- UI helpers
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 3400);
}

function setConn(text, ok = true) {
  hud.setConnection(text);
  const dot = document.querySelector('.rail-note .dot');
  dot?.classList.toggle('off', !ok);
}

function switchScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  if (name === 'game') game.resize();
  if (name === 'menu') game.releaseLock();
}

function switchTab(tab, sub) {
  currentTab = tab;
  $$('.railbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  if (sub) switchSub(tab, sub);
  if (tab === 'shop') renderShop();
  if (tab === 'loadout') renderLoadout();
  if (tab === 'maps') renderMaps();
}

function switchSub(tab, sub) {
  const panel = document.querySelector(`[data-panel="${tab}"]`);
  if (!panel) return;
  panel.querySelectorAll('.subbtn[data-sub]').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
  panel.querySelectorAll('.subpanel').forEach((p) => p.classList.toggle('active', p.dataset.subpanel === sub));
}

function savePrefs() {
  localStorage.setItem('slopstrike.prefs', JSON.stringify(settings));
}

function applyName(name) {
  settings.name = name;
  savePrefs();
  net.rename(name);
}

// --------------------------------------------------------------------- boot
async function boot() {
  fillStaticUI();
  try {
    profile = await net.connect();
    setConn('ONLINE · AUTHORITATIVE SERVER');
    onProfile({ profile });
    net.refreshRooms();
    switchTab('play', 'quick');
  } catch (err) {
    setConn('OFFLINE — IS THE SERVER RUNNING?', false);
    toast(err.message || 'Could not connect to server', 'bad');
  }
  setTimeout(() => $('boot').classList.add('done'), 450);
}

function fillStaticUI() {
  const modeGrid = $('mode-grid');
  const heroModes = $('hero-modes');
  const modeSelect = $('cr-mode');
  modeSelect.innerHTML = '';
  const icons = { tdm: '◈', ffa: '✳', bomb: '◉', gungame: '⬆', koth: '▲' };
  const iconClass = { tdm: '', ffa: 'green', bomb: 'pink', gungame: 'gold', koth: 'cyan' };
  Object.values(MODE_DEFS).forEach((mode) => {
    const card = document.createElement('button');
    card.className = 'mode-card';
    card.dataset.mode = mode.id;
    card.innerHTML = `
      <span class="mc-icon ${iconClass[mode.id] || ''}">${icons[mode.id] || '◈'}</span>
      <b>${mode.name}</b>
      <p>${mode.desc}</p>
      <span class="mc-meta">${mode.teamBased ? 'TEAM' : 'SOLO'} · ${mode.respawn ? 'RESPAWN' : 'ROUNDS'}</span>
      <i class="mc-play">QUICKPLAY →</i>`;
    card.addEventListener('click', () => playMode(mode.id));
    modeGrid.appendChild(card);
    const chip = document.createElement('span');
    chip.textContent = mode.name;
    heroModes.appendChild(chip);
    const opt = document.createElement('option');
    opt.value = mode.id;
    opt.textContent = mode.name;
    modeSelect.appendChild(opt);
  });
  modeSelect.value = 'tdm';

  // create-room core rules
  const rules = $('cr-rules');
  rules.innerHTML = '';
  const addNumber = (key, label, value, min, max, step) => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `<span>${label}</span><input type="number" data-rule="${key}" value="${value}" min="${min}" max="${max}" step="${step}" />`;
    rules.appendChild(row);
  };
  addNumber('scoreLimit', 'SCORE LIMIT (0 = DEFAULT)', 0, 0, 500, 1);
  addNumber('timeLimit', 'TIME LIMIT SEC (0 = DEFAULT)', 0, 0, 3600, 30);
  addNumber('health', 'MAX HEALTH', 100, 25, 300, 5);
  addNumber('armorStart', 'STARTING ARMOR', 0, 0, 100, 5);
  for (const rule of CUSTOM_RULES) {
    if (rule.type === 'range') {
      const row = document.createElement('div');
      row.className = 'rule-row';
      const def = rule.key === 'health' || rule.key === 'armorStart' ? null : null;
      row.innerHTML = `<span>${rule.label}</span><span><input type="range" data-rule="${rule.key}" min="${rule.min}" max="${rule.max}" step="${rule.step}" value="${rule.key === 'health' ? 100 : rule.key === 'armorStart' ? 0 : rule.key === 'damageScale' ? 1 : 1}" /><b data-rule-val="${rule.key}">1.00</b></span>`;
      rules.appendChild(row);
      const input = row.querySelector('input');
      const out = row.querySelector(`[data-rule-val="${rule.key}"]`);
      const sync = () => { out.textContent = Number(input.value).toFixed(rule.step < 1 ? 2 : 0); };
      input.addEventListener('input', sync);
      sync();
    } else {
      const row = document.createElement('div');
      row.className = 'rule-row';
      row.innerHTML = `<span>${rule.label}</span><input type="checkbox" data-rule="${rule.key}" />`;
      rules.appendChild(row);
    }
  }

  $('cr-bots').addEventListener('input', (e) => { $('cr-bots-v').textContent = e.target.value; });
  $('cr-max').addEventListener('input', (e) => { $('cr-max-v').textContent = e.target.value; });

  // settings
  const bindRange = (id, key, fmt = (v) => v) => {
    const el = $(id);
    const out = $(`${id}-v`);
    if (!el) return;
    el.value = settings[key];
    if (out) out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      if (out) out.textContent = fmt(settings[key]);
      game.applySettings(settings);
      savePrefs();
    });
  };
  bindRange('st-sens', 'sensitivity', (v) => Number(v).toFixed(2));
  bindRange('st-fov', 'fov', (v) => String(Math.round(v)));
  bindRange('st-vol', 'volume', (v) => String(Math.round(v * 100)));

  const quality = $('st-quality');
  quality.value = settings.quality;
  quality.addEventListener('change', () => {
    settings.quality = quality.value;
    $('st-quality-v').textContent = quality.value.toUpperCase();
    game.applySettings(settings); savePrefs();
  });
  $('st-quality-v').textContent = String(settings.quality).toUpperCase();

  const upscale = $('st-upscale');
  upscale.value = settings.upscale;
  upscale.addEventListener('change', () => {
    settings.upscale = upscale.value;
    $('st-upscale-v').textContent = upscale.selectedOptions[0].textContent.split(' — ')[0];
    game.applySettings(settings); savePrefs();
  });
  $('st-upscale-v').textContent = upscale.selectedOptions[0].textContent.split(' — ')[0];
  $('st-dynamic').checked = settings.dynamicRes !== false;
  $('st-dynamic').addEventListener('change', (e) => { settings.dynamicRes = e.target.checked; game.applySettings(settings); savePrefs(); });
  $('st-shadows').checked = settings.shadows !== false;
  $('st-shadows').addEventListener('change', (e) => {
    settings.shadows = e.target.checked;
    $('st-shadows-v').textContent = e.target.checked ? 'ON' : 'OFF';
    game.applySettings(settings); savePrefs();
  });
  $('st-radar').checked = settings.radar !== false;
  $('st-radar').addEventListener('change', (e) => {
    settings.radar = e.target.checked;
    $('st-radar-v').textContent = e.target.checked ? 'ON' : 'OFF';
    savePrefs();
  });
  const ch = $('st-ch');
  ch.value = settings.crosshair;
  ch.addEventListener('input', () => { settings.crosshair = ch.value; $('st-ch-v').textContent = ch.value.toUpperCase(); savePrefs(); });

  $('btn-reset-settings').addEventListener('click', () => {
    Object.assign(settings, DEFAULT_PREFS);
    savePrefs();
    location.reload();
  });

  // tabs & goto
  $$('.railbtn').forEach((b) => b.addEventListener('click', () => { audio.init(); audio.ui(true); switchTab(b.dataset.tab); }));
  $$('.subbtn[data-sub]').forEach((b) => b.addEventListener('click', () => switchSub('play', b.dataset.sub)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    switchTab(b.dataset.goto);
    if (b.dataset.goto === 'play') switchSub('play', 'create');
  }));

  $('btn-quickplay').addEventListener('click', () => playMode('tdm'));
  $('btn-refresh').addEventListener('click', () => net.refreshRooms());
  $('btn-join-code').addEventListener('click', () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length < 4) return toast('Enter a 5-character room code', 'bad');
    net.joinCode(code);
  });
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join-code').click(); });
  $('btn-create').addEventListener('click', createRoom);
  $('btn-rename').addEventListener('click', () => {
    const name = prompt('Callsign (max 16 chars)', settings.name || 'Recruit');
    if (name) applyName(name.slice(0, 16));
  });
  $('btn-open-editor').addEventListener('click', () => openEditor());
  $('btn-help').addEventListener('click', () => {
    hud.addSystem('WASD move · Space jump · Shift walk · Ctrl crouch · LMB fire · RMB scope · R reload · E use · G grenade · B buy · Tab scores · T chat');
    toast('Controls printed to the match log.');
  });

  $('btn-save-loadout').addEventListener('click', saveLoadout);
  $('ld-primary').addEventListener('change', renderLoadoutPreview);

  const chatInput = $('chat-input');
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) net.chat(text);
      hud.closeChat();
      if (game.active) game.requestLock();
    } else if (e.key === 'Escape') {
      hud.closeChat();
      if (game.active) game.requestLock();
    }
  });

  // game overlays
  $('btn-resume').addEventListener('click', resumeMatch);
  $('btn-leave-match').addEventListener('click', leaveMatch);
  $('btn-pause-settings').addEventListener('click', () => { toast('Settings are in the main menu — leave the match to change them.'); });
  $('btn-res-leave').addEventListener('click', leaveMatch);
  $('btn-res-rematch').addEventListener('click', () => {
    const myToken = localStorage.getItem('slopstrike.token');
    if (net.hostToken && myToken !== net.hostToken) {
      toast('Only the host can restart this match.', 'bad');
      return;
    }
    net.cmd('restart');
    hud.hideResults();
    game.matchEnded = false;
    game.lockAllowed = true;
    setTimeout(() => game.requestLock(), 160);
  });

  // shop tabs
  $$('[data-shop]').forEach((b) => b.addEventListener('click', () => {
    shopCategory = b.dataset.shop;
    $$('[data-shop]').forEach((x) => x.classList.toggle('active', x === b));
    renderShop();
  }));

  // editor
  editor = new MapEditor({
    onExit: () => { switchScreen('menu'); switchTab('maps'); },
    onTest: (map) => testMap(map),
    onPublish: (map) => publishMap(map),
  });

  window.addEventListener('keydown', (e) => {
    if (currentTab === 'settings' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Escape' && editor?.active) editor.close();
  });
}

// --------------------------------------------------------------- menu logic
function onProfile(msg) {
  if (msg.profile) profile = msg.profile;
  if (!profile) return;
  hud.setProfile(profile);
  const lvl = levelFromXp(profile.xp || 0);
  $('menu-name').textContent = profile.name;
  $('menu-level').textContent = lvl.level;
  $('menu-coins').textContent = profile.coins;
  $('shop-coins').textContent = profile.coins;
  const kd = profile.deaths ? (profile.kills / profile.deaths) : profile.kills;
  $('menu-kd').textContent = kd.toFixed(2);
  $('menu-xp-fill').style.width = `${Math.min(100, (lvl.into / lvl.need) * 100)}%`;
  $('menu-xp-text').textContent = `${lvl.into} / ${lvl.need} XP · LEVEL ${lvl.level}`;
  if (msg.rooms) rooms = msg.rooms;
  if (msg.maps) setMaps(msg.maps);
  renderRooms();
  renderShop();
  renderLoadout();
  syncLoadoutInputs();
}

function setMaps(list) {
  maps = list || [];
  const select = $('cr-map');
  const current = select.value;
  select.innerHTML = '';
  for (const m of maps) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name}${m.custom ? ' · CUSTOM' : ''}`;
    select.appendChild(opt);
  }
  if (current) select.value = current;
  renderMaps();
}

function playMode(mode) {
  audio.init();
  audio.ui(true);
  net.quickplay(mode);
  setConn('MATCHING…');
}

function createRoom() {
  audio.init();
  const mode = $('cr-mode').value;
  const mapId = $('cr-map').value;
  const bots = Number($('cr-bots').value);
  const maxPlayers = Number($('cr-max').value);
  const name = $('cr-name').value.trim();
  const password = $('cr-pass').value.trim();
  const ruleValues = {};
  document.querySelectorAll('#cr-rules [data-rule]').forEach((el) => {
    const key = el.dataset.rule;
    if (el.type === 'checkbox') ruleValues[key] = el.checked;
    else ruleValues[key] = Number(el.value);
  });
  const payload = {
    mode, mapId, bots, maxPlayers, name, password,
    isPublic: $('cr-public').checked,
    settings: ruleValues,
  };
  if (pendingMapSetup) {
    payload.customMap = pendingMapSetup;
    payload.mapId = undefined;
    pendingMapSetup = null;
  }
  net.create(payload);
  toast('Deploying room…');
}

function testMap(map) {
  audio.init();
  toast('Launching MapLAB playtest…');
  net.create({
    mode: 'tdm', customMap: map, bots: 4, maxPlayers: 12,
    isPublic: false, name: `TEST · ${map.name}`, settings: { maxBots: 4 },
  });
}

function publishMap(map) {
  net.publishMap(map);
}

function renderRooms() {
  const body = $('room-list');
  $('room-count').textContent = `${rooms.length} ROOM${rooms.length === 1 ? '' : 'S'} ONLINE`;
  if (!rooms.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted pad">NO PUBLIC ROOMS — CREATE ONE OR HIT QUICKPLAY</td></tr>';
    return;
  }
  body.innerHTML = '';
  for (const room of rooms) {
    const tr = document.createElement('tr');
    const stateClass = room.phase === 'ended' ? 'ended' : room.phase === 'live' ? 'playing' : '';
    const phase = { warmup: 'WARMUP', freeze: 'BUY', live: 'LIVE', roundEnd: 'ROUND END', ended: 'ENDED' }[room.phase] || room.phase;
    tr.innerHTML = `
      <td><b>${escapeHtml(room.name)}</b><small>${room.code}${room.hasPassword ? ' · LOCKED' : ''}</small></td>
      <td><span class="room-mode">${MODE_DEFS[room.mode]?.short || room.mode}</span></td>
      <td>${escapeHtml(room.map)}</td>
      <td>${room.players}/${room.maxPlayers}${room.bots ? ` <span class="muted small">+${room.bots} AI</span>` : ''}</td>
      <td><span class="room-state ${stateClass}">${phase}</span></td>
      <td><button class="join-btn">JOIN</button></td>`;
    tr.querySelector('.join-btn').addEventListener('click', () => {
      if (room.hasPassword) {
        const pass = prompt('Room password');
        if (pass === null) return;
        net.join(room.id, pass);
      } else net.join(room.id);
      toast('Joining room…');
    });
    body.appendChild(tr);
  }
}

// -------------------------------------------------------------------- shop
function ownedKey(kind, id) { return `${kind}:${id}`; }

function renderShop() {
  if (!profile) return;
  const grid = $('shop-grid');
  const items = CATALOG.filter((i) => i.kind === shopCategory);
  grid.innerHTML = '';
  for (const item of items) {
    const key = ownedKey(item.kind, item.id);
    const owned = profile.owned.includes(key);
    const eq = profile.equipped || {};
    const equipped = (item.kind === 'finish' && [eq.finishPrimary, eq.finishSecondary, eq.finishKnife].includes(item.id))
      || (item.kind === 'body' && eq.body === item.id)
      || (item.kind === 'tracer' && eq.tracer === item.id);
    const card = document.createElement('article');
    card.className = `shop-card${equipped ? ' equipped' : ''}`;
    const rar = RARITY[item.rarity] || RARITY.common;
    let swatchBg;
    if (item.kind === 'finish') swatchBg = `linear-gradient(120deg, ${item.a}, ${item.b})`;
    else if (item.kind === 'body') swatchBg = `linear-gradient(120deg, ${item.body}, ${item.legs})`;
    else swatchBg = `linear-gradient(120deg, #0d1218, ${item.color})`;
    const price = owned ? (equipped ? 'EQUIPPED' : 'OWNED') : `${item.price} CR`;
    card.innerHTML = `
      <div class="sc-swatch" style="background:${swatchBg}">
        <div class="sc-weapon" style="background:linear-gradient(120deg, ${item.a || item.body || item.color}, ${item.b || item.accent || '#0d1218'})"></div>
      </div>
      <div class="sc-info">
        <span class="sc-rar ${item.rarity}">${rar.name}</span>
        <h4>${item.name}</h4>
      </div>
      <div class="sc-foot">
        <b>${price}</b>
        <button class="sc-btn ${equipped ? 'equipped' : owned ? 'owned' : ''}">${equipped ? 'IN USE' : owned ? 'EQUIP' : 'BUY'}</button>
      </div>`;
    const btn = card.querySelector('.sc-btn');
    if (!owned && profile.coins < item.price) { btn.classList.add('locked'); btn.textContent = 'NEED CR'; }
    btn.addEventListener('click', () => {
      audio.init();
      if (!owned) {
        if (profile.coins < item.price) return toast('Not enough credits — frag more.', 'bad');
        net.purchase(item.kind, item.id);
      } else if (!equipped) {
        net.equip(item.kind, item.id);
      }
    });
    grid.appendChild(card);
  }
}

// ------------------------------------------------------------------ loadout
function syncLoadoutInputs() {
  if (!profile) return;
  const ld = profile.loadout || { primary: 'ak', secondary: 'p9' };
  const eq = profile.equipped || {};
  const primary = $('ld-primary');
  const secondary = $('ld-secondary');
  primary.innerHTML = PRIMARY_ORDER.map((id) => `<option value="${id}">${WEAPONS[id].name}</option>`).join('');
  secondary.innerHTML = SECONDARY_ORDER.map((id) => `<option value="${id}">${WEAPONS[id].name}</option>`).join('');
  primary.value = ld.primary;
  secondary.value = ld.secondary;
  const owned = (kind, id) => profile.owned.includes(`${kind}:${id}`);
  const fill = (sel, kind, list, value) => {
    const el = $(sel);
    el.innerHTML = list.filter((i) => owned(kind, i.id)).map((i) => `<option value="${i.id}">${i.name}</option>`).join('');
    if (!el.options.length) el.innerHTML = '<option value="stock">STOCK</option>';
    el.value = value || 'stock';
  };
  fill('ld-finish-primary', 'finish', FINISHES, eq.finishPrimary);
  fill('ld-finish-secondary', 'finish', FINISHES, eq.finishSecondary);
  fill('ld-finish-knife', 'finish', FINISHES, eq.finishKnife);
  fill('ld-body', 'body', BODY_SKINS, eq.body);
  fill('ld-tracer', 'tracer', TRACERS, eq.tracer);
  renderLoadoutPreview();
}

function renderLoadout() {
  syncLoadoutInputs();
}

function renderLoadoutPreview() {
  const id = $('ld-primary').value || 'ak';
  const w = WEAPONS[id] || WEAPONS.ak;
  $('lp-title').textContent = w.name;
  const desc = {
    ak: 'Reliable, hard-hitting, unforgiving. The VK-47 rewards disciplined bursts and punishes spray.',
    m4: 'Faster follow-up shots and a tighter cone. The Warden is the surgeon\'s pick.',
    awp: 'One shot, one kill — if you can afford the credit and the whiff. Scoped movement is slow.',
    mp9: 'High rate, low cost. Wins close angles and eco rounds with volume of fire.',
    breacher: 'Eight pellets, brutal at close range, useless across the yard.',
  };
  $('lp-desc').textContent = desc[id] || '';
  $('lp-dmg').style.width = `${clamp(w.damage / 1.3, 8, 100)}%`;
  $('lp-rate').style.width = `${clamp(w.rpm / 9, 8, 100)}%`;
  $('lp-ctrl').style.width = `${clamp(100 - w.recoil * 18, 8, 100)}%`;
  const finish = FINISHES.find((f) => f.id === $('ld-finish-primary').value) || FINISHES[0];
  const bodyEl = document.querySelector('.lp-gun-body');
  if (bodyEl) bodyEl.style.background = `linear-gradient(100deg, ${finish.a}, ${finish.b})`;
}

function saveLoadout() {
  const payload = {
    primary: $('ld-primary').value,
    secondary: $('ld-secondary').value,
  };
  net.saveLoadout(payload);
  const equip = [
    ['finishPrimary', $('ld-finish-primary').value],
    ['finishSecondary', $('ld-finish-secondary').value],
    ['finishKnife', $('ld-finish-knife').value],
    ['body', $('ld-body').value],
    ['tracer', $('ld-tracer').value],
  ];
  for (const [slot, id] of equip) net.send({ t: 'equipSlot', slot, id });
  audio.ui(true);
  toast('Loadout saved', 'good');
  renderLoadoutPreview();
}

function renderMaps() {
  const builtin = $('builtin-maps');
  builtin.innerHTML = '';
  for (const m of BUILTIN_MAPS) {
    const row = document.createElement('div');
    row.className = 'map-item';
    row.innerHTML = `<div class="map-thumb"></div><div style="flex:1"><h5>${m.name}</h5><p>${m.tagline}</p></div><button class="ghost small">PLAY</button>`;
    row.querySelector('button').addEventListener('click', () => {
      pendingMapSetup = null;
      net.create({ mode: 'tdm', mapId: m.id, bots: 4, maxPlayers: 12, isPublic: false, name: `${m.name} · SKIRMISH` });
      toast('Spinning up skirmish…');
    });
    builtin.appendChild(row);
  }
  const custom = $('custom-maps');
  const list = customMaps.length ? customMaps : (maps || []).filter((m) => m.custom).map((m) => m);
  if (!list.length) {
    custom.innerHTML = '<div class="muted small">NO PUBLISHED MAPS YET. OPEN THE EDITOR AND PUBLISH ONE.</div>';
    return;
  }
  custom.innerHTML = '';
  for (const m of list) {
    const row = document.createElement('div');
    row.className = 'map-item';
    row.innerHTML = `<div class="map-thumb"></div><div style="flex:1"><h5>${escapeHtml(m.name)}</h5><p>${escapeHtml(m.tagline || 'Player-built arena')}</p></div><button class="ghost small">HOST</button>`;
    row.querySelector('button').addEventListener('click', () => {
      net.create({ mode: 'tdm', mapId: m.id, bots: 4, maxPlayers: 12, isPublic: false, name: `${m.name} · SKIRMISH` });
      toast('Spinning up skirmish…');
    });
    custom.appendChild(row);
  }
}

// ------------------------------------------------------------------ match
function startMatch(msg) {
  profile = net.profile || profile;
  audio.init();
  audio.ui(true);
  switchScreen('game');
  game.start(msg.room, msg.map, msg);
  hud.setRoom(msg.room, msg.map);
  hud.setRoster(msg.roster);
  hud.togglePause(false);
  hud.hideResults();
  game.matchEnded = false;
  uiBlocking = false;
  wasLocked = false;
  game.lockAllowed = true;
  setConn('IN MATCH · AUTHORITATIVE 60HZ');
  game.applySettings(settings);
  const mode = MODE_DEFS[msg.room.mode];
  hud.showBanner(mode?.name || 'MATCH', `${msg.map.name} · ${msg.room.isPublic ? 'PUBLIC' : 'PRIVATE'} · CLICK TO LOCK MOUSE`, 3200, 'neutral');
  setTimeout(() => { if (game.active) game.requestLock(); }, 350);
}

function resumeMatch() {
  hud.togglePause(false);
  uiBlocking = false;
  game.lockAllowed = true;
  game.requestLock();
}

function leaveMatch() {
  net.leave();
  game.stop();
  hud.togglePause(false);
  hud.hideResults();
  hud.reset();
  switchScreen('menu');
  setConn('ONLINE · AUTHORITATIVE SERVER');
  net.refreshRooms();
  switchTab('play', 'browse');
}

function handleGameKey(code) {
  if (!game.active) return;
  if (code === 'Escape') {
    if (hud.buyOpen) { hud.toggleBuy(false); return; }
    if (!$('pause-menu').classList.contains('hidden')) return;
    // browser already released pointer lock; pause overlay handles it
    return;
  }
  if (code === 'KeyB') {
    hud.toggleBuy();
    return;
  }
  if (code === 'Tab') { hud.toggleScoreboard(true); return; }
  if (code === 'TabUp') { hud.toggleScoreboard(false); return; }
  if (code === 'Enter' || code === 'KeyT') {
    if (hud.buyOpen) return;
    uiBlocking = true;
    hud.openChat();
    return;
  }
  if (code === 'KeyM') {
    settings.volume = settings.volume > 0 ? 0 : 0.65;
    audio.setVolume(settings.volume);
    savePrefs();
    toast(settings.volume ? 'Audio on' : 'Audio muted');
  }
}

// ------------------------------------------------------------------ editor
let editor = null;
function openEditor(map) {
  switchScreen('editor');
  editor.open(map || null);
  audio.init();
  audio.ui(true);
}

// -------------------------------------------------------------------- net
net.on('joined', (msg) => {
  startMatch(msg);
});
net.on('roster', (msg) => {
  hud.setRoster(msg.players);
  if (profile && msg.hostToken) net.hostToken = msg.hostToken;
});
net.on('snapshot', (msg) => {
  if (game.active) {
    for (const ev of msg.ev || []) game.onGlobalEvent(ev, msg);
    for (const ev of msg.pe || []) game.onPersonalEvent(ev);
  }
  // merge live stats into roster for scoreboard
  const byId = new Map(msg.players.map((p) => [p[0], p]));
  for (const p of net.roster) {
    const a = byId.get(p.id);
    if (a) { p.kills = a[17]; p.deaths = a[18]; p.score = a[20]; }
  }
  if (msg.you) {
    net.roster.find((p) => p.id === net.youId) && Object.assign(net.roster.find((p) => p.id === net.youId), { kills: msg.you.kills, deaths: msg.you.deaths, score: msg.you.score });
  }
  hud.tickChat();
});
net.on('chat', (msg) => hud.addChat(msg));
net.on('sys', (msg) => hud.addSystem(msg.text));
net.on('error', (msg) => { toast(msg.msg || 'Server error', 'bad'); if (!game.active) setConn('ONLINE · AUTHORITATIVE SERVER'); });
net.on('rooms', (list) => { rooms = list; renderRooms(); });
net.on('mapSaved', (msg) => {
  toast('Map published to the community list', 'good');
  if (msg.maps) setMaps(msg.maps);
  editor?.refreshMaps?.();
});
net.on('rewards', (msg) => {
  if (msg.profile) { profile = msg.profile; onProfile({ profile: msg.profile }); }
  hud.setRewards(msg);
});
net.on('kicked', () => { toast('Removed by host', 'bad'); leaveMatch(); });
net.on('left', (msg) => {
  if (msg.rooms) { rooms = msg.rooms; renderRooms(); }
});
net.on('closed', () => {
  setConn('DISCONNECTED', false);
  if (game.active) {
    toast('Connection lost', 'bad');
    game.stop(true);
    switchScreen('menu');
    switchTab('play', 'browse');
  }
});
net.on('purchase', () => audio.ui(true));

// load community maps into the maps tab
(async () => {
  try {
    const res = await fetch('/api/maps');
    const data = await res.json();
    customMaps = (data.custom || []).map((m) => ({ id: m.id, name: m.name, tagline: m.tagline, custom: true }));
    if (maps.length) renderMaps();
  } catch { /* server offline */ }
})();

window.addEventListener('error', (err) => {
  console.error(err.error || err.message);
});

window.SLOPSTRIKE = { game, net, hud, audio, get settings() { return settings; }, leaveMatch };

boot();

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
