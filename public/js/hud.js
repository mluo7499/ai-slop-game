// In-match HUD: vitals, scores, objectives, killfeed, radar, buy menu, scoreboard.
import { WEAPONS, BUY_ITEMS, TEAM_INFO, MODE_DEFS, clamp } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.net = null;
    this.game = null;
    this.buyOpen = false;
    this.sbOpen = false;
    this.lastYaw = 0;
    this.radarBase = null;
    this.lastRadarDraw = 0;
    this.lastSbDraw = 0;
    this.killRows = [];
    this.chatRows = [];
    this.bannerTimer = null;
    this.hitTimer = null;
    this.textCache = new Map();
    this.roomInfo = null;
    this.mapData = null;
    this.rewards = null;
    this.resultsShown = false;
    this.buildBuy();
    this.buildDamageIndicators();
  }

  mount(net, game, profile) {
    this.net = net;
    this.game = game;
    this.profile = profile;
    this.reset();
  }

  setProfile(profile) {
    this.profile = profile;
  }

  reset() {
    this.buyOpen = false;
    this.sbOpen = false;
    $('buy-menu').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
    $('pause-menu').classList.add('hidden');
    $('results').classList.add('hidden');
    $('death-screen').classList.add('hidden');
    $('respawn').classList.add('hidden');
    $('hud-chat').innerHTML = '';
    $('killfeed').innerHTML = '';
    $('damage-arrows').innerHTML = '';
    $('center-banner').classList.add('hidden');
    $('hud-scope').classList.add('hidden');
    $('hud-flash').style.opacity = 0;
    $('hud-hint').style.opacity = 1;
    this.killRows = [];
    this.chatRows = [];
    this.resultsShown = false;
    this.rewards = null;
    this.textCache.clear();
  }

  setRoom(roomInfo, mapData) {
    this.roomInfo = roomInfo;
    this.mapData = mapData;
    this.reset();
    const label = $('radar-label');
    label.textContent = `${mapData.name} · ${MODE_DEFS[roomInfo.mode]?.short || roomInfo.mode.toUpperCase()}`;
    $('sb-title').textContent = `${mapData.name} — ${MODE_DEFS[roomInfo.mode]?.name || roomInfo.mode}`;
    $('sb-sub').textContent = roomInfo.isPublic ? 'PUBLIC ROOM' : `PRIVATE · ${roomInfo.code}`;
    $('team-a-name').textContent = TEAM_INFO[0].name.toUpperCase();
    $('team-b-name').textContent = TEAM_INFO[1].name.toUpperCase();
    this.buildRadarBase(mapData);
    this.buildBuy();
    this.buyOpen = false;
    $('buy-menu').classList.add('hidden');
    $('respawn').classList.add('hidden');
    $('death-screen').classList.add('hidden');
  }

  buildRadarBase(map) {
    const size = 200;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const padding = 10;
    const halfX = map.halfX || 40;
    const halfZ = map.halfZ || 40;
    const scale = (size - padding * 2) / Math.max(halfX * 2, halfZ * 2);
    this.radarTransform = { scale, halfX, halfZ, size };
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(7,11,17,0.86)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(95,124,150,0.28)';
    ctx.lineWidth = 1;
    for (let g = -40; g <= 40; g += 10) {
      const p = this.worldToRadar(g * 4, 0);
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, size); ctx.stroke();
      const q = this.worldToRadar(0, g * 4);
      ctx.beginPath(); ctx.moveTo(0, q.y); ctx.lineTo(size, q.y); ctx.stroke();
    }
    for (const b of map.blocks || []) {
      if (b.solid === false) continue;
      const p = this.worldToRadar(b.x, b.z);
      const w = Math.max(1.5, b.w * scale);
      const d = Math.max(1.5, b.d * scale);
      const h = clamp(b.h / 6, 0.15, 1);
      ctx.fillStyle = `rgba(${64 + h * 46},${74 + h * 52},${88 + h * 56},0.9)`;
      ctx.fillRect(p.x - w / 2, p.y - d / 2, w, d);
    }
    for (const s of map.sites || []) {
      const p = this.worldToRadar(s.x, s.z);
      ctx.strokeStyle = 'rgba(255,154,60,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, s.r * scale), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,180,100,0.85)';
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.label || 'A', p.x, p.y + 3);
    }
    this.radarBase = canvas;
  }

  worldToRadar(x, z) {
    const { scale, size } = this.radarTransform;
    return { x: size / 2 + x * scale, y: size / 2 + z * scale };
  }

  buildBuy() {
    const grid = $('buy-grid');
    if (!grid) return;
    grid.innerHTML = '';
    this.buyButtons = [];
    BUY_ITEMS.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'buy-item';
      btn.dataset.id = item.id;
      const w = WEAPONS[item.id];
      btn.innerHTML = `
        <span class="bi-key">${i + 1}</span>
        <span class="bi-name">${item.label}</span>
        <span class="bi-price">${item.price ? '$' + item.price : 'FREE'}</span>
        <span class="bi-meta">${w ? `${w.damage} DMG · ${w.rpm} RPM` : item.kind === 'armor' ? 'DAMAGE MITIGATION' : 'FRAG GRENADE'}</span>`;
      btn.addEventListener('click', () => {
        this.handlers.buy?.(item.id);
      });
      grid.appendChild(btn);
      this.buyButtons.push(btn);
    });
  }

  buildDamageIndicators() {
    const host = $('damage-arrows');
    if (!host) return;
    this.arrowPool = [];
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-arrow';
      host.appendChild(el);
      this.arrowPool.push({ el, life: 0 });
    }
  }

  // -------------------------------------------------------------------- data
  setRoster(roster) {
    this.roster = roster;
    if (this.sbOpen) this.renderScoreboard();
  }

  update(game) {
    const net = game.net;
    const me = net.me;
    if (!me) return;
    this.lastYaw = game.yaw;
    const snap = net.latest;
    const alive = me.alive;

    this.setText('hud-hp', Math.round(Math.max(0, me.hp)));
    this.setText('hud-armor', Math.round(Math.max(0, me.armor)));
    this.setText('hud-money', `$${Math.round(me.money)}`);
    $('hud-money').classList.toggle('can-buy', !!me.canBuy);

    const weapon = WEAPONS[me.active] || WEAPONS.p9;
    this.setText('hud-weapon', weapon.name);
    if (weapon.slot === 3) {
      this.setText('hud-mag', '—');
      this.setText('hud-reserve', '');
    } else {
      this.setText('hud-mag', Math.max(0, me.mag));
      this.setText('hud-reserve', me.reserve);
    }
    this.setText('hud-grenades', `◍ ${me.grenades || 0}`);
    this.setText('hud-role', net.room?.mode === 'bomb' ? (me.role === 'atk' ? 'ATTACK' : 'DEFEND') : '');

    const healthPct = clamp(me.hp / 100, 0, 1);
    $('hud-hp').style.color = healthPct < 0.3 ? '#ff5545' : healthPct < 0.6 ? '#ffb347' : '#e8f2ff';
    $('hud-hp').parentElement.classList.toggle('critical', healthPct < 0.3);

    const latest = snap;
    if (latest) {
      const mode = net.room?.mode;
      const teamBased = latest.scores?.length === 2;
      if (teamBased) {
        this.setText('team-a-name', TEAM_INFO[0].name.toUpperCase());
        this.setText('team-b-name', TEAM_INFO[1].name.toUpperCase());
        this.setText('score-a', latest.scores[0]);
        this.setText('score-b', latest.scores[1]);
        $('.team-block.a')?.classList?.toggle('leading', latest.scores[0] > latest.scores[1]);
      } else {
        this.setText('team-a-name', 'YOUR SCORE');
        this.setText('team-b-name', 'LEADER');
        this.setText('score-a', Math.round(me.score || 0));
        const top = Math.max(0, ...(latest.players || []).map((p) => p[20] || 0));
        this.setText('score-b', Math.round(top));
      }
      const phaseNames = { warmup: 'WARMUP', freeze: 'BUY PHASE', live: 'LIVE', roundEnd: 'ROUND OVER', ended: 'MATCH OVER' };
      this.setText('phase-label', phaseNames[latest.phase] || latest.phase.toUpperCase());
      let timeLeft = latest.left;
      if (latest.phase === 'live') timeLeft = latest.maxLeft || latest.roundLeft || latest.left;
      this.setText('match-timer', latest.phase === 'warmup' ? Math.ceil(timeLeft) : fmtTime(timeLeft));
      $('match-timer').classList.toggle('urgent', latest.phase === 'live' && timeLeft < 20);
      this.setText('round-label', mode === 'bomb'
        ? `ROUND ${latest.round} · FIRST TO ${latest.limit}`
        : `FIRST TO ${latest.limit}`);

      const objective = $('objective-bar');
      if (latest.bomb) {
        objective.classList.remove('hidden');
        this.setText('objective-text', `SPIKE ARMED · SITE ${latest.bomb.site} · ${Math.ceil(latest.bomb.t)}s`);
        $('objective-fill').style.width = `${clamp((latest.bomb.t / 40) * 100, 0, 100)}%`;
        $('objective-fill').style.background = latest.bomb.t < 10 ? '#ff4030' : '#ff9a3c';
        if (latest.bomb.d > 0) {
          objective.classList.remove('hidden');
          this.setText('objective-text', `DEFUSING ${Math.round(latest.bomb.d / 7 * 100)}%`);
        }
      } else if (latest.hill) {
        objective.classList.remove('hidden');
        const owner = latest.hill.owner === -1 ? 'CONTESTED' : latest.hill.owner === 0 ? TEAM_INFO[0].name : latest.hill.owner === 1 ? TEAM_INFO[1].name : 'PLAYER';
        this.setText('objective-text', `HILL ${latest.hill.label} · ${owner} · MOVES IN ${Math.ceil(latest.hill.rotate)}s`);
        $('objective-fill').style.width = `${clamp((latest.hill.rotate / 45) * 100, 0, 100)}%`;
        $('objective-fill').style.background = '#5ce1ff';
      } else {
        objective.classList.add('hidden');
      }

      // interaction prompt
      const prompt = $('interact-prompt');
      let promptText = '';
      let promptProgress = 0;
      if (mode === 'bomb' && alive) {
        if (me.role === 'atk' && !latest.bomb) {
          const site = (this.mapData.sites || []).find((s) => Math.hypot(net.local.pos[0] - s.x, net.local.pos[2] - s.z) <= s.r);
          if (site) { promptText = `HOLD TO PLANT · SITE ${site.label}`; promptProgress = me.plantProgress; }
        } else if (me.role === 'def' && latest.bomb) {
          const d = Math.hypot(net.local.pos[0] - latest.bomb.x, net.local.pos[2] - latest.bomb.z);
          if (d < 2.6) { promptText = 'HOLD TO DEFUSE'; promptProgress = me.defuseProgress; }
        }
      }
      prompt.classList.toggle('hidden', !promptText);
      if (promptText) {
        this.setText('interact-text', promptText);
        $('interact-fill').style.width = `${clamp((promptProgress || 0) * 100, 0, 100)}%`;
      }
    }

    // crosshair
    const spread = net.approximateSpread();
    const bloom = Math.min(1, (game.shotIndex || 0) / 12);
    const speed = net.local ? Math.hypot(net.local.vel[0], net.local.vel[2]) : 0;
    const gap = 5 + spread * 4 + bloom * 7 + clamp(speed / 6, 0, 1) * 4;
    document.documentElement.style.setProperty('--ch-gap', `${gap}px`);
    document.documentElement.style.setProperty('--ch-color', this.handlers.crosshairColor?.() || '#3aff9e');

    // death / respawn
    if (!alive) {
      $('death-screen').classList.remove('hidden');
      const respawn = Math.max(0, Math.ceil(me.respawnIn || 0));
      this.setText('death-respawn', respawn > 0 ? `RESPAWN IN ${respawn}` : (net.room?.mode === 'bomb' ? 'WAITING FOR NEXT ROUND' : 'RESPAWNING…'));
      $('respawn').classList.add('hidden');
    } else {
      $('death-screen').classList.add('hidden');
      $('respawn').classList.add('hidden');
    }

    // hint fade
    $('hud-hint').style.opacity = game.time > 18 ? '0' : String(clamp(1 - game.time / 18, 0, 1));

    // radar
    const showRadar = this.handlers.showRadar ? this.handlers.showRadar() : true;
    $('radar-wrap').style.display = showRadar ? '' : 'none';
    if (showRadar && performance.now() - this.lastRadarDraw > 90) {
      this.lastRadarDraw = performance.now();
      this.drawRadar(game);
    }

    // buy affordability
    if (this.buyOpen) {
      this.setText('buy-money', `$${Math.round(me.money)}`);
      for (const btn of this.buyButtons || []) {
        const item = BUY_ITEMS.find((i) => i.id === btn.dataset.id);
        btn.classList.toggle('unaffordable', !!item && me.money < item.price);
        btn.classList.toggle('owned', !!item && item.kind === 'weapon' && me.slots && me.slots[WEAPONS[item.id]?.slot] === item.id);
      }
    }

    // scoreboard refresh
    if (this.sbOpen && performance.now() - this.lastSbDraw > 450) {
      this.lastSbDraw = performance.now();
      this.renderScoreboard();
    }
    this.setText('pause-ping', `${Math.round(net.rtt)} MS · ${Math.round(net.jitter)} JITTER`);
  }

  setText(id, value) {
    const el = $(id);
    if (!el) return;
    const v = String(value);
    if (this.textCache.get(id) === v) return;
    this.textCache.set(id, v);
    el.textContent = v;
  }

  setPerf(game) {
    const s = game.getStats();
    this.setText('perf-fps', Math.round(s.fps));
    this.setText('perf-ping', `${Math.round(s.ping)}ms/${Math.round(s.jitter)}`);
    this.setText('perf-upscale', s.upscale.label);
  }

  setScope(on) {
    $('hud-scope').classList.toggle('hidden', !on);
    $('crosshair').classList.toggle('hidden', !!on);
  }

  hitmarker(headshot) {
    const el = $('hitmarker');
    el.classList.remove('show', 'head');
    void el.offsetWidth;
    el.classList.add('show');
    if (headshot) el.classList.add('head');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => el.classList.remove('show', 'head'), 220);
  }

  damageFrom(dir) {
    if (!dir) return;
    const dx = dir[0], dz = dir[2];
    const yaw = this.lastYaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dotF = dx * fx + dz * fz;
    const dotR = dx * rx + dz * rz;
    const angle = Math.atan2(dotR, dotF) * 180 / Math.PI;
    const slot = this.arrowPool.find((a) => a.life <= 0) || this.arrowPool[0];
    if (!slot) return;
    slot.life = 1.4;
    slot.el.style.opacity = '1';
    slot.el.style.transform = `translate(-50%,-50%) rotate(${angle + 90}deg)`;
    $('hud-flash').style.opacity = '0.55';
    setTimeout(() => { $('hud-flash').style.opacity = '0'; }, 90);
  }

  showBanner(title, sub = '', ms = 2200, tone = 'neutral') {
    const el = $('center-banner');
    el.classList.remove('hidden', 'good', 'danger', 'neutral');
    el.classList.add(tone);
    el.querySelector('h2').textContent = title;
    el.querySelector('p').textContent = sub || '';
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  showEndBanner(win, ev) {
    this.showBanner(win ? 'MATCH WON' : 'MATCH LOST', win ? 'FLAWLESS WORK, OPERATOR' : 'REGROUP AND RUN IT BACK', 3200, win ? 'good' : 'danger');
    if (win) this.handlers.winSound?.(); else this.handlers.loseSound?.();
  }

  showDeath(killerName, weaponId, headshot) {
    $('death-screen').classList.remove('hidden');
    this.setText('death-killer', killerName || 'UNKNOWN');
    this.setText('death-weapon', `${WEAPONS[weaponId]?.name || weaponId || 'UNKNOWN'}${headshot ? ' · HEADSHOT' : ''}`);
  }

  hideDeath() {
    $('death-screen').classList.add('hidden');
  }

  killfeed(ev) {
    const feed = $('killfeed');
    const killer = ev.kname || this.roster?.find((p) => p.id === ev.killer)?.name || 'WORLD';
    const victim = ev.vname || this.roster?.find((p) => p.id === ev.victim)?.name || '?';
    const weapon = WEAPONS[ev.w]?.short || (ev.w === 'world' ? 'BLAST' : String(ev.w || '').toUpperCase());
    const kTeam = this.roster?.find((p) => p.id === ev.killer)?.team;
    const vTeam = this.roster?.find((p) => p.id === ev.victim)?.team;
    const row = document.createElement('div');
    row.className = 'kf-row';
    if (ev.tk) row.classList.add('teamkill');
    row.innerHTML = `
      <b class="kf-k ${kTeam === 0 ? 'a' : kTeam === 1 ? 'b' : ''}">${escapeHtml(killer)}</b>
      <span class="kf-w">${ev.hs ? '⌖' : ''} ${escapeHtml(weapon)}${ev.hs ? ' HS' : ''}</span>
      <b class="kf-v ${vTeam === 0 ? 'a' : vTeam === 1 ? 'b' : ''}">${escapeHtml(victim)}</b>`;
    feed.appendChild(row);
    this.killRows.push({ el: row, at: performance.now() });
    if (this.killRows.length > 6) {
      const old = this.killRows.shift();
      old.el.remove();
    }
  }

  addChat(msg) {
    const host = $('hud-chat');
    const row = document.createElement('div');
    row.className = 'chat-row';
    row.innerHTML = `<b>${escapeHtml(msg.name || 'SERVER')}</b> ${escapeHtml(msg.text || '')}`;
    host.appendChild(row);
    this.chatRows.push({ el: row, at: performance.now() });
    while (this.chatRows.length > 7) this.chatRows.shift().el.remove();
  }

  addSystem(text) {
    this.addChat({ name: 'SYSTEM', text });
  }

  tickChat() {
    const now = performance.now();
    this.chatRows = this.chatRows.filter((r) => {
      if (now - r.at > 10000) { r.el.remove(); return false; }
      return true;
    });
    this.killRows = this.killRows.filter((r) => {
      if (now - r.at > 6000) { r.el.remove(); return false; }
      return true;
    });
    for (const a of this.arrowPool) {
      if (a.life > 0) {
        a.life -= 0.016;
        if (a.life <= 0) a.el.style.opacity = '0';
      }
    }
  }

  drawRadar(game) {
    const canvas = $('radar');
    const ctx = canvas.getContext('2d');
    const net = game.net;
    ctx.clearRect(0, 0, 200, 200);
    if (this.radarBase) ctx.drawImage(this.radarBase, 0, 0);
    if (!this.radarTransform) return;
    const snap = net.latest;
    if (!snap) return;
    const me = snap.players.find((p) => p[0] === net.youId);
    if (!me) return;
    // hill / bomb
    if (snap.hill) {
      const p = this.worldToRadar(snap.hill.x, snap.hill.z);
      ctx.strokeStyle = 'rgba(92,225,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, snap.hill.r * this.radarTransform.scale, 0, Math.PI * 2); ctx.stroke();
    }
    if (snap.bomb) {
      const p = this.worldToRadar(snap.bomb.x, snap.bomb.z);
      ctx.fillStyle = '#ff4b33';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    for (const arr of snap.players) {
      const id = arr[0];
      if (id === net.youId) continue;
      const alive = arr[14] === 1;
      if (!alive) continue;
      const team = arr[9];
      const mine = me[9];
      const hasTeams = team >= 0 && mine >= 0;
      const isAlly = hasTeams && team === mine;
      const p = this.worldToRadar(arr[1], arr[3]);
      ctx.fillStyle = isAlly ? (team === 0 ? '#ff6b4a' : '#4aa8ff') : '#ff4b5a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, isAlly ? 2.6 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // local arrow
    const p = this.worldToRadar(me[1], me[3]);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-me[4]);
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  toggleBuy(force) {
    const next = force === undefined ? !this.buyOpen : !!force;
    if (next && !this.net?.me?.canBuy) {
      this.addSystem('Buy zone closed — return to spawn or wait for freeze time.');
      return;
    }
    this.buyOpen = next;
    $('buy-menu').classList.toggle('hidden', !next);
    this.handlers.onBuyToggle?.(next);
  }

  toggleScoreboard(force) {
    this.sbOpen = force === undefined ? !this.sbOpen : !!force;
    $('scoreboard').classList.toggle('hidden', !this.sbOpen);
    if (this.sbOpen) this.renderScoreboard();
  }

  togglePause(force) {
    $('pause-menu').classList.toggle('hidden', force === false);
    const room = this.roomInfo;
    if (room) this.setText('pause-room', `${room.name} · ${MODE_DEFS[room.mode]?.short || room.mode}`);
  }

  renderScoreboard() {
    const roster = this.roster || [];
    const net = this.net;
    const body = $('sb-body');
    if (!roster.length) { body.innerHTML = '<div class="muted pad">Waiting for players…</div>'; return; }
    const teams = [0, 1, -1];
    let html = '';
    for (const team of teams) {
      const players = roster.filter((p) => p.team === team).sort((a, b) => b.score - a.score || b.kills - a.kills);
      if (!players.length) continue;
      const label = team === 0 ? TEAM_INFO[0].name : team === 1 ? TEAM_INFO[1].name : 'FREE AGENTS';
      const score = team === 0 ? net?.latest?.scores?.[0] : team === 1 ? net?.latest?.scores?.[1] : '';
      html += `<div class="sb-team"><div class="sb-head"><span>${label}</span><b>${score ?? ''}</b></div>
        <table><thead><tr><th>OPERATOR</th><th>FRAGS</th><th>DEATHS</th><th>SCORE</th><th>PING</th></tr></thead><tbody>`;
      for (const p of players) {
        const isYou = p.id === net?.youId;
        html += `<tr class="${isYou ? 'you' : ''}">
          <td>${p.bot ? '<i class="tag">BOT</i>' : ''}${escapeHtml(p.name)}${isYou ? ' <i class="tag you">YOU</i>' : ''}</td>
          <td>${p.kills}</td><td>${p.deaths}</td><td>${Math.round(p.score || 0)}</td>
          <td>${p.bot ? '—' : p.ping + 'ms'}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    body.innerHTML = html;
  }

  showResults(game) {
    const net = game.net;
    const latest = net.latest;
    if (!latest) return;
    this.resultsShown = true;
    const me = net.me;
    const teamBased = latest.scores?.length === 2;
    const win = teamBased ? latest.winner === me.team : latest.winner === net.youId;
    const roster = this.roster || [];
    const sorted = [...roster].sort((a, b) => b.score - a.score);
    $('res-title').textContent = win ? 'VICTORY' : teamBased ? 'DEFEAT' : 'MATCH OVER';
    $('res-title').className = win ? 'win' : 'lose';
    $('res-kicker').textContent = `${MODE_DEFS[this.roomInfo?.mode]?.name || 'MATCH'} · ${this.mapData?.name || ''}`;
    $('res-score').textContent = teamBased
      ? `${latest.scores[0]} — ${latest.scores[1]}`
      : `${me.score} PTS`;
    $('res-kills').textContent = me.kills ?? 0;
    $('res-deaths').textContent = me.deaths ?? 0;
    $('res-hs').textContent = me.headshots ?? 0;
    $('res-kd').textContent = ((me.deaths ? me.kills / me.deaths : me.kills) || 0).toFixed(2);
    let html = '<table><thead><tr><th>#</th><th>OPERATOR</th><th>FRAGS</th><th>DEATHS</th><th>SCORE</th></tr></thead><tbody>';
    sorted.slice(0, 8).forEach((p, i) => {
      html += `<tr class="${p.id === net.youId ? 'you' : ''}"><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${Math.round(p.score || 0)}</td></tr>`;
    });
    html += '</tbody></table>';
    $('res-table').innerHTML = html;
    $('res-rewards').classList.add('hidden');
    $('results').classList.remove('hidden');
    if (win) this.handlers.winSound?.(); else this.handlers.loseSound?.();
  }

  hideResults() {
    $('results').classList.add('hidden');
    this.resultsShown = false;
  }

  setRewards(msg) {
    this.rewards = msg;
    const box = $('res-rewards');
    box.classList.remove('hidden');
    box.innerHTML = `
      <div><span>CREDITS EARNED</span><b>+${msg.coins}</b></div>
      <div><span>XP EARNED</span><b>+${msg.xp}</b></div>
      ${msg.levels ? `<div class="levelup"><span>LEVEL UP</span><b>LEVEL ${msg.profile?.level || ''}</b></div>` : ''}`;
    if (msg.levels) this.handlers.levelSound?.();
  }

  openChat() {
    const bar = $('hud-chat-input');
    bar.classList.remove('hidden');
    const input = $('chat-input');
    input.value = '';
    input.focus();
    this.handlers.onChatOpen?.(true);
    return input;
  }

  closeChat() {
    $('hud-chat-input').classList.add('hidden');
    this.handlers.onChatOpen?.(false);
  }

  setConnection(text) {
    const el = $('conn-state');
    if (el) el.textContent = text;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
