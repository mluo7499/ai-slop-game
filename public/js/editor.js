// MapLAB — a grid-snapped 3D box editor with spawns, bombsites and KOTH hills.
import * as THREE from 'three';
import { MATERIAL_META } from './world.js';
import { TEAM_INFO, clamp } from '/shared/constants.js';

const PALETTE = ['floor', 'concrete', 'metal', 'deck', 'hazard', 'crate', 'containerA', 'containerB', 'neonCyan', 'neonOrange', 'snow', 'rock'];

function defaultMap() {
  const blocks = [];
  const B = (x, y, z, w, h, d, m) => blocks.push({ x, y, z, w, h, d, m, solid: true });
  B(0, -0.5, 0, 64, 1, 64, 'floor');
  B(0, 3, -33, 68, 6, 2, 'concrete');
  B(0, 3, 33, 68, 6, 2, 'concrete');
  B(-33, 3, 0, 2, 6, 68, 'concrete');
  B(33, 3, 0, 2, 6, 68, 'concrete');
  B(0, 0.9, 0, 16, 1.8, 12, 'metal');
  B(0, 2.1, -6.6, 16, 0.4, 1.2, 'hazard');
  B(0, 2.1, 6.6, 16, 0.4, 1.2, 'hazard');
  B(-22, 2.5, -22, 10, 5, 10, 'concrete');
  B(22, 2.5, 22, 10, 5, 10, 'concrete');
  B(-22, 2.5, 22, 10, 5, 10, 'containerA');
  B(22, 2.5, -22, 10, 5, 10, 'containerB');
  B(-14, 0.7, 14, 2, 1.4, 10, 'hazard');
  B(14, 0.7, -14, 2, 1.4, 10, 'hazard');
  const spawns = [];
  for (let i = 0; i < 5; i++) {
    spawns.push({ x: -10 + i * 5, y: 0, z: 28, team: 0 });
    spawns.push({ x: -10 + i * 5, y: 0, z: -28, team: 1 });
  }
  return {
    name: 'MY ARENA', tagline: 'Player-built arena', halfX: 32, halfZ: 32,
    blocks, spawns,
    sites: [{ x: -18, z: -18, r: 5, label: 'A' }, { x: 18, z: 18, r: 5, label: 'B' }],
    hills: [{ x: 0, z: 0, r: 7, label: 'CENTER' }, { x: -20, z: 20, r: 6, label: 'WEST' }, { x: 20, z: -20, r: 6, label: 'EAST' }],
    theme: {
      skyTop: '#1a2740', skyBottom: '#e0803f', fog: '#38435c', fogNear: 30, fogFar: 140,
      sun: [0.45, 0.35, 0.2], sunColor: '#ffd7a8', sunIntensity: 2.1, ambient: '#7d8ba8',
    },
  };
}

export class MapEditor {
  constructor({ onExit, onTest, onPublish }) {
    this.canvas = document.getElementById('editor-canvas');
    this.onExit = onExit;
    this.onTest = onTest;
    this.onPublish = onPublish;
    this.active = false;
    this.tool = 'place';
    this.material = 'concrete';
    this.map = defaultMap();
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.theta = Math.PI * 0.25;
    this.phi = 0.95;
    this.radius = 64;
    this.keys = new Set();
    this.dragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.mouse = { x: 0, y: 0 };
    this.materials = new Map();
    this.setup();
    this.bindUI();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  setup() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#080c12');
    this.scene.fog = new THREE.Fog('#080c12', 80, 190);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
    this.scene.add(new THREE.HemisphereLight(0xbcd4ee, 0x20242c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(36, 58, 22);
    this.scene.add(sun);
    const grid = new THREE.GridHelper(100, 100, 0x3a4a5c, 0x1b2634);
    grid.position.y = 0.01;
    this.scene.add(grid);
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);

    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x58f0a8, transparent: true, opacity: 0.28, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.button === 2) {
        this.dragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 0) {
        this.place();
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) { this.dragging = false; try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (this.dragging) {
        this.theta -= (e.clientX - this.lastMouse.x) * 0.006;
        this.phi = clamp(this.phi - (e.clientY - this.lastMouse.y) * 0.005, 0.2, 1.45);
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
      this.updateGhost();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.radius = clamp(this.radius * (1 + Math.sign(e.deltaY) * 0.08), 10, 150);
    }, { passive: false });
    this.canvas.addEventListener('pointerleave', () => { this.ghost.visible = false; });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  bindUI() {
    const mats = document.getElementById('ed-materials');
    mats.innerHTML = '';
    for (const id of PALETTE) {
      const meta = MATERIAL_META[id] || MATERIAL_META.concrete;
      const btn = document.createElement('button');
      btn.className = `mat-swatch${id === this.material ? ' active' : ''}`;
      btn.dataset.mat = id;
      btn.title = id.toUpperCase();
      btn.style.background = `linear-gradient(140deg, ${meta.color}, ${meta.emissive || '#0b0f14'})`;
      btn.addEventListener('click', () => {
        this.material = id;
        mats.querySelectorAll('.mat-swatch').forEach((b) => b.classList.toggle('active', b === btn));
      });
      mats.appendChild(btn);
    }
    document.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tool = btn.dataset.tool;
        document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b === btn));
        this.updateGhost();
      });
    });
    const getShape = () => ({
      w: clamp(Number(document.getElementById('ed-w').value) || 4, 1, 32),
      h: clamp(Number(document.getElementById('ed-h').value) || 3, 0.4, 24),
      d: clamp(Number(document.getElementById('ed-d').value) || 4, 1, 32),
      y: clamp(Number(document.getElementById('ed-y').value) || 0, 0, 60),
    });
    for (const id of ['ed-w', 'ed-h', 'ed-d', 'ed-y']) {
      document.getElementById(id).addEventListener('input', () => this.updateGhost());
    }
    document.getElementById('ed-name').addEventListener('input', (e) => { this.map.name = e.target.value.toUpperCase().slice(0, 28); });
    document.getElementById('ed-exit').addEventListener('click', () => this.exit());
    document.getElementById('ed-save').addEventListener('click', () => this.saveLocal());
    document.getElementById('ed-publish').addEventListener('click', () => {
      this.status('PUBLISHING…');
      this.onPublish?.(this.serialize());
    });
    document.getElementById('ed-test').addEventListener('click', () => {
      const map = this.serialize();
      if (!this.validate(map)) return;
      this.close();
      this.onTest?.(map);
    });
    document.getElementById('ed-clear').addEventListener('click', () => {
      if (!confirm('Clear all blocks? Spawns and objectives stay.')) return;
      this.map.blocks = [];
      this.rebuild();
    });
    document.getElementById('ed-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(this.map.name || 'map').toLowerCase().replace(/\s+/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.status('EXPORTED');
    });
    document.getElementById('ed-import').addEventListener('click', () => document.getElementById('ed-file').click());
    document.getElementById('ed-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        this.load(raw);
        this.status('IMPORTED');
      } catch { this.status('IMPORT FAILED'); }
      e.target.value = '';
    });
    document.getElementById('ed-test').title = 'Launch a private room with this map';
  }

  status(text) {
    const el = document.getElementById('ed-status');
    if (el) el.textContent = text;
    setTimeout(() => { if (el.textContent === text) el.textContent = 'READY'; }, 2600);
  }

  open(map) {
    this.active = true;
    this.map = map ? structuredClone(map) : defaultMap();
    document.getElementById('ed-name').value = this.map.name || 'MY ARENA';
    this.updateCounts();
    this.rebuild();
    this.resize();
  }

  close() {
    this.active = false;
  }

  exit() {
    this.close();
    this.onExit?.();
  }

  resize() {
    if (!this.active) return;
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth || 800;
    const h = parent.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getMaterial(id) {
    if (this.materials.has(id)) return this.materials.get(id);
    const meta = MATERIAL_META[id] || MATERIAL_META.concrete;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(meta.color),
      metalness: meta.metalness ?? 0.1,
      roughness: meta.roughness ?? 0.9,
      emissive: meta.emissive ? new THREE.Color(meta.emissive) : 0x000000,
      emissiveIntensity: meta.emissiveIntensity || 0,
    });
    this.materials.set(id, mat);
    return mat;
  }

  rebuild() {
    const group = this.worldGroup;
    group.children.slice().forEach((c) => {
      group.remove(c);
      if (c.geometry) c.geometry.dispose();
    });
    this.map.blocks.forEach((b, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), this.getMaterial(b.m));
      mesh.position.set(b.x, b.y, b.z);
      mesh.userData.blockIndex = i;
      group.add(mesh);
    });
    this.rebuildMarkers();
    this.updateCounts();
  }

  rebuildMarkers() {
    const group = this.markerGroup;
    group.children.slice().forEach((c) => {
      group.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    for (const spawn of this.map.spawns) {
      const color = spawn.team === 0 ? TEAM_INFO[0].color : TEAM_INFO[1].color;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }));
      cone.position.set(spawn.x, spawn.y + 1, spawn.z);
      cone.rotation.x = Math.PI;
      group.add(cone);
    }
    for (const site of this.map.sites || []) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.2, site.r, 40), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.x, 0.06, site.z);
      group.add(ring);
    }
    for (const hill of this.map.hills || []) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(hill.r - 0.15, hill.r, 40), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hill.x, 0.07, hill.z);
      group.add(ring);
    }
  }

  updateCounts() {
    document.getElementById('ed-count').textContent = this.map.blocks.length;
    document.getElementById('ed-spawns').textContent = this.map.spawns.length;
    document.getElementById('ed-sites').textContent = (this.map.sites || []).length;
  }

  shape() {
    return {
      w: clamp(Number(document.getElementById('ed-w').value) || 4, 1, 32),
      h: clamp(Number(document.getElementById('ed-h').value) || 3, 0.4, 24),
      d: clamp(Number(document.getElementById('ed-d').value) || 4, 1, 32),
      y: clamp(Number(document.getElementById('ed-y').value) || 0, 0, 60),
    };
  }

  pointerGround() {
    this.raycaster.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, point)) return null;
    return point;
  }

  updateGhost() {
    if (!this.active) return;
    const point = this.pointerGround();
    if (!point) { this.ghost.visible = false; return; }
    const s = this.shape();
    const x = Math.round(point.x);
    const z = Math.round(point.z);
    this.ghost.scale.set(s.w, s.h, s.d);
    this.ghost.position.set(x, s.y + s.h / 2, z);
    this.ghost.visible = this.tool === 'place';
    this.ghost.material.color.set(this.tool === 'place' ? 0x58f0a8 : 0xff4c5a);
    const hover = document.getElementById('ed-hover');
    if (hover) {
      if (this.tool === 'place') hover.textContent = `PLACE ${this.material.toUpperCase()} · ${s.w}×${s.h}×${s.d} @ ${x}, ${s.y}, ${z}`;
      else if (this.tool === 'erase') hover.textContent = 'CLICK A BLOCK TO DELETE';
      else hover.textContent = `${this.tool.toUpperCase()} @ ${x}, ${z}`;
    }
  }

  place() {
    if (!this.active) return;
    if (this.tool === 'place') {
      const point = this.pointerGround();
      if (!point) return;
      if (this.map.blocks.length >= 1400) return this.status('BLOCK LIMIT 1400');
      const s = this.shape();
      const x = Math.round(point.x);
      const z = Math.round(point.z);
      if (Math.abs(x) > this.map.halfX + 8 || Math.abs(z) > this.map.halfZ + 8) return this.status('OUT OF BOUNDS');
      this.map.blocks.push({ x, y: s.y + s.h / 2, z, w: s.w, h: s.h, d: s.d, m: this.material, solid: true });
      this.rebuild();
      return;
    }
    if (this.tool === 'erase') {
      this.raycaster.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
      const hits = this.raycaster.intersectObjects(this.worldGroup.children, false);
      if (!hits.length) return;
      const idx = hits[0].object.userData.blockIndex;
      if (idx === undefined || idx < 0) return;
      this.map.blocks.splice(idx, 1);
      this.rebuild();
      return;
    }
    const point = this.pointerGround();
    if (!point) return;
    const x = Math.round(point.x);
    const z = Math.round(point.z);
    if (this.tool === 'spawnA' || this.tool === 'spawnB') {
      const team = this.tool === 'spawnA' ? 0 : 1;
      this.map.spawns = this.map.spawns.filter((s) => Math.hypot(s.x - x, s.z - z) > 1.5);
      this.map.spawns.push({ x, y: 0, z, team });
    } else if (this.tool === 'site') {
      if ((this.map.sites || []).length >= 2) this.map.sites.shift();
      this.map.sites = this.map.sites || [];
      this.map.sites.push({ x, z, r: 5, label: String.fromCharCode(65 + this.map.sites.length) });
    } else if (this.tool === 'hill') {
      this.map.hills = this.map.hills || [];
      if (this.map.hills.length >= 3) this.map.hills.shift();
      this.map.hills.push({ x, z, r: 6, label: ['CENTER', 'WEST', 'EAST'][this.map.hills.length % 3] });
    }
    this.rebuildMarkers();
  }

  validate(map) {
    if (!map.blocks.length) { this.status('ADD SOME BLOCKS FIRST'); return false; }
    const hasA = map.spawns.some((s) => s.team === 0);
    const hasB = map.spawns.some((s) => s.team === 1);
    if (!hasA || !hasB) { this.status('NEED SPAWNS FOR BOTH TEAMS'); return false; }
    return true;
  }

  serialize() {
    return {
      name: this.map.name || 'CUSTOM MAP',
      tagline: 'Player-built arena · MapLAB',
      halfX: this.map.halfX, halfZ: this.map.halfZ,
      blocks: this.map.blocks.map((b) => ({ ...b })),
      spawns: this.map.spawns.map((s) => ({ ...s })),
      sites: (this.map.sites || []).map((s, i) => ({ ...s, label: String.fromCharCode(65 + i) })),
      hills: (this.map.hills || []).map((h) => ({ ...h })),
      theme: this.map.theme,
    };
  }

  load(raw) {
    this.map = {
      ...defaultMap(),
      ...structuredClone(raw),
    };
    this.map.name = String(raw.name || 'CUSTOM MAP').toUpperCase().slice(0, 28);
    document.getElementById('ed-name').value = this.map.name;
    this.rebuild();
  }

  saveLocal() {
    localStorage.setItem('slopstrike.editor.map', JSON.stringify(this.serialize()));
    this.status('SAVED LOCALLY');
  }

  loop(now) {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.active) return;
    const move = 34 * dt;
    if (this.keys.has('KeyW')) this.cameraTarget.z -= move;
    if (this.keys.has('KeyS')) this.cameraTarget.z += move;
    if (this.keys.has('KeyA')) this.cameraTarget.x -= move;
    if (this.keys.has('KeyD')) this.cameraTarget.x += move;
    if (this.keys.has('KeyQ')) this.cameraTarget.y = clamp(this.cameraTarget.y - move, -10, 30);
    if (this.keys.has('KeyE')) this.cameraTarget.y = clamp(this.cameraTarget.y + move, -10, 30);
    const cx = this.cameraTarget.x + this.radius * Math.cos(this.phi) * Math.sin(this.theta);
    const cy = this.cameraTarget.y + this.radius * Math.sin(this.phi);
    const cz = this.cameraTarget.z + this.radius * Math.cos(this.phi) * Math.cos(this.theta);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, this.camera);
  }
}
