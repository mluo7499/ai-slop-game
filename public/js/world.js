// Map → Three.js scene. All geometry is merged per material to keep draw calls
// tiny; textures are generated procedurally so the game ships with zero assets.
import * as THREE from 'three';
import { makeWorld } from '/shared/physics.js';

export const MATERIAL_META = {
  floor: { color: '#4d5560', kind: 'panel', metalness: 0.25, roughness: 0.85, scale: 3 },
  floorDark: { color: '#2c333c', kind: 'panel', metalness: 0.4, roughness: 0.7, scale: 3 },
  concrete: { color: '#8a8f96', kind: 'concrete', metalness: 0.05, roughness: 0.95, scale: 2.6 },
  metal: { color: '#525b66', kind: 'brushed', metalness: 0.8, roughness: 0.42, scale: 2.2 },
  deck: { color: '#39424d', kind: 'grate', metalness: 0.6, roughness: 0.55, scale: 1.6 },
  hazard: { color: '#d9b52c', kind: 'hazard', metalness: 0.15, roughness: 0.7, scale: 1.6 },
  crate: { color: '#9a7645', kind: 'wood', metalness: 0.05, roughness: 0.85, scale: 1.4 },
  crateRed: { color: '#9c4536', kind: 'wood', metalness: 0.08, roughness: 0.8, scale: 1.4 },
  containerA: { color: '#9c4536', kind: 'corrugated', metalness: 0.55, roughness: 0.62, scale: 2.4 },
  containerB: { color: '#33628c', kind: 'corrugated', metalness: 0.55, roughness: 0.62, scale: 2.4 },
  containerRed: { color: '#a83c2e', kind: 'corrugated', metalness: 0.5, roughness: 0.66, scale: 2.4 },
  containerGreen: { color: '#3b6b4c', kind: 'corrugated', metalness: 0.5, roughness: 0.66, scale: 2.4 },
  snow: { color: '#dbe7f0', kind: 'snow', metalness: 0.02, roughness: 0.95, scale: 3.2 },
  snowWall: { color: '#b7c6d2', kind: 'concrete', metalness: 0.03, roughness: 0.95, scale: 2.8 },
  rock: { color: '#5e6670', kind: 'rock', metalness: 0.08, roughness: 0.98, scale: 2.2 },
  neonOrange: { color: '#ff7a2f', kind: 'solid', emissive: '#ff5a17', emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.4, scale: 1 },
  neonCyan: { color: '#63ecff', kind: 'solid', emissive: '#2bd8ff', emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.4, scale: 1 },
  neonPink: { color: '#ff5fd2', kind: 'solid', emissive: '#ff2bb8', emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.4, scale: 1 },
  glass: { color: '#a8d8ef', kind: 'solid', metalness: 0.5, roughness: 0.1, scale: 1, transparent: true, opacity: 0.32 },
};

const textureCache = new Map();

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeTexture(kind, color, scale, seed) {
  const key = `${kind}:${color}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(color);
  const r = rand(seed || 7);
  const rgb = (c, m = 1) => `rgb(${Math.round(c.r * 255 * m)},${Math.round(c.g * 255 * m)},${Math.round(c.b * 255 * m)})`;

  ctx.fillStyle = rgb(base);
  ctx.fillRect(0, 0, size, size);

  const noise = (amount, alpha) => {
    for (let i = 0; i < amount; i++) {
      const v = 0.75 + r() * 0.5;
      ctx.fillStyle = `rgba(${Math.round(base.r * 255 * v)},${Math.round(base.g * 255 * v)},${Math.round(base.b * 255 * v)},${alpha})`;
      const s = 1 + r() * 5;
      ctx.fillRect(r() * size, r() * size, s, s);
    }
  };

  if (kind === 'concrete') {
    noise(2600, 0.4);
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = `rgba(30,32,36,${0.1 + r() * 0.16})`;
      ctx.lineWidth = 0.7 + r() * 1.6;
      ctx.beginPath();
      let x = r() * size, y = r() * size;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (r() - 0.5) * 90; y += (r() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(r() * size, r() * size, 20 + r() * 50, 12 + r() * 30, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'panel' || kind === 'grate') {
    noise(1400, 0.3);
    const cells = kind === 'grate' ? 32 : 64;
    ctx.strokeStyle = 'rgba(0,0,0,0.34)';
    ctx.lineWidth = 1.4;
    for (let x = 0; x <= size; x += cells) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(size, x); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= size; x += cells) {
      ctx.beginPath(); ctx.moveTo(x + 1.5, 0); ctx.lineTo(x + 1.5, size); ctx.stroke();
    }
    if (kind === 'grate') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 0; x < size; x += 16) ctx.fillRect(x + 4, 0, 8, size);
    }
  } else if (kind === 'brushed') {
    for (let y = 0; y < size; y += 2) {
      const v = 0.82 + r() * 0.36;
      ctx.fillStyle = `rgba(${Math.round(base.r * 255 * v)},${Math.round(base.g * 255 * v)},${Math.round(base.b * 255 * v)},0.5)`;
      ctx.fillRect(0, y, size, 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < 18; i++) ctx.fillRect(r() * size, r() * size, 2, 2 + r() * 3);
  } else if (kind === 'hazard') {
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    for (let i = -size; i < size; i += 46) ctx.fillRect(i, -size, 23, size * 2);
    ctx.restore();
    noise(500, 0.12);
  } else if (kind === 'wood') {
    for (let i = 0; i < 60; i++) {
      const v = 0.82 + r() * 0.3;
      ctx.strokeStyle = `rgba(${Math.round(base.r * 255 * v)},${Math.round(base.g * 255 * v)},${Math.round(base.b * 255 * v)},0.5)`;
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      const y = r() * size;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + (r() - 0.5) * 18, size * 0.7, y + (r() - 0.5) * 18, size, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(20,14,8,0.55)';
    ctx.lineWidth = 4;
    for (let x = 0; x < size; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
    ctx.strokeRect(2, 2, size - 4, size - 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const [x, y] of [[12, 12], [size - 12, 12], [12, size - 12], [size - 12, size - 12]]) {
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'corrugated') {
    for (let x = 0; x < size; x += 12) {
      const g = ctx.createLinearGradient(x, 0, x + 12, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 12, size);
    }
    noise(900, 0.18);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 8, size, 5);
    ctx.fillRect(0, size - 14, size, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, 13, size, 2);
  } else if (kind === 'snow') {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    noise(2000, 0.25);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`;
      ctx.beginPath(); ctx.arc(r() * size, r() * size, 0.8 + r() * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(150,170,190,0.12)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(r() * size, r() * size, 25 + r() * 40, 16 + r() * 30, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'rock') {
    noise(3800, 0.55);
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.14 + r() * 0.24})`;
      ctx.lineWidth = 1 + r() * 3;
      ctx.beginPath();
      ctx.moveTo(r() * size, r() * size);
      ctx.lineTo(r() * size, r() * size);
      ctx.stroke();
    }
  } else {
    noise(600, 0.2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.scale = scale;
  textureCache.set(key, tex);
  return tex;
}

const materialCache = new Map();
function getMaterial(matId) {
  if (materialCache.has(matId)) return materialCache.get(matId);
  const meta = MATERIAL_META[matId] || MATERIAL_META.concrete;
  const texture = makeTexture(meta.kind, meta.color, meta.scale, matId.length * 977 + 13);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    metalness: meta.metalness,
    roughness: meta.roughness,
    vertexColors: true,
    emissive: meta.emissive ? new THREE.Color(meta.emissive) : 0x000000,
    emissiveIntensity: meta.emissiveIntensity || 0,
    transparent: !!meta.transparent,
    opacity: meta.opacity ?? 1,
  });
  materialCache.set(matId, mat);
  return mat;
}

const FACES = [
  { idx: [4, 5, 6, 7], n: [0, 0, 1], shade: 0.92 },
  { idx: [1, 0, 3, 2], n: [0, 0, -1], shade: 0.92 },
  { idx: [5, 1, 2, 6], n: [1, 0, 0], shade: 0.86 },
  { idx: [0, 4, 7, 3], n: [-1, 0, 0], shade: 0.86 },
  { idx: [7, 6, 2, 3], n: [0, 1, 0], shade: 1.0 },
  { idx: [0, 1, 5, 4], n: [0, -1, 0], shade: 0.6 },
];

function pushBlock(buf, block) {
  const { x, y, z, w, h, d } = block;
  const x0 = x - w / 2, x1 = x + w / 2;
  const y0 = y - h / 2, y1 = y + h / 2;
  const z0 = z - d / 2, z1 = z + d / 2;
  const corners = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const meta = MATERIAL_META[block.m] || MATERIAL_META.concrete;
  const uvScale = 1 / (meta.scale || 2);
  const tint = 0.94 + ((Math.abs((x * 13 + y * 7 + z * 17) % 11)) / 11) * 0.08;
  for (const face of FACES) {
    const p = face.idx.map((i) => corners[i]);
    const [a, b, c, dd] = p;
    const u = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const v = Math.hypot(dd[0] - a[0], dd[1] - a[1], dd[2] - a[2]);
    const uvs = [[0, 0], [u * uvScale, 0], [u * uvScale, v * uvScale], [0, v * uvScale]];
    const order = [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      const vert = p[i];
      buf.pos.push(vert[0], vert[1], vert[2]);
      buf.nor.push(face.n[0], face.n[1], face.n[2]);
      buf.uv.push(uvs[i][0], uvs[i][1]);
      const s = face.shade * tint;
      buf.col.push(s, s, s);
    }
  }
}

function bufferToGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function makeSky(theme) {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
      sunDir: { value: new THREE.Vector3(...(theme.sun || [0.4, 0.6, 0.2])).normalize() },
      sunColor: { value: new THREE.Color(theme.sunColor || '#fff2d0') },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
      varying vec3 vWorld;
      void main() {
        vec3 dir = normalize(vWorld);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.75));
        float sun = max(dot(dir, sunDir), 0.0);
        col += sunColor * (pow(sun, 8.0) * 0.28 + pow(sun, 90.0) * 0.9);
        float haze = pow(1.0 - abs(dir.y), 6.0);
        col = mix(col, bottom, haze * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function makeLabelSprite(text, color = '#ffffff', size = 0.9) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(8,10,14,0.72)';
  ctx.beginPath();
  ctx.roundRect(12, 40, 104, 48, 10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 44px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

function buildMarkers(map, group, quality) {
  const siteMarkers = [];
  for (const site of map.sites || []) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.18, site.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.05, site.z);
    group.add(ring);
    const label = makeLabelSprite(site.label || 'A', '#ffb066', 1.5);
    label.position.set(site.x, 2.1, site.z);
    group.add(label);
    siteMarkers.push(ring);
  }
  const hillRings = [];
  for (const hill of map.hills || []) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(hill.r - 0.12, hill.r + 0.08, 64),
      new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(hill.x, 0.07, hill.z);
    ring.visible = false;
    group.add(ring);
    hillRings.push(ring);
  }
  return { siteMarkers, hillRings };
}

export function buildWorld(map, quality = 'high') {
  const group = new THREE.Group();
  const theme = map.theme || {
    skyTop: '#141c2a', skyBottom: '#3b4658', fog: '#1b2432',
    fogNear: 30, fogFar: 120, sun: [0.4, 0.6, 0.2], sunColor: '#fff0d0', sunIntensity: 2, ambient: '#8fa0b8',
  };
  group.add(makeSky(theme));

  const buckets = new Map();
  for (const block of map.blocks) {
    const id = block.m || 'concrete';
    if (!buckets.has(id)) buckets.set(id, { pos: [], nor: [], uv: [], col: [] });
    pushBlock(buckets.get(id), block);
  }
  for (const [id, buf] of buckets) {
    const geo = bufferToGeometry(buf);
    const mesh = new THREE.Mesh(geo, getMaterial(id));
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = quality === 'high';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const hemi = new THREE.HemisphereLight(new THREE.Color(theme.ambient || '#8899aa'), new THREE.Color('#59616d'), 2.15);
  group.add(hemi);
  // cool fill from the opposite side so shadowed faces never go pitch black
  const fill = new THREE.DirectionalLight(new THREE.Color('#a9c8ff'), 0.85);
  fill.position.set(-50, 26, -38);
  group.add(fill);
  const sun = new THREE.DirectionalLight(new THREE.Color(theme.sunColor || '#ffe9c9'), theme.sunIntensity ?? 2);
  sun.position.set(...(theme.sun || [0.4, 0.8, 0.3])).multiplyScalar(60);
  if (quality === 'high') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -48;
    sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 48;
    sun.shadow.camera.bottom = -48;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0006;
  }
  group.add(sun);
  group.add(sun.target);

  const markers = buildMarkers(map, group, quality);
  const collider = makeWorld(map.blocks);
  return {
    group, collider, theme, sun, hemi,
    sites: markers.siteMarkers, hills: markers.hillRings,
    bounds: { x: map.halfX, z: map.halfZ },
  };
}

/** Weapon finish → small canvas texture used by viewmodels. */
export function makeFinishTexture(finish) {
  const key = `finish:${finish.id}:${finish.a}:${finish.b}:${finish.pattern}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = rand(finish.id.length * 131 + 17);
  ctx.fillStyle = finish.a;
  ctx.fillRect(0, 0, size, size);
  if (finish.pattern === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, finish.a);
    g.addColorStop(0.5, finish.b);
    g.addColorStop(1, finish.a);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (finish.pattern === 'stripe') {
    ctx.fillStyle = finish.b;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    for (let i = -size; i < size; i += 22) ctx.fillRect(i, -size, 11, size * 2);
    ctx.restore();
  } else if (finish.pattern === 'camo') {
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = i % 2 ? finish.b : finish.a;
      ctx.beginPath();
      ctx.ellipse(r() * size, r() * size, 8 + r() * 22, 6 + r() * 16, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (finish.pattern === 'weave') {
    ctx.strokeStyle = finish.b;
    ctx.lineWidth = 2;
    for (let i = -size; i < size * 2; i += 8) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = -size; i < size * 2; i += 8) {
      ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke();
    }
  } else if (finish.pattern === 'hex') {
    ctx.strokeStyle = finish.b;
    ctx.lineWidth = 2.5;
    const h = 12;
    for (let y = 0; y < size + h; y += h * 1.5) {
      for (let x = 0; x < size + h; x += h * 1.732) {
        const ox = (Math.round(y / (h * 1.5)) % 2) * h * 0.866;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = Math.PI / 3 * k;
          const px = x + ox + Math.cos(ang) * h;
          const py = y + Math.sin(ang) * h;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  textureCache.set(key, tex);
  return tex;
}
