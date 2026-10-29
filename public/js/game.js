// First-person renderer, input, weapon feedback and remote-player animation.
import * as THREE from 'three';
import { WEAPONS, BTN, TEAM_INFO, DEG, eyeHeight, clamp, PHYS } from '/shared/constants.js';
import { BODY_SKINS, TRACERS } from '/shared/shop.js';
import { buildWorld } from './world.js';
import { buildViewModel } from './weapons.js';
import { Upscaler } from './upscaler.js';

const GEO = {};
function geometries() {
  if (GEO.torso) return GEO;
  GEO.torso = new THREE.BoxGeometry(0.54, 0.64, 0.32);
  GEO.head = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  GEO.leg = new THREE.BoxGeometry(0.2, 0.76, 0.22);
  GEO.arm = new THREE.BoxGeometry(0.16, 0.58, 0.18);
  GEO.gun = new THREE.BoxGeometry(0.09, 0.11, 0.62);
  GEO.visor = new THREE.BoxGeometry(0.31, 0.1, 0.05);
  GEO.ring = new THREE.RingGeometry(0.42, 0.56, 28);
  GEO.nade = new THREE.SphereGeometry(0.11, 10, 8);
  return GEO;
}

function glowTexture(inner = 'rgba(255,240,190,0.95)', outer = 'rgba(255,140,40,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(5,5,6,0.95)';
  ctx.beginPath(); ctx.arc(32, 32, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(32, 32, 14, 0, Math.PI * 2); ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function nameTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 26px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(4,7,12,0.62)';
  const w = Math.min(240, ctx.measureText(name).width + 26);
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 12, w, 38, 8);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class RemotePlayer {
  constructor(scene) {
    const g = geometries();
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.75, metalness: 0.12 }),
      legs: new THREE.MeshStandardMaterial({ color: 0x252c36, roughness: 0.85 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.5, metalness: 0.2, emissive: 0x220000 }),
      head: new THREE.MeshStandardMaterial({ color: 0xc39a76, roughness: 0.85 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x0d1218, roughness: 0.25, metalness: 0.8 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.5, metalness: 0.7 }),
    };
    this.torso = new THREE.Mesh(g.torso, this.mats.body);
    this.torso.position.y = 1.12;
    this.rig.add(this.torso);
    this.chest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.02), this.mats.accent);
    this.chest.position.set(0, 1.16, -0.17);
    this.rig.add(this.chest);
    this.head = new THREE.Mesh(g.head, this.mats.head);
    this.head.position.y = 1.58;
    this.rig.add(this.head);
    this.visor = new THREE.Mesh(g.visor, this.mats.visor);
    this.visor.position.set(0, 1.6, -0.14);
    this.rig.add(this.visor);
    this.legs = [-1, 1].map((s) => {
      const leg = new THREE.Mesh(g.leg, this.mats.legs);
      leg.position.set(0.15 * s, 0.4, 0);
      this.rig.add(leg);
      return leg;
    });
    this.arms = [-1, 1].map((s) => {
      const arm = new THREE.Mesh(g.arm, this.mats.body);
      arm.position.set(0.36 * s, 1.12, 0);
      arm.rotation.x = 0.25;
      this.rig.add(arm);
      return arm;
    });
    this.gun = new THREE.Mesh(g.gun, this.mats.gun);
    this.gun.position.set(0.24, 1.18, -0.32);
    this.gun.rotation.x = 0.1;
    this.rig.add(this.gun);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.42);
    this.gun.add(this.muzzle);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(g.ring, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.group.add(this.ring);

    const flashMat = new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffd8a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.set(0.5, 0.5, 1);
    this.flash.position.set(0, 0, -0.5);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.flashTime = 0;

    this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.nameSprite.scale.set(2.2, 0.55, 1);
    this.nameSprite.position.y = 2.08;
    this.group.add(this.nameSprite);

    this.group.visible = false;
    this.dead = false;
    this.deadTime = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.name = '';
    this.skinKey = '';
    this.team = -1;
    this.hidden = true;
    scene.add(this.group);
    this.scene = scene;
  }

  setName(name, team) {
    if (this.name === name && this.team === team) return;
    this.name = name;
    this.team = team;
    const color = team === 0 ? TEAM_INFO[0].css : team === 1 ? TEAM_INFO[1].css : '#d8e2ee';
    const tex = nameTexture(name, color);
    this.nameSprite.material.map?.dispose();
    this.nameSprite.material.map = tex;
    this.nameSprite.material.needsUpdate = true;
  }

  applyLook(info) {
    const bodyId = info.equipped?.body || 'stock';
    const body = BODY_SKINS.find((b) => b.id === bodyId) || BODY_SKINS[0];
    const key = `${bodyId}:${info.team}`;
    if (this.skinKey === key) return;
    this.skinKey = key;
    this.mats.body.color.set(body.body);
    this.mats.legs.color.set(body.legs);
    this.mats.accent.color.set(info.team === 0 ? TEAM_INFO[0].css : info.team === 1 ? TEAM_INFO[1].css : body.accent);
    this.ring.material.color.set(info.team === 0 ? TEAM_INFO[0].color : info.team === 1 ? TEAM_INFO[1].color : 0x9fe8ff);
    this.setName(this.name || info.name, info.team);
  }

  flashMuzzle() {
    this.flash.visible = true;
    this.flashTime = 0.05;
  }

  update(info, dt) {
    this.group.visible = true;
    this.applyLook(info);
    this.setName(info.name, info.team);
    this.group.position.set(info.pos[0], info.pos[1], info.pos[2]);
    this.group.rotation.y = info.yaw;
    const speed = Math.hypot(info.vel?.[0] || 0, info.vel?.[2] || 0);
    const crouch = info.crouch || 0;
    this.rig.scale.y = 1 - crouch * 0.22;
    this.head.rotation.x = -clamp(info.pitch, -60, 60) * DEG * 0.55;
    this.gun.rotation.x = 0.1 - clamp(info.pitch, -60, 60) * DEG * 0.5;
    const moving = Math.hypot(info.pos[0] - (this.lastX ?? info.pos[0]), info.pos[2] - (this.lastZ ?? info.pos[2]));
    this.lastX = info.pos[0];
    this.lastZ = info.pos[2];
    this.phase += dt * (4 + moving * 22);
    const amp = clamp(moving * 5.2, 0, 0.7);
    this.legs[0].rotation.x = Math.sin(this.phase) * amp;
    this.legs[1].rotation.x = -Math.sin(this.phase) * amp;
    this.arms[0].rotation.x = 0.25 - Math.sin(this.phase) * amp * 0.3;
    this.arms[1].rotation.x = 0.25 + Math.sin(this.phase) * amp * 0.3;

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }

    if (!info.alive) {
      if (!this.dead) { this.dead = true; this.deadTime = 0; }
      this.deadTime += dt;
      const t = Math.min(1, this.deadTime * 3);
      this.group.rotation.z = t * Math.PI * 0.5;
      this.group.position.y = info.pos[1] + Math.min(0.25, this.deadTime * 0.3);
      this.ring.visible = false;
      this.nameSprite.visible = false;
      const fade = clamp(1 - (this.deadTime - 1.2) / 1.4, 0, 1);
      for (const m of Object.values(this.mats)) {
        m.transparent = fade < 1;
        m.opacity = fade;
      }
      if (this.deadTime > 3) this.group.visible = false;
    } else {
      if (this.dead) {
        this.dead = false;
        this.deadTime = 0;
        this.group.rotation.z = 0;
        for (const m of Object.values(this.mats)) { m.transparent = false; m.opacity = 1; }
      }
      this.group.rotation.z = 0;
      this.ring.visible = true;
      this.nameSprite.visible = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.nameSprite.material.map?.dispose();
    this.nameSprite.material.dispose();
    this.mats.body.dispose();
    this.mats.legs.dispose();
    this.mats.accent.dispose();
    this.mats.head.dispose();
    this.mats.visor.dispose();
    this.mats.gun.dispose();
    this.flash.material.dispose();
    this.ring.material.dispose();
  }
}

export class Game {
  constructor({ canvas, net, audio, settings, hud }) {
    this.canvas = canvas;
    this.net = net;
    this.audio = audio;
    this.settings = settings;
    this.hud = hud;
    this.hooks = {};
    this.active = false;
    this.lockAllowed = true;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov || 78, 1, 0.03, 500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(55, 1, 0.02, 8);
    this.viewScene.add(new THREE.AmbientLight(0xd6e6f7, 2.4));
    const key = new THREE.DirectionalLight(0xfff0db, 3.4);
    key.position.set(-1.2, 2.0, 1.4);
    this.viewScene.add(key);
    const rim = new THREE.DirectionalLight(0x7fe0ff, 2.0);
    rim.position.set(1.6, 0.6, -1.4);
    this.viewScene.add(rim);

    this.upscaler = new Upscaler(this.renderer);
    this.upscaler.setPreset(settings.upscale || 'quality', settings.dynamicRes !== false);

    this.world = null;
    this.worldMeshes = null;
    this.players = new Map();
    this.effects = { tracers: [], impacts: [], explosions: [], decals: [] };
    this.bombGroup = null;
    this.nadeMeshes = [];
    this.keys = new Set();
    this.firing = false;
    this.fireQueued = false;
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.vmKick = 0;
    this.shake = 0;
    this.scoped = false;
    this.scopeT = 0;
    this.localCooldown = 0;
    this.shotIndex = 0;
    this.lastLocalShot = -9;
    this.slot = 1;
    this.fps = 60;
    this.frameTimes = [];
    this.time = 0;
    this.flashTime = 0;
    this.footTimer = 0;
    this.lastPhase = null;
    this.stepDist = 0;
    this.lastAlive = true;
    this.deathFrom = '';
    this.resultsShown = false;
    this.matchEnded = false;
    this.roomInfo = null;
    this.mapData = null;
    this.pendingWorldDispose = null;
    this.upscaleClock = 0;

    this.bindEvents();
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.hooks.onPointerLock?.(locked);
      if (!locked) { this.firing = false; this.keys.clear(); }
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement !== this.canvas) {
        if (this.lockAllowed) this.requestLock();
        return;
      }
      if (e.button === 0) { this.firing = true; this.fireQueued = true; }
      if (e.button === 2) this.toggleScope();
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas || !this.active) return;
      const sens = (this.settings.sensitivity || 1) * 0.0019 * (this.scoped ? 0.55 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch = clamp(this.pitch - e.movementY * sens, -89, 89);
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
      this.lookX = (this.lookX || 0) + e.movementX;
      this.lookY = (this.lookY || 0) + e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.active && document.pointerLockElement === this.canvas) this.fireQueued = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (['Tab', 'Space', 'KeyB'].includes(e.code) && document.pointerLockElement === this.canvas) e.preventDefault();
      if (e.code === 'Escape') { this.hooks.onKey?.('Escape'); return; }
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Digit1') this.slot = 1;
      if (e.code === 'Digit2') this.slot = 2;
      if (e.code === 'Digit3') this.slot = 3;
      if (e.code === 'KeyG') this.throwGrenade();
      if (['KeyB', 'Tab', 'Enter', 'KeyT', 'F1', 'KeyM'].includes(e.code)) this.hooks.onKey?.(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.hooks.onKey?.('TabUp');
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; });
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const out = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (out?.catch) out.catch(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock();
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    this.upscaler.resize();
  }

  applySettings(settings) {
    this.settings = settings;
    this.camera.fov = settings.fov || 78;
    if (!this.scoped) this.camera.updateProjectionMatrix();
    this.audio.setVolume(settings.volume ?? 0.65);
    this.upscaler.setPreset(settings.upscale || 'quality', settings.dynamicRes !== false);
    this.renderer.shadowMap.enabled = settings.shadows !== false && settings.quality === 'high';
    if (this.world?.sun) this.world.sun.castShadow = settings.shadows !== false && settings.quality === 'high';
    this.resize();
  }

  // ------------------------------------------------------------------- world
  start(roomInfo, mapData, joinData) {
    this.stop(true);
    this.roomInfo = roomInfo;
    this.mapData = mapData;
    this.net.enterRoom(joinData);
    const quality = this.settings.quality || 'high';
    this.renderer.shadowMap.enabled = quality === 'high' && this.settings.shadows !== false;
    this.world = buildWorld(mapData, quality);
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.Fog(
      new THREE.Color(this.world.theme.fog || '#1b2432'),
      this.world.theme.fogNear ?? 30,
      this.world.theme.fogFar ?? 130,
    );
    this.buildBomb();
    this.buildEffects();
    this.sitesVisible(this.net.room.mode === 'bomb');
    this.players.forEach((p) => p.dispose());
    this.players.clear();
    this.lastPhase = null;
    this.resultsShown = false;
    this.matchEnded = false;
    this.scoped = false;
    this.hud?.setScope(false);
    this.scopeT = 0;
    this.updateViewmodel(true);
    this.active = true;
    this.lockAllowed = true;
    this.resize();
  }

  stop(keepNet = false) {
    this.active = false;
    this.firing = false;
    this.keys.clear();
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      this.world = null;
      this.scene.fog = null;
    }
    this.players.forEach((p) => p.dispose());
    this.players.clear();
    if (this.vm) {
      this.viewScene.remove(this.vm.group);
      this.vm.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.vm = null;
    }
    if (this.bombGroup) { this.scene.remove(this.bombGroup); this.bombGroup = null; }
    for (const n of this.nadeMeshes) this.scene.remove(n);
    this.nadeMeshes = [];
    this.disposeEffects();
    this.hud?.setScope(false);
    if (!keepNet) this.net.leaveLocal();
  }

  buildBomb() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.26, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.5 }),
    );
    group.add(body);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.05, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 2 }),
    );
    strip.position.set(0, 0.02, -0.17);
    group.add(strip);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff2211, emissive: 0xff2200, emissiveIntensity: 3 }),
    );
    led.position.set(0.14, 0.16, 0);
    group.add(led);
    this.bombLed = led;
    const light = new THREE.PointLight(0xff3a22, 1.4, 5, 2);
    light.position.copy(led.position);
    group.add(light);
    this.bombLight = light;
    group.visible = false;
    this.bombGroup = group;
    this.scene.add(group);
  }

  sitesVisible(show) {
    if (!this.world) return;
    for (const s of this.world.sites || []) {
      s.visible = show;
      if (s.parent) {
        const label = s.parent.children.find((c) => c.isSprite && Math.abs(c.position.x - s.position.x) < 0.01 && Math.abs(c.position.z - s.position.z) < 0.01);
        if (label) label.visible = show;
      }
    }
  }

  // ----------------------------------------------------------------- effects
  buildEffects() {
    this.disposeEffects();
    this.glowTex = this.glowTex || glowTexture();
    const tracerGeo = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      return g;
    };
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.LineBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(tracerGeo(), mat);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.effects.tracers.push({ line, life: 0 });
    }
    for (let i = 0; i < 28; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffcf8a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
      }));
      sprite.visible = false;
      sprite.scale.set(0.4, 0.4, 1);
      this.scene.add(sprite);
      this.effects.impacts.push({ sprite, life: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshBasicMaterial({ color: 0xffb166, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.effects.explosions.push({ mesh, life: 0 });
    }
    this.holeTex = this.holeTex || holeTexture();
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.26, 0.26),
        new THREE.MeshBasicMaterial({ map: this.holeTex, transparent: true, depthWrite: false, opacity: 0 }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.effects.decals.push({ mesh, life: 0 });
    }
  }

  disposeEffects() {
    if (!this.effects) return;
    for (const t of this.effects.tracers) { this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); }
    for (const i of this.effects.impacts) { this.scene.remove(i.sprite); i.sprite.material.dispose(); }
    for (const e of this.effects.explosions) { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
    for (const d of this.effects.decals) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); }
    this.effects = { tracers: [], impacts: [], explosions: [], decals: [] };
  }

  spawnTracer(from, to, color = 0xffe0a8) {
    const slot = this.effects.tracers.find((t) => t.life <= 0) || this.effects.tracers[0];
    if (!slot) return;
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from[0], from[1], from[2]);
    pos.setXYZ(1, to[0], to[1], to[2]);
    pos.needsUpdate = true;
    slot.line.material.color.set(color);
    slot.line.material.opacity = 0.85;
    slot.line.visible = true;
    slot.life = 0.075;
  }

  spawnImpact(pos, normal = null, color = 0xffbb77) {
    const slot = this.effects.impacts.find((i) => i.life <= 0);
    if (slot) {
      slot.sprite.position.set(pos[0], pos[1], pos[2]);
      slot.sprite.material.color.set(color);
      slot.sprite.material.opacity = 0.9;
      slot.sprite.scale.setScalar(0.25 + Math.random() * 0.2);
      slot.sprite.visible = true;
      slot.life = 0.16;
    }
    if (normal && Math.random() < 0.7) {
      const d = this.effects.decals.find((x) => x.life <= 0);
      if (d) {
        d.mesh.position.set(pos[0] + normal[0] * 0.02, pos[1] + normal[1] * 0.02, pos[2] + normal[2] * 0.02);
        d.mesh.lookAt(pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]);
        d.mesh.material.opacity = 0.9;
        d.mesh.visible = true;
        d.life = 14;
      }
    }
  }

  spawnExplosion(pos) {
    const slot = this.effects.explosions.find((e) => e.life <= 0) || this.effects.explosions[0];
    if (!slot) return;
    slot.mesh.position.set(pos[0], pos[1] + 0.6, pos[2]);
    slot.mesh.scale.setScalar(0.4);
    slot.mesh.material.opacity = 0.95;
    slot.mesh.visible = true;
    slot.life = 0.55;
    this.shake = Math.max(this.shake, 0.5);
  }

  updateEffects(dt) {
    for (const t of this.effects.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.075) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const i of this.effects.impacts) {
      if (i.life <= 0) continue;
      i.life -= dt;
      i.sprite.material.opacity = Math.max(0, i.life / 0.16);
      i.sprite.scale.multiplyScalar(1 + dt * 4);
      if (i.life <= 0) i.sprite.visible = false;
    }
    for (const e of this.effects.explosions) {
      if (e.life <= 0) continue;
      e.life -= dt;
      const t = 1 - Math.max(0, e.life) / 0.55;
      e.mesh.scale.setScalar(0.4 + t * 4.2);
      e.mesh.material.opacity = Math.max(0, 0.95 - t) * 0.9;
      if (e.life <= 0) e.mesh.visible = false;
    }
    for (const d of this.effects.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.9;
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  // ---------------------------------------------------------------- viewmodel
  updateViewmodel(force = false) {
    const me = this.net.me;
    const id = me?.active || 'p9';
    if (!force && this.vm && this.vm.group.userData.weapon === id) return;
    if (this.vm) {
      this.viewScene.remove(this.vm.group);
      this.vm.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const finish = this.finishFor(id);
    this.vm = buildViewModel(id, finish);
    this.vm.group.scale.setScalar(0.72);
    this.vm.group.position.set(0.26, -0.23, -0.6);
    this.vm.group.rotation.set(0, 0.06, 0);
    this.viewScene.add(this.vm.group);
    this.vmKick = 0;
    this.vmDrop = 1;
    const flashMat = new THREE.SpriteMaterial({
      map: this.glowTex || (this.glowTex = glowTexture()),
      color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.vmFlash = new THREE.Sprite(flashMat);
    this.vmFlash.scale.set(0.5, 0.5, 1);
    this.vmFlash.position.set(0, 0.02, -0.08);
    this.vmFlash.visible = false;
    this.vm.muzzle.add(this.vmFlash);
    this.vmLight = new THREE.PointLight(0xffbb66, 0, 3.5, 2);
    this.vm.muzzle.add(this.vmLight);
  }

  finishFor(weaponId) {
    const eq = this.net.profile?.equipped || {};
    if (weaponId === 'knife') return eq.finishKnife || 'stock';
    if (WEAPONS[weaponId]?.slot === 2) return eq.finishSecondary || 'stock';
    return eq.finishPrimary || 'stock';
  }

  fireVisual(weapon) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation).normalize();
    const spread = (this.net.approximateSpread() + Math.min(this.shotIndex, 12) * 0.09) * DEG;
    const pellets = weapon.pellets || 1;
    for (let i = 0; i < Math.min(pellets, 6); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const d = dir.clone();
      d.x += Math.cos(a) * r;
      d.y += Math.sin(a) * r;
      d.z += (Math.random() - 0.5) * r * 0.2;
      d.normalize();
      const target = this.net.traceVisual([origin.x, origin.y, origin.z], [d.x, d.y, d.z], weapon.range || 100);
      const muzzleWorld = new THREE.Vector3();
      this.vm?.muzzle.getWorldPosition(muzzleWorld);
      const fromView = [muzzleWorld.x, muzzleWorld.y, muzzleWorld.z];
      const start = [origin.x + d.x * 0.5, origin.y + d.y * 0.5 - 0.12, origin.z + d.z * 0.5];
      this.spawnTracer(start, target.end, this.tracerColor());
      if (target.dist < (weapon.range || 100) - 0.1) {
        this.spawnImpact(target.end, target.normal, 0xffcf8a);
      }
    }
    this.audio.shoot(weapon.sound, null);
    this.flashTime = 0.045;
    if (this.vmFlash) { this.vmFlash.visible = true; this.vmFlash.rotation.z = Math.random() * Math.PI; }
    if (this.vmLight) this.vmLight.intensity = 6;
    this.recoilPitch += weapon.recoil * 0.22;
    this.recoilYaw += (Math.random() - 0.5) * weapon.recoil * 0.12;
    this.vmKick = Math.min(0.16, this.vmKick + weapon.recoil * 0.02 + 0.03);
    this.shake = Math.min(0.25, this.shake + weapon.recoil * 0.012);
  }

  tracerColor() {
    const eq = this.net.profile?.equipped || {};
    const t = TRACERS.find((x) => x.id === (eq.tracer || 'white')) || TRACERS[0];
    if (t.rainbow) return new THREE.Color().setHSL((performance.now() / 900) % 1, 0.9, 0.65).getHex();
    return new THREE.Color(t.color).getHex();
  }

  toggleScope() {
    const w = WEAPONS[this.net.me?.active];
    if (!w?.scope) return;
    this.scoped = !this.scoped;
    this.hud?.setScope(this.scoped);
  }

  throwGrenade() {
    if (!this.net.me?.alive) return;
    if (this.net.me.grenades <= 0) return;
    this.net.throwGrenade(this.yaw, this.pitch);
    this.audio.shoot('throw', null);
    this.vmKick = 0.1;
  }

  // ------------------------------------------------------------------- input
  inputState() {
    let buttons = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) buttons |= BTN.FORWARD;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) buttons |= BTN.BACK;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) buttons |= BTN.LEFT;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) buttons |= BTN.RIGHT;
    if (this.keys.has('Space')) buttons |= BTN.JUMP;
    if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) buttons |= BTN.CROUCH;
    if (this.keys.has('ShiftLeft')) buttons |= BTN.WALK;
    if (this.keys.has('KeyR')) buttons |= BTN.RELOAD;
    if (this.keys.has('KeyE')) buttons |= BTN.USE;
    if (this.firing) buttons |= BTN.FIRE;
    return {
      buttons,
      yaw: this.yaw,
      pitch: this.pitch,
      slot: this.slot,
      scope: this.scoped ? 1 : 0,
    };
  }

  // -------------------------------------------------------------------- loop
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    if (!this.active) return;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.fps = 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
    this.time += dt;
    this.update(dt);
    this.upscaler.adapt(dt * 1000);
    this.upscaler.render(this.scene, this.camera, this.viewScene, this.viewCamera);
  }

  update(dt) {
    const net = this.net;
    if (!net.local || !net.me) return;

    const me = net.me;
    if (!me.alive) {
      this.firing = false;
      if (this.scoped) { this.scoped = false; this.hud?.setScope(false); }
      this.lastAlive = false;
    } else if (!this.lastAlive) {
      this.lastAlive = true;
      this.hud?.hideDeath?.();
      this.scoped = false;
      this.hud?.setScope(false);
      this.vmDrop = 1;
    }

    net.update(dt, this.inputState());
    this.updateViewmodel();

    const local = net.local;
    const eye = eyeHeight(local.crouchAmount);
    const speed = Math.hypot(local.vel[0], local.vel[2]);
    const bobAmp = local.onGround ? Math.min(speed / PHYS.maxSpeed, 1) * 0.032 : 0;
    const bob = Math.sin(local.stepPhase * 2) * bobAmp;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.recoilPitch *= Math.exp(-dt * 9);
    this.recoilYaw *= Math.exp(-dt * 9);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.05;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.05;
    const px = local.pos[0] + net.correction[0];
    const py = local.pos[1] + eye + bob + net.correction[1];
    const pz = local.pos[2] + net.correction[2];
    this.camera.position.set(px + shakeX, py + shakeY, pz);
    this.camera.rotation.set(
      clamp(this.pitch + this.recoilPitch, -89, 89) * DEG,
      this.yaw + this.recoilYaw * 0.2,
      Math.sin(local.stepPhase) * 0.006 * Math.min(speed / PHYS.maxSpeed, 1),
      'YXZ',
    );

    const scopeTarget = this.scoped ? 1 : 0;
    this.scopeT += (scopeTarget - this.scopeT) * Math.min(1, dt * 14);
    const baseFov = this.settings.fov || 78;
    this.camera.fov = baseFov + (42 - baseFov) * this.scopeT;
    this.camera.updateProjectionMatrix();

    this.updateLocalWeapon(dt);
    this.updateRemotePlayers(dt);
    this.updateWorldObjects(dt);
    this.updateEffects(dt);
    this.updateFootsteps(dt);

    const zoom = 1 - this.scopeT * 0.35;
    this.viewCamera.fov = 55 * zoom;
    this.viewCamera.updateProjectionMatrix();
    this.audio.setListener(px, py, pz, this.yaw);
    this.upscaleClock += dt;
    if (this.upscaleClock > 0.2) { this.upscaleClock = 0; this.hud?.setPerf?.(this); }
    this.hud?.update?.(this);
    if (me.alive) this.updatePhaseNotifications();
  }

  updatePhaseNotifications() {
    const latest = this.net.latest;
    if (!latest) return;
    if (latest.phase !== this.lastPhase) {
      this.lastPhase = latest.phase;
      if (latest.phase === 'ended' && !this.resultsShown) {
        this.resultsShown = true;
        this.matchEnded = true;
        this.firing = false;
        this.lockAllowed = false;
        this.releaseLock();
        this.hud?.showResults?.(this);
      }
    }
  }

  updateLocalWeapon(dt) {
    const me = this.net.me;
    const vm = this.vm;
    if (!vm) return;
    const weapon = WEAPONS[me?.active] || WEAPONS.p9;
    const alive = !!me?.alive;
    vm.group.visible = alive && !this.scoped;
    if (!alive) return;

    if (this.localCooldown > 0) this.localCooldown -= dt;
    if (this.time - this.lastLocalShot > 0.55 && this.shotIndex > 0) this.shotIndex = 0;

    if (this.firing && (weapon.automatic || this.fireQueued)) {
      const hasAmmo = weapon.slot === 3 || (me.mag > 0);
      if (this.localCooldown <= 0 && hasAmmo && (me.reloadIn || 0) <= 0) {
        this.fireQueued = false;
        this.localCooldown = 60 / weapon.rpm;
        this.lastLocalShot = this.time;
        this.shotIndex++;
        this.fireVisual(weapon);
        if (weapon.slot === 3) this.vmKick = 0.14;
      }
    }
    if (!this.firing) this.fireQueued = false;

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) {
        if (this.vmFlash) this.vmFlash.visible = false;
        if (this.vmLight) this.vmLight.intensity = 0;
      }
    }

    // movement bob + sway
    const local = this.net.local;
    const speed = Math.hypot(local.vel[0], local.vel[2]);
    const norm = Math.min(speed / PHYS.maxSpeed, 1);
    this.lookX = (this.lookX || 0) * 0.86;
    this.lookY = (this.lookY || 0) * 0.86;
    const swayX = clamp(-this.lookX * 0.0005, -0.05, 0.05);
    const swayY = clamp(this.lookY * 0.0005, -0.05, 0.05);
    this.vmKick = Math.max(0, this.vmKick - dt * 0.7);
    this.vmDrop = Math.max(0, (this.vmDrop || 0) - dt * 4);
    const reloadTotal = me.reloadTotal || weapon.reload || 1;
    const reloadP = me.reloadIn > 0 ? 1 - me.reloadIn / reloadTotal : 0;
    const reloadDip = me.reloadIn > 0 ? Math.sin(reloadP * Math.PI) : 0;
    const baseY = -0.23 + Math.sin(local.stepPhase * 2) * 0.014 * norm + swayY - reloadDip * 0.2 - this.vmDrop * 0.35;
    const baseX = 0.26 + Math.sin(local.stepPhase) * 0.012 * norm + swayX;
    const baseZ = -0.6 + this.vmKick * 1.1;
    vm.group.position.set(baseX, baseY, baseZ);
    vm.group.rotation.x = -this.vmKick * 0.9 + reloadDip * 0.9;
    vm.group.rotation.z = reloadDip * 0.5 + swayX * 0.8;
    vm.group.rotation.y = 0.06 + swayX * 1.4;
    if (weapon.slot === 3 && this.firing && this.localCooldown > 60 / weapon.rpm - 0.1) {
      vm.group.rotation.y += 0.6;
    }
  }

  updateRemotePlayers(dt) {
    const list = this.net.getRemotePlayers();
    const seen = new Set();
    for (const info of list) {
      seen.add(info.id);
      let view = this.players.get(info.id);
      if (!view) { view = new RemotePlayer(this.scene); this.players.set(info.id, view); }
      info.vel = view.lastVel || [0, 0, 0];
      view.lastVel = [info.pos[0] - (view.lastX ?? info.pos[0]), 0, info.pos[2] - (view.lastZ ?? info.pos[2])];
      view.update(info, dt);
    }
    for (const [id, view] of this.players) {
      if (!seen.has(id)) { view.dispose(); this.players.delete(id); }
    }
  }

  muzzleFor(id) {
    const view = this.players.get(id);
    if (!view) return null;
    return view;
  }

  updateWorldObjects(dt) {
    const snap = this.net.latest;
    if (!snap) return;
    // bomb
    if (this.bombGroup) {
      if (snap.bomb) {
        this.bombGroup.visible = true;
        this.bombGroup.position.set(snap.bomb.x, snap.bomb.y + 0.13, snap.bomb.z);
        const t = snap.bomb.t;
        const blink = Math.sin(this.time * (12 - Math.min(9, 20 / Math.max(1, t)))) > 0;
        if (this.bombLed) this.bombLed.visible = blink;
        if (this.bombLight) this.bombLight.intensity = blink ? 1.6 : 0.15;
        if (!this.lastBeep || this.time - this.lastBeep > Math.max(0.16, Math.min(1, t / 12))) {
          this.lastBeep = this.time;
          this.audio.beep(t < 10);
        }
      } else {
        this.bombGroup.visible = false;
      }
    }
    // grenades
    const nades = snap.nades || [];
    while (this.nadeMeshes.length < nades.length) {
      const mesh = new THREE.Mesh(geometries().nade, new THREE.MeshStandardMaterial({
        color: 0x33402c, metalness: 0.5, roughness: 0.6,
        emissive: 0x2b7a22, emissiveIntensity: 0.6,
      }));
      this.scene.add(mesh);
      this.nadeMeshes.push(mesh);
    }
    for (let i = 0; i < this.nadeMeshes.length; i++) {
      const mesh = this.nadeMeshes[i];
      const n = nades[i];
      mesh.visible = !!n;
      if (n) mesh.position.set(n[0], n[1], n[2]);
    }
    // hill
    if (this.world?.hills?.length) {
      const hill = snap.hill;
      for (const ring of this.world.hills) {
        if (!hill) { ring.visible = false; continue; }
        const active = Math.hypot(ring.position.x - hill.x, ring.position.z - hill.z) < 1;
        ring.visible = active;
        if (active) {
          const color = hill.owner === 0 ? TEAM_INFO[0].color : hill.owner === 1 ? TEAM_INFO[1].color : 0x5ce1ff;
          ring.material.color.setHex(color);
          ring.material.opacity = 0.35 + Math.sin(this.time * 3) * 0.08;
        }
      }
    }
    const mode = this.net.room?.mode;
    this.sitesVisible(mode === 'bomb');
  }

  updateFootsteps(dt) {
    const local = this.net.local;
    const speed = Math.hypot(local.vel[0], local.vel[2]);
    if (local.onGround && speed > 2.4 && this.net.me?.alive) {
      this.footTimer -= dt * speed;
      if (this.footTimer <= 0) {
        this.footTimer = 1.7;
        this.audio.footstep(null, local.crouchAmount > 0.5);
      }
    }
    for (const [id, view] of this.players) {
      if (!view.group.visible || view.dead) continue;
      const moved = Math.hypot(view.lastVel?.[0] || 0, view.lastVel?.[2] || 0);
      if (moved > 0.08) {
        view.footDist = (view.footDist || 0) + moved;
        if (view.footDist > 2.1) { view.footDist = 0; this.audio.footstep([view.group.position.x, view.group.position.y, view.group.position.z]); }
      }
    }
  }

  // ------------------------------------------------------------------ events
  onGlobalEvent(ev, snap) {
    if (!ev) return;
    switch (ev.k) {
      case 'shot': {
        if (ev.id === this.net.youId) break;
        const tracer = this.tracerColorFor(ev.id);
        this.spawnTracer(ev.o, ev.e, tracer);
        this.audio.shoot(WEAPONS[ev.w]?.sound || 'rifle', ev.o);
        this.muzzleFor(ev.id)?.flashMuzzle();
        break;
      }
      case 'kill': {
        this.hud?.killfeed?.(ev);
        if (ev.killer === this.net.youId) this.audio.kill();
        if (ev.victim === this.net.youId) {
          this.deathFrom = this.net.rosterById.get(ev.killer)?.name || '?';
          this.hud?.showDeath?.(this.deathFrom, ev.w, ev.hs);
        }
        break;
      }
      case 'boom': {
        this.spawnExplosion(ev.pos);
        this.audio.explosion(ev.pos);
        break;
      }
      case 'explode': {
        this.spawnExplosion([ev.pos[0], ev.pos[1] + 0.5, ev.pos[2]]);
        this.audio.explosion(ev.pos);
        this.shake = 0.9;
        break;
      }
      case 'plant': this.audio.plant(); this.hud?.showBanner?.('SPIKE PLANTED', `SITE ${ev.site} · 40s`, 2600, 'danger'); break;
      case 'defuse': this.audio.defuse(); this.hud?.showBanner?.('SPIKE DEFUSED', 'ROUND SECURED', 2200, 'good'); break;
      case 'nade': this.audio.shoot('throw', ev.pos); break;
      case 'roundStart': this.audio.roundStart(); this.hud?.showBanner?.(`ROUND ${ev.round}`, '', 1500, 'neutral'); break;
      case 'live': this.hud?.showBanner?.('LIVE', 'ENGAGE', 900, 'neutral'); break;
      case 'roundEnd': {
        const mine = this.net.me?.team;
        const win = mine !== undefined && ev.winner === mine;
        this.hud?.showBanner?.(win ? 'ROUND WON' : 'ROUND LOST', ev.reason || '', 3000, win ? 'good' : 'danger');
        break;
      }
      case 'halftime': this.hud?.showBanner?.('SIDE SWAP', 'ROLES REVERSED', 3000, 'neutral'); break;
      case 'matchEnd': {
        const mine = this.net.me?.team;
        const win = mine !== undefined && (ev.winner === mine || ev.winner === this.net.youId);
        this.hud?.showEndBanner?.(win, ev);
        break;
      }
      case 'hill': this.hud?.showBanner?.('HILL MOVING', ev.label || '', 1600, 'neutral'); this.audio.ui(true); break;
      case 'level': this.audio.ui(true); break;
      case 'restart': this.hud?.hideResults?.(); this.resultsShown = false; break;
      default: break;
    }
  }

  onPersonalEvent(ev) {
    if (!ev) return;
    switch (ev.k) {
      case 'hit':
        this.hud?.hitmarker?.(!!ev.hs);
        this.audio.hitmarker(!!ev.hs);
        break;
      case 'dmg': {
        this.hud?.damageFrom?.(ev.dir);
        this.audio.hurt();
        this.shake = Math.min(0.6, this.shake + 0.18);
        break;
      }
      case 'spawn': {
        this.deathFrom = '';
        this.scoped = false;
        this.hud?.setScope?.(false);
        this.hud?.hideDeath?.();
        this.vmDrop = 1;
        this.spawnTracer([ev.pos[0], ev.pos[1] + 1, ev.pos[2]], [ev.pos[0], ev.pos[1] + 1.01, ev.pos[2]], 0x9fe8ff);
        break;
      }
      case 'reload': this.audio.reload(ev.dur || 2); break;
      case 'levelup': this.audio.levelUp(); this.hud?.showBanner?.(`GUN GAME · TIER ${ev.level + 1}`, WEAPONS[ev.w]?.name || '', 2000, 'good'); break;
      case 'backstab': this.hud?.showBanner?.('BACKSTAB', '', 900, 'danger'); break;
      default: break;
    }
  }

  tracerColorFor(id) {
    const entry = this.net.rosterById.get(id);
    const tracerId = entry?.equipped?.tracer || 'white';
    const t = TRACERS.find((x) => x.id === tracerId) || TRACERS[0];
    if (t.rainbow) return new THREE.Color().setHSL((performance.now() / 800) % 1, 0.9, 0.65).getHex();
    return new THREE.Color(t.color).getHex();
  }

  getStats() {
    return {
      fps: this.fps,
      upscale: this.upscaler.getStatus(),
      ping: this.net.rtt,
      jitter: this.net.jitter,
      bytes: this.net.stats.bytes,
      snapshots: this.net.stats.snapshots,
    };
  }
}
