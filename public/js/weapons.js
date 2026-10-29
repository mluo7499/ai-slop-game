// First-person weapon models built from primitives + procedural finish textures.
import * as THREE from 'three';
import { WEAPONS } from '/shared/constants.js';
import { FINISHES } from '/shared/shop.js';
import { makeFinishTexture } from './world.js';

function matFor(finish, fallbackColor = '#3a3f47', metalness = 0.65, roughness = 0.4) {
  const tex = makeFinishTexture(finish);
  tex.repeat.set(0.5, 0.5);
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xffffff,
    metalness: finish.metalness ?? metalness,
    roughness: finish.roughness ?? roughness,
    emissive: finish.glow ? new THREE.Color(finish.glow) : 0x000000,
    emissiveIntensity: finish.glow ? 0.5 : 0,
  });
}

function dark(color = '#22262c', metalness = 0.55, roughness = 0.5) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(rTop, rBot, h, mat, x = 0, y = 0, z = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** Returns { group, muzzle, eject }. Origin = right hand, weapon points down -Z. */
export function buildViewModel(weaponId, finishId = 'stock') {
  const w = WEAPONS[weaponId] || WEAPONS.p9;
  const finish = FINISHES.find((f) => f.id === finishId) || FINISHES[0];
  const skin = matFor(finish);
  const metal = dark('#2b3038', 0.85, 0.32);
  const grip = dark('#1b1e23', 0.2, 0.85);
  const group = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const eject = new THREE.Object3D();
  group.userData.weapon = weaponId;

  if (w.slot === 3) {
    const blade = box(0.035, 0.14, 0.5, new THREE.MeshStandardMaterial({ color: '#cfd8e3', metalness: 0.9, roughness: 0.18 }), 0, 0.02, -0.3);
    blade.rotation.x = 0.1;
    group.add(blade);
    group.add(box(0.05, 0.06, 0.16, grip, 0, -0.03, 0.02));
    group.add(box(0.09, 0.05, 0.06, grip, 0, -0.05, 0.1));
    muzzle.position.set(0, 0.02, -0.54);
  } else if (w.id === 'awp') {
    group.add(box(0.075, 0.11, 0.95, skin, 0, 0, -0.35));
    group.add(cyl(0.024, 0.024, 0.75, metal, 0, 0.01, -0.92));
    group.add(box(0.06, 0.08, 0.3, metal, 0, 0.02, -1.25));
    group.add(box(0.055, 0.22, 0.1, grip, 0, -0.14, -0.08));
    group.add(box(0.07, 0.15, 0.28, finish.id === 'stock' ? dark('#2f343b') : skin, 0, -0.02, 0.16));
    const scopeMat = dark('#0d1014', 0.8, 0.2);
    const scope = cyl(0.045, 0.05, 0.34, scopeMat, 0, 0.11, -0.35, 14);
    group.add(scope);
    group.add(box(0.055, 0.055, 0.06, metal, 0, 0.17, -0.21));
    group.add(box(0.07, 0.05, 0.2, dark('#171b20'), 0, -0.03, -0.86));
    muzzle.position.set(0, 0.01, -1.32);
  } else if (w.id === 'breacher') {
    group.add(box(0.095, 0.1, 0.55, skin, 0, 0, -0.25));
    group.add(cyl(0.032, 0.032, 0.55, metal, 0, 0.03, -0.68));
    group.add(cyl(0.045, 0.045, 0.18, metal, 0, 0.03, -0.42));
    group.add(box(0.08, 0.07, 0.34, dark('#5a3f2a', 0.1, 0.9), 0, -0.06, -0.42));
    group.add(box(0.06, 0.19, 0.09, grip, 0, -0.13, -0.07));
    group.add(box(0.075, 0.09, 0.24, skin, 0, 0.02, 0.13));
    group.add(box(0.07, 0.055, 0.1, dark('#c9a227', 0.3, 0.7), 0, 0.02, -0.02));
    muzzle.position.set(0, 0.03, -0.98);
  } else if (w.id === 'mp9') {
    group.add(box(0.065, 0.095, 0.34, skin, 0, 0, -0.18));
    group.add(cyl(0.019, 0.019, 0.28, metal, 0, 0.015, -0.44));
    group.add(box(0.045, 0.18, 0.07, grip, 0, -0.11, -0.02));
    group.add(box(0.04, 0.12, 0.055, dark('#2a2f36'), 0, -0.1, 0.12));
    group.add(box(0.05, 0.05, 0.22, dark('#232830'), 0, 0.035, 0.14));
    group.add(box(0.05, 0.045, 0.2, dark('#4a5058', 0.2, 0.8), 0, -0.075, -0.14));
    muzzle.position.set(0, 0.015, -0.58);
  } else if (w.id === 'ak' || w.id === 'm4') {
    const long = w.id === 'ak';
    group.add(box(0.07, 0.1, 0.5, skin, 0, 0, -0.2));
    group.add(box(0.06, 0.06, 0.28, long ? dark('#6b4a25', 0.1, 0.85) : skin, 0, 0.005, -0.52));
    group.add(cyl(0.016, 0.016, 0.42, metal, 0, 0.02, -0.62));
    group.add(box(0.045, 0.15, 0.1, grip, 0, -0.14, -0.02));
    group.add(box(0.05, 0.065, 0.22, skin, 0, 0.01, 0.15));
    group.add(box(0.05, 0.19, 0.1, dark('#2a2f36'), 0, -0.16, -0.18));
    if (!long) group.add(box(0.06, 0.06, 0.22, dark('#2f353d'), 0, 0.02, -0.46));
    group.add(box(0.012, 0.05, 0.015, metal, 0, 0.075, -0.44));
    group.add(box(0.03, 0.03, 0.16, dark('#232830'), 0, 0.075, -0.3));
    muzzle.position.set(0, 0.02, -0.84);
  } else if (w.id === 'deagle') {
    group.add(box(0.062, 0.085, 0.3, skin, 0, 0.02, -0.1));
    group.add(cyl(0.02, 0.02, 0.16, metal, 0, 0.03, -0.27));
    group.add(box(0.045, 0.16, 0.075, grip, 0, -0.11, 0.03));
    group.add(box(0.05, 0.03, 0.1, metal, 0, -0.01, -0.2));
    muzzle.position.set(0, 0.03, -0.36);
  } else {
    group.add(box(0.055, 0.075, 0.24, skin, 0, 0, -0.08));
    group.add(cyl(0.016, 0.016, 0.14, metal, 0, 0.015, -0.22));
    group.add(box(0.042, 0.14, 0.065, grip, 0, -0.1, 0.03));
    muzzle.position.set(0, 0.015, -0.3);
  }
  muzzle.name = 'muzzle';
  eject.position.set(0.05, 0.03, -0.2);
  group.add(muzzle);
  group.add(eject);

  // hands / sleeves
  const sleeve = new THREE.MeshStandardMaterial({ color: '#2f3a46', roughness: 0.85 });
  const glove = new THREE.MeshStandardMaterial({ color: '#1c2229', roughness: 0.7, metalness: 0.15 });
  const rightHand = box(0.09, 0.09, 0.14, glove, 0.02, -0.1, 0.06);
  rightHand.rotation.x = 0.25;
  group.add(rightHand);
  const rightArm = box(0.1, 0.1, 0.34, sleeve, 0.09, -0.16, 0.28);
  rightArm.rotation.x = 0.4;
  group.add(rightArm);
  if (w.slot !== 3) {
    const leftHand = box(0.085, 0.08, 0.16, glove, -0.02, -0.08, -0.36);
    leftHand.rotation.x = 0.1;
    group.add(leftHand);
    const leftArm = box(0.09, 0.09, 0.36, sleeve, -0.12, -0.16, -0.2);
    leftArm.rotation.x = 0.2;
    leftArm.rotation.y = -0.35;
    group.add(leftArm);
  }

  group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 5; } });
  return { group, muzzle, eject, stats: w, finish };
}
