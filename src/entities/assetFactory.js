/* =====================================================================
   assetFactory.js — Pipeline aset DUAL-MODE terkunci:
   1) Coba ./public/assets/<name>.glb (GLTFLoader + DRACO) → normalisasi
      bounding box ke targetSize, pivot dasar-tengah (y = 0).
   2) Bila file belum ada / gagal muat → fallback otomatis ke model
      mainan prosedural multi-part: RoundedBoxGeometry soft-bevel,
      material plastik/kayu satin PBR (roughness 0.4–0.85).

   Kontrak: async loadVehicle(type) -> THREE.Group
            async loadLandmark(type) -> THREE.Group
   Ekstra:  preloadAll(onProgress) untuk layar muat.

   Penamaan node runtime (dipindai ulang tiap instance):
     wheel_*  → roda yang berputar   indicator_* → lampu sein (ngetem)
     brake_*  → lampu rem            headlight_* → lampu utama
   ===================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  ASSETS, PALETTE as P, VEHICLES, LANDMARKS,
  VEHICLE_TYPES, LANDMARK_TYPES, getVehicleDef, getLandmarkDef,
} from '../config/gameConfig.js';

/* ==================== Cache bersama (geometri/material/tekstur) ==================== */
const geoCache = new Map();
const matCache = new Map();
const texCache = new Map();
const protoCache = new Map(); // key "v:angkot" / "l:monas" -> Promise<Group>

function getMat(color, rough = 0.6, opts = {}) {
  const metal = opts.metal ?? 0.05;
  const emissive = opts.emissive ?? '#000000';
  const ei = opts.ei ?? 0;
  const opacity = opts.opacity ?? 1;
  const key = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal,
      emissive, emissiveIntensity: ei,
      transparent: opacity < 1, opacity,
      depthWrite: opacity >= 1,
    }));
  }
  return matCache.get(key);
}
function getGlossMat(color, opts = {}) {
  const rough = opts.rough ?? 0.2;
  const metal = opts.metal ?? 0.04;
  const emissive = opts.emissive ?? '#000000';
  const ei = opts.ei ?? 0;
  const clearcoat = opts.clearcoat ?? 0.88;
  const mapKey = opts.mapKey ?? '';
  const key = `gl|${color}|${rough}|${metal}|${emissive}|${ei}|${clearcoat}|${mapKey}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: metal,
      clearcoat, clearcoatRoughness: 0.12,
      emissive, emissiveIntensity: ei,
      map: opts.map || null,
    }));
  }
  return matCache.get(key);
}
function getDieCastMat(color, opts = {}) {
  return getGlossMat(color, {
    metal: opts.metal ?? 0.35,
    rough: opts.rough ?? 0.2,
    clearcoat: opts.clearcoat ?? 1.0,
    emissive: opts.emissive ?? '#000000',
    ei: opts.ei ?? 0,
  });
}
function getChromeMat() {
  return getGlossMat(P.chrome || '#eef2f7', {
    metal: 0.92,
    rough: 0.12,
    clearcoat: 0.75,
  });
}
const glassMat = () => getMat(P.glass, 0.4, { opacity: 0.55, metal: 0.1 });

function rboxGeo(w, h, d, r) {
  const radius = Math.max(0.005, Math.min(r, Math.min(w, h, d) * 0.49));
  const key = `rb|${w}|${h}|${d}|${radius.toFixed(3)}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 3, radius));
  return geoCache.get(key);
}
function cylGeo(rt, rb, h, seg = 16) {
  const key = `cy|${rt}|${rb}|${h}|${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(key);
}
function sphereGeo(r, ws = 18, hs = 14) {
  const key = `sp|${r}|${ws}|${hs}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(r, ws, hs));
  return geoCache.get(key);
}

/* ==================== Helper perakitan ==================== */
function add(parent, mesh, x = 0, y = 0, z = 0, o = {}) {
  mesh.position.set(x, y, z);
  if (o.rx) mesh.rotation.x = o.rx;
  if (o.ry) mesh.rotation.y = o.ry;
  if (o.rz) mesh.rotation.z = o.rz;
  if (o.name) mesh.name = o.name;
  parent.add(mesh);
  return mesh;
}
function rbox(w, h, d, r, color, rough = 0.6, opts = {}) {
  const m = new THREE.Mesh(rboxGeo(w, h, d, r), opts.mat || getMat(color, rough, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = !!opts.receive;
  return m;
}
function cyl(rt, rb, h, color, rough = 0.6, seg = 16, opts = {}) {
  const m = new THREE.Mesh(cylGeo(rt, rb, h, seg), opts.mat || getMat(color, rough, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = !!opts.receive;
  return m;
}
function sphere(r, color, rough = 0.6, opts = {}) {
  const m = new THREE.Mesh(sphereGeo(r), opts.mat || getMat(color, rough, opts));
  m.castShadow = opts.cast !== false;
  return m;
}
/** batang di antara dua titik (lengan, kaki, fork motor) */
function limb(parent, from, to, r, color, rough = 0.6) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = cyl(r, r, len, color, rough, 10);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

function wheel(r, w, name) {
  const g = new THREE.Group(); g.name = name;
  const tire = cyl(r, r, w, P.tire, 0.85, 20); tire.rotation.z = Math.PI / 2;
  const rim = cyl(r * 0.58, r * 0.58, w + 0.025, P.chrome || '#eef2f7', 0.12, 16, { mat: getChromeMat() });
  rim.rotation.z = Math.PI / 2;
  const hub = cyl(r * 0.26, r * 0.26, w + 0.045, P.chrome || '#eef2f7', 0.15, 10, { mat: getChromeMat() });
  hub.rotation.z = Math.PI / 2;
  const lugRing = cyl(r * 0.4, r * 0.4, w + 0.032, P.asphaltDark, 0.5, 10);
  lugRing.rotation.z = Math.PI / 2;
  g.add(tire, rim, lugRing, hub);
  return g;
}

/* Label teks kanvas (papan trayek, plang landmark, plat nomor) */
function labelTexture(text, o = {}) {
  const key = `lb|${text}|${JSON.stringify(o)}`;
  if (texCache.has(key)) return texCache.get(key);
  const w = o.w || 512, h = o.h || 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (o.bg !== 'none') {
    g.fillStyle = o.bg || P.paper;
    g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, o.radius ?? 24); g.fill();
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = 6; g.stroke(); }
  }
  g.fillStyle = o.fg || P.ink;
  g.font = o.font || `700 ${Math.floor(h * 0.5)}px Fredoka, "Plus Jakarta Sans", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  const lh = h / (lines.length + 0.4);
  lines.forEach((ln, i) => g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}
function label(text, worldW, worldH, o = {}) {
  const key = `pl|${worldW}|${worldH}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.PlaneGeometry(worldW, worldH));
  const tex = labelTexture(text, o);
  const m = new THREE.Mesh(geoCache.get(key), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, alphaTest: 0.08, roughness: 0.6,
    emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: o.glow ?? 0.22,
    polygonOffset: true, polygonOffsetFactor: -1,
  }));
  m.castShadow = false;
  return m;
}

/* Pengendara mainan mungil */
function driver(shirt, hat = 'peci') {
  const g = new THREE.Group();
  add(g, rbox(0.34, 0.42, 0.24, 0.08, shirt, 0.65), 0, 0.21, 0);
  add(g, sphere(0.16, P.skin, 0.6), 0, 0.52, 0);
  if (hat === 'peci') add(g, cyl(0.15, 0.16, 0.12, P.tire, 0.7, 14), 0, 0.64, 0);
  else if (hat === 'cap') {
    add(g, cyl(0.155, 0.165, 0.09, P.toyBlue, 0.6, 14), 0, 0.63, 0);
    add(g, rbox(0.2, 0.03, 0.14, 0.01, P.toyBlue, 0.6), 0, 0.6, -0.16);
  }
  return g;
}
/* Bendera Merah Putih di tiang */
function flagPole(h) {
  const g = new THREE.Group();
  add(g, cyl(0.05, 0.07, h, P.warmWhite, 0.5, 10), 0, h / 2, 0);
  add(g, sphere(0.09, P.gold, 0.4, { metal: 0.5 }), 0, h + 0.05, 0);
  add(g, rbox(1.05, 0.34, 0.03, 0.01, P.merahPutih, 0.55), 0.56, h - 0.24, 0, { ry: 0.25, rz: 0.03 });
  add(g, rbox(1.05, 0.34, 0.03, 0.01, P.warmWhite, 0.55), 0.56, h - 0.58, 0, { ry: 0.25, rz: 0.03 });
  return g;
}
function bush(r = 0.5) {
  const m = sphere(r, P.grassDark, 0.75);
  m.scale.set(1, 0.8, 1);
  return m;
}
function tree(s = 1) {
  const g = new THREE.Group();
  add(g, cyl(0.12, 0.17, 0.9, P.woodDark, 0.8, 10), 0, 0.45, 0);
  add(g, sphere(0.72, P.grass, 0.75), 0, 1.35, 0);
  add(g, sphere(0.45, P.grassDark, 0.75), 0.4, 1.75, 0.15);
  g.scale.setScalar(s);
  return g;
}

/* ==================== Normalisasi & pivot (dipakai GLB & prosedural) ==================== */
function normalizeToTarget(group, target) {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(target.x / size.x, target.y / size.y, target.z / size.z);
  group.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(group);
  const center = box2.getCenter(new THREE.Vector3());
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= box2.min.y; // pivot dasar-tengah: roda menyentuh y=0
  const wrapper = new THREE.Group();
  wrapper.add(group);
  return wrapper;
}

function makeUnderglowTexture() {
  const key = 'tex|underglow';
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

function attachSlotUnderglow(wrapper, target) {
  const geoKey = `ug|${target.x.toFixed(2)}|${target.z.toFixed(2)}`;
  if (!geoCache.has(geoKey)) {
    const geo = new THREE.PlaneGeometry(target.x * 1.65, target.z * 1.32);
    geo.rotateX(-Math.PI / 2);
    geoCache.set(geoKey, geo);
  }
  const mat = new THREE.MeshBasicMaterial({
    map: makeUnderglowTexture(),
    color: new THREE.Color('#00e5ff'),
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(geoCache.get(geoKey), mat);
  glow.name = 'slot_underglow';
  glow.position.set(0, 0.045, 0);
  glow.renderOrder = 2;
  wrapper.add(glow);
}

function attachTwinExhaustFlames(wrapper, type, target) {
  const flames = new THREE.Group();
  flames.name = 'exhaust_flames';
  flames.position.set(0, 0.38, target.z * 0.5 + 0.04);
  flames.visible = false;

  if (!geoCache.has('flame|outer')) {
    const g = new THREE.ConeGeometry(0.19, 1.35, 10);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.68);
    geoCache.set('flame|outer', g);
  }
  if (!geoCache.has('flame|inner')) {
    const g = new THREE.ConeGeometry(0.1, 0.9, 8);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.45);
    geoCache.set('flame|inner', g);
  }
  if (!matCache.has('flame|outer')) {
    matCache.set('flame|outer', new THREE.MeshBasicMaterial({
      color: '#ff5500', transparent: true, opacity: 0.92,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  }
  if (!matCache.has('flame|inner')) {
    matCache.set('flame|inner', new THREE.MeshBasicMaterial({
      color: '#ffd60a', transparent: true, opacity: 0.96,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  }

  const spread = type === 'ojol' ? 0.16 : Math.min(0.55, target.x * 0.28);
  for (const sx of [-spread, spread]) {
    const jet = new THREE.Group();
    jet.name = sx < 0 ? 'flame_jet_L' : 'flame_jet_R';
    jet.position.set(sx, 0, 0);
    const outer = new THREE.Mesh(geoCache.get('flame|outer'), matCache.get('flame|outer'));
    outer.name = 'flame_outer';
    const inner = new THREE.Mesh(geoCache.get('flame|inner'), matCache.get('flame|inner'));
    inner.name = 'flame_inner';
    jet.add(outer, inner);
    flames.add(jet);
  }
  wrapper.add(flames);
}

/** Pindai node bernama & siapkan referensi runtime per-instance.
    Material lampu & underglow dikloning agar per kendaraan independen. */
function bindRuntimeRefs(group) {
  const wheels = [], indicators = [], brakes = [], headlights = [], jets = [];
  let underglow = null, flameGroup = null;
  group.traverse((o) => {
    if (!o.name) return;
    const n = o.name.toLowerCase();
    if (n.startsWith('wheel_') || /wheel|roda/.test(n)) wheels.push(o);
    if (n.startsWith('indicator_')) { o.material = o.material.clone(); indicators.push(o); }
    if (n.startsWith('brake_')) { o.material = o.material.clone(); brakes.push(o); }
    if (n.startsWith('headlight_')) { o.material = o.material.clone(); headlights.push(o); }
    if (n === 'slot_underglow') { o.material = o.material.clone(); underglow = o; }
    if (n === 'exhaust_flames') flameGroup = o;
    if (n.startsWith('flame_jet_')) jets.push(o);
  });
  group.userData.wheels = wheels;
  group.userData.indicators = indicators;
  group.userData.brakes = brakes;
  group.userData.headlights = headlights;
  group.userData.underglow = underglow;
  group.userData.flames = flameGroup ? { group: flameGroup, jets } : null;
  return group;
}

export function setVehicleUnderglow(group, hexColor) {
  const glow = group?.userData?.underglow;
  if (!glow) return;
  if (!hexColor) {
    glow.visible = false;
    return;
  }
  glow.visible = true;
  glow.material.color.set(hexColor);
}

/* ==================== Pipeline GLB ==================== */
let gltfLoader = null, dracoLoader = null;
function getGLTFLoader() {
  if (!gltfLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(ASSETS.dracoPath);
    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
  }
  return gltfLoader;
}

async function tryLoadGLB(glbName, target) {
  const url = `${ASSETS.basePath}${glbName}.glb`;
  const gltf = await getGLTFLoader().loadAsync(url);
  if (!gltf.scene || gltf.scene.children.length === 0) throw new Error('GLB kosong');
  gltf.scene.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const wrapper = normalizeToTarget(gltf.scene, target);
  wrapper.userData.source = 'glb';
  return wrapper;
}

/* =====================================================================
   MODEL PROSEDURAL — ARMADA NUSANTARA
   Semua bidang utama RoundedBoxGeometry soft-bevel, pivot dasar y=0,
   menghadap -Z (arah maju game).
   ===================================================================== */

function buildAngkot(def) {
  const g = new THREE.Group(); g.name = 'angkot';
  const C = def.colors;
  const wr = def.wheelRadius;
  add(g, wheel(wr, 0.26, 'wheel_FL'), -0.84, wr, -1.45);
  add(g, wheel(wr, 0.26, 'wheel_FR'), 0.84, wr, -1.45);
  add(g, wheel(wr, 0.26, 'wheel_RL'), -0.84, wr, 1.45);
  add(g, wheel(wr, 0.26, 'wheel_RR'), 0.84, wr, 1.45);

  add(g, rbox(1.88, 0.42, 4.30, 0.10, C.body, 0.2, { receive: true, mat: getDieCastMat(C.body) }), 0, 0.60, 0, { receive: true });
  add(g, rbox(1.92, 0.92, 4.34, 0.14, C.body, 0.2, { receive: true, mat: getDieCastMat(C.body) }), 0, 1.22, 0, { receive: true });
  add(g, rbox(1.96, 0.20, 4.38, 0.06, C.stripe, 0.2, { mat: getDieCastMat(C.stripe) }), 0, 1.02, 0);
  add(g, rbox(1.86, 0.60, 4.10, 0.12, C.cabin, 0.2, { mat: getDieCastMat(C.cabin) }), 0, 1.92, 0);
  add(g, rbox(1.80, 0.16, 3.96, 0.08, C.roof, 0.2, { mat: getDieCastMat(C.roof) }), 0, 2.30, 0);

  add(g, rbox(1.62, 0.50, 0.06, 0.02, P.glass, 0.4, { mat: glassMat(), cast: false }), 0, 1.92, -2.06, { rx: -0.10 });
  add(g, label('SALATIGA • PASAR RAYA', 1.56, 0.26, { bg: P.ink, fg: P.toyYellow, h: 96, glow: 0.35 }), 0, 2.26, -2.10, { rx: -0.10 });
  for (const sx of [-0.94, 0.94]) for (const wz of [-1.35, -0.15, 1.05])
    add(g, rbox(0.06, 0.44, 0.92, 0.02, P.glass, 0.4, { mat: glassMat(), cast: false }), sx, 1.94, wz);
  add(g, rbox(1.5, 0.44, 0.06, 0.02, P.glass, 0.4, { mat: glassMat(), cast: false }), 0, 1.94, 2.06);

  add(g, rbox(0.05, 1.05, 0.85, 0.02, P.angkotGreenDark, 0.2, { mat: getDieCastMat(P.angkotGreenDark) }), -0.965, 1.15, 0.55);
  add(g, rbox(0.03, 0.05, 0.18, 0.01, P.chrome || '#eef2f7', 0.15, { mat: getChromeMat() }), -0.99, 1.35, 0.25);

  add(g, rbox(0.30, 0.18, 0.08, 0.03, P.headlight, 0.4, { emissive: P.headlight, ei: 1.1 }), -0.62, 0.98, -2.18, { name: 'headlight_L' });
  add(g, rbox(0.30, 0.18, 0.08, 0.03, P.headlight, 0.4, { emissive: P.headlight, ei: 1.1 }), 0.62, 0.98, -2.18, { name: 'headlight_R' });
  add(g, rbox(0.80, 0.20, 0.06, 0.02, P.tire, 0.7), 0, 0.98, -2.18);
  add(g, rbox(1.94, 0.18, 0.20, 0.06, P.tire, 0.6), 0, 0.52, -2.22);
  add(g, rbox(1.94, 0.18, 0.20, 0.06, P.tire, 0.6), 0, 0.52, 2.22);

  const ind = (x, z, name) => add(g, rbox(0.14, 0.10, 0.07, 0.02, P.indicator, 0.4, { emissive: P.indicator, ei: 0 }), x, 1.10, z, { name });
  ind(-0.86, -2.19, 'indicator_FL'); ind(0.86, -2.19, 'indicator_FR');
  ind(-0.86, 2.19, 'indicator_RL'); ind(0.86, 2.19, 'indicator_RR');
  add(g, rbox(0.22, 0.26, 0.07, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.7 }), -0.72, 1.15, 2.20, { name: 'brake_L' });
  add(g, rbox(0.22, 0.26, 0.07, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.7 }), 0.72, 1.15, 2.20, { name: 'brake_R' });

  for (const sx of [-1, 1]) {
    add(g, cyl(0.02, 0.02, 0.22, P.tire, 0.6, 8), sx * 1.0, 2.05, -1.85, { rz: sx * 0.5 });
    add(g, rbox(0.05, 0.16, 0.10, 0.02, P.tire, 0.5), sx * 1.08, 2.12, -1.85);
  }

  /* Rak atap + muatan khas Nusantara */
  for (const sx of [-0.68, 0.68]) add(g, cyl(0.03, 0.03, 3.6, P.tire, 0.6, 8), sx, 2.46, 0, { rx: Math.PI / 2 });
  for (const cz of [-1.2, 0, 1.2]) add(g, cyl(0.025, 0.025, 1.4, P.tire, 0.6, 8), 0, 2.46, cz, { rz: Math.PI / 2 });
  add(g, rbox(0.55, 0.34, 0.62, 0.05, P.wood, 0.7), -0.32, 2.62, 0.55, { ry: 0.15 });
  const sack = sphere(0.30, P.concrete, 0.8); sack.scale.set(1, 0.75, 1.2);
  add(g, sack, 0.38, 2.56, 1.15);
  add(g, cyl(0.13, 0.13, 1.1, P.toyGreen, 0.65, 12), 0, 2.52, -0.65, { rz: Math.PI / 2 });

  add(g, driver(P.toyBlue, 'peci'), 0.45, 1.62, -1.45);
  add(g, cyl(0.045, 0.045, 0.34, P.tire, 0.7, 10), 0.6, 0.35, 2.25, { rx: Math.PI / 2 });
  add(g, label('H 1207 SG', 0.62, 0.16, { bg: P.ink, fg: P.cream, h: 80, radius: 12 }), 0, 0.78, 2.26);
  return g;
}

function buildBemo(def) {
  const g = new THREE.Group(); g.name = 'bemo';
  const C = def.colors;
  add(g, wheel(0.30, 0.20, 'wheel_F'), 0, 0.30, -1.30);
  add(g, wheel(0.30, 0.22, 'wheel_RL'), -0.74, 0.30, 0.95);
  add(g, wheel(0.30, 0.22, 'wheel_RR'), 0.74, 0.30, 0.95);

  add(g, rbox(0.34, 0.22, 0.72, 0.08, C.body, 0.2, { mat: getDieCastMat(C.body) }), 0, 0.62, -1.30);
  add(g, rbox(1.10, 0.62, 0.55, 0.18, C.body, 0.2, { mat: getDieCastMat(C.body) }), 0, 0.82, -1.55);
  add(g, cyl(0.13, 0.13, 0.08, P.headlight, 0.4, 16, { emissive: P.headlight, ei: 1.1 }), 0, 1.02, -1.84, { rx: Math.PI / 2, name: 'headlight_C' });
  add(g, rbox(1.50, 0.95, 1.15, 0.16, C.body, 0.2, { receive: true, mat: getDieCastMat(C.body) }), 0, 1.20, -0.75, { receive: true });
  add(g, rbox(1.16, 0.42, 0.05, 0.02, P.glass, 0.4, { mat: glassMat(), cast: false }), 0, 1.62, -1.32, { rx: -0.12 });
  add(g, rbox(1.2, 0.12, 0.3, 0.04, P.tire, 0.6), 0, 1.35, -1.15);
  add(g, cyl(0.13, 0.13, 0.03, P.tire, 0.6, 14), 0.34, 1.42, -1.05, { rx: -0.9 });
  add(g, driver(P.woodDark, 'peci'), 0.34, 1.35, -0.65);

  add(g, rbox(1.50, 0.16, 1.55, 0.06, P.bemoOrangeDark, 0.2, { receive: true, mat: getDieCastMat(P.bemoOrangeDark) }), 0, 0.66, 0.80, { receive: true });
  for (const bz of [0.42, 1.18]) {
    add(g, rbox(1.30, 0.12, 0.42, 0.04, C.bench, 0.7), 0, 0.98, bz);
    for (const lx of [-0.55, 0.55]) add(g, rbox(0.08, 0.24, 0.36, 0.02, P.woodDark, 0.7), lx, 0.82, bz);
  }
  for (const sx of [-0.72, 0.72]) add(g, cyl(0.035, 0.035, 1.5, P.tire, 0.6, 8), sx, 1.15, 0.80, { rx: Math.PI / 2 });

  add(g, rbox(1.72, 0.14, 3.30, 0.07, C.roof, 0.2, { mat: getDieCastMat(C.roof) }), 0, 2.10, -0.10);
  for (const sx of [-0.72, 0.72]) for (const pz of [0.35, 1.45])
    add(g, cyl(0.04, 0.04, 1.30, P.tire, 0.6, 8), sx, 1.40, pz);

  add(g, rbox(0.8, 0.10, 0.28, 0.03, P.tire, 0.6), 0, 0.42, 1.72);
  add(g, rbox(0.14, 0.16, 0.06, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.7 }), -0.6, 0.85, 1.62, { name: 'brake_L' });
  add(g, rbox(0.14, 0.16, 0.06, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.7 }), 0.6, 0.85, 1.62, { name: 'brake_R' });
  add(g, rbox(0.12, 0.10, 0.06, 0.02, P.indicator, 0.4, { emissive: P.indicator, ei: 0 }), -0.5, 1.0, -1.83, { name: 'indicator_FL' });
  add(g, rbox(0.12, 0.10, 0.06, 0.02, P.indicator, 0.4, { emissive: P.indicator, ei: 0 }), 0.5, 1.0, -1.83, { name: 'indicator_FR' });
  add(g, label('H 3060 SG', 0.6, 0.16, { bg: P.ink, fg: P.cream, h: 80, radius: 12 }), 0, 0.90, 1.61);
  add(g, cyl(0.04, 0.04, 0.3, P.tire, 0.7, 10), 0.5, 0.32, 1.5, { rx: Math.PI / 2 });
  return g;
}

function buildL300(def) {
  const g = new THREE.Group(); g.name = 'l300';
  const C = def.colors;
  const wr = def.wheelRadius;
  add(g, wheel(wr, 0.28, 'wheel_FL'), -0.86, wr, -1.45);
  add(g, wheel(wr, 0.28, 'wheel_FR'), 0.86, wr, -1.45);
  add(g, wheel(wr, 0.28, 'wheel_RL'), -0.86, wr, 1.40);
  add(g, wheel(wr, 0.28, 'wheel_RR'), 0.86, wr, 1.40);

  add(g, rbox(1.86, 0.34, 4.35, 0.08, P.tire, 0.7), 0, 0.62, 0);
  add(g, rbox(1.88, 1.10, 1.70, 0.16, C.body, 0.2, { receive: true, mat: getDieCastMat(C.body) }), 0, 1.32, -1.30, { receive: true });
  add(g, rbox(1.62, 0.52, 0.05, 0.02, P.glass, 0.4, { mat: glassMat(), cast: false }), 0, 1.55, -2.16, { rx: -0.08 });
  for (const sx of [-0.95, 0.95]) add(g, rbox(0.05, 0.46, 1.05, 0.02, P.glass, 0.4, { mat: glassMat(), cast: false }), sx, 1.52, -1.30);
  add(g, rbox(1.10, 0.24, 0.06, 0.02, P.tire, 0.7), 0, 0.95, -2.17);
  add(g, rbox(0.32, 0.20, 0.07, 0.03, P.headlight, 0.4, { emissive: P.headlight, ei: 1.1 }), -0.68, 0.95, -2.17, { name: 'headlight_L' });
  add(g, rbox(0.32, 0.20, 0.07, 0.03, P.headlight, 0.4, { emissive: P.headlight, ei: 1.1 }), 0.68, 0.95, -2.17, { name: 'headlight_R' });
  add(g, rbox(1.94, 0.20, 0.22, 0.06, P.tire, 0.6), 0, 0.52, -2.24);
  for (const mx of [-0.5, 0, 0.5]) add(g, rbox(0.10, 0.07, 0.05, 0.02, P.indicator, 0.4, { emissive: P.indicator, ei: 0.8 }), mx, 1.92, -2.10);
  add(g, driver(P.toyRed, 'cap'), 0.45, 1.45, -1.35);

  /* Bak kayu tiga lapis papan */
  add(g, rbox(1.86, 0.14, 2.35, 0.04, C.cargo, 0.75), 0, 0.86, 0.95, { receive: true });
  for (const py of [1.02, 1.21, 1.40]) {
    for (const sx of [-0.92, 0.92]) add(g, rbox(0.07, 0.17, 2.35, 0.02, C.bed, 0.7), sx, py, 0.95);
    add(g, rbox(1.86, 0.17, 0.07, 0.02, C.bed, 0.7), 0, py, -0.26);
    add(g, rbox(1.86, 0.17, 0.07, 0.02, C.bed, 0.7), 0, py, 2.16);
  }
  for (const sx of [-0.92, 0.92]) for (const pz of [-0.26, 2.16])
    add(g, rbox(0.09, 0.62, 0.09, 0.02, P.woodDark, 0.7), sx, 1.2, pz);

  add(g, rbox(0.62, 0.52, 0.62, 0.05, P.wood, 0.7), -0.42, 1.20, 0.55, { ry: 0.2 });
  add(g, rbox(0.5, 0.42, 0.5, 0.05, P.woodDark, 0.7), 0.40, 1.15, 1.35, { ry: -0.15 });
  const s1 = sphere(0.28, P.concrete, 0.8); s1.scale.set(1, 0.8, 1.1); add(g, s1, 0.1, 1.05, 0.15);
  const s2 = sphere(0.26, P.concrete, 0.8); s2.scale.set(1.1, 0.75, 1); add(g, s2, -0.5, 1.02, 1.7);
  add(g, cyl(0.14, 0.14, 1.5, P.toyGreen, 0.65, 12), 0, 1.55, 1.9, { rz: Math.PI / 2 });

  add(g, rbox(0.22, 0.22, 0.07, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.7 }), -0.72, 0.95, 2.22, { name: 'brake_L' });
  add(g, rbox(0.22, 0.22, 0.07, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.7 }), 0.72, 0.95, 2.22, { name: 'brake_R' });
  add(g, rbox(0.12, 0.10, 0.06, 0.02, P.indicator, 0.4, { emissive: P.indicator, ei: 0 }), -0.88, 0.95, 2.22, { name: 'indicator_RL' });
  add(g, rbox(0.12, 0.10, 0.06, 0.02, P.indicator, 0.4, { emissive: P.indicator, ei: 0 }), 0.88, 0.95, 2.22, { name: 'indicator_RR' });
  add(g, label('L300 • SALATIGA', 0.9, 0.18, { bg: P.ink, fg: P.cream, h: 80, radius: 12 }), 0, 0.70, 2.24);
  for (const sx of [-0.86, 0.86]) add(g, rbox(0.30, 0.28, 0.04, 0.01, P.tire, 0.85), sx, 0.42, 1.78);
  add(g, cyl(0.045, 0.045, 0.3, P.tire, 0.7, 10), 0.7, 0.35, 2.3, { rx: Math.PI / 2 });
  return g;
}

function buildOjol(def) {
  const g = new THREE.Group(); g.name = 'ojol';
  const C = def.colors;
  add(g, wheel(0.30, 0.14, 'wheel_F'), 0, 0.30, -0.85);
  add(g, wheel(0.30, 0.14, 'wheel_R'), 0, 0.30, 0.85);

  add(g, rbox(0.32, 0.30, 1.10, 0.10, C.body, 0.2, { mat: getDieCastMat(C.body) }), 0, 0.75, 0.30);
  add(g, rbox(0.30, 0.26, 0.50, 0.12, C.body, 0.2, { mat: getDieCastMat(C.body) }), 0, 0.95, -0.15);
  add(g, rbox(0.30, 0.12, 0.70, 0.06, P.tire, 0.7), 0, 1.00, 0.35);
  add(g, rbox(0.20, 0.12, 0.50, 0.06, C.body, 0.2, { mat: getDieCastMat(C.body) }), 0, 0.62, -0.85);
  add(g, rbox(0.26, 0.28, 0.40, 0.06, P.asphaltDark, 0.6), 0, 0.60, 0);
  for (const fx of [-0.09, 0.09]) limb(g, [fx, 1.15, -0.52], [fx, 0.32, -0.85], 0.035, P.chrome || '#eef2f7', 0.2);
  add(g, cyl(0.035, 0.035, 0.55, P.tire, 0.5, 10), 0, 1.25, -0.62, { rz: Math.PI / 2 });
  for (const gx of [-0.26, 0.26]) add(g, cyl(0.045, 0.045, 0.1, P.tire, 0.8, 8), gx, 1.25, -0.62, { rz: Math.PI / 2 });
  add(g, rbox(0.16, 0.14, 0.10, 0.04, P.headlight, 0.4, { emissive: P.headlight, ei: 1.2 }), 0, 1.10, -0.78, { name: 'headlight_C' });
  add(g, rbox(0.10, 0.10, 0.06, 0.02, P.tail, 0.4, { emissive: P.tail, ei: 0.8 }), 0, 0.85, 0.92, { name: 'brake_C' });
  add(g, cyl(0.05, 0.05, 0.7, P.chrome || '#eef2f7', 0.15, 10, { mat: getChromeMat() }), 0.16, 0.45, 0.4, { rx: Math.PI / 2 - 0.12 });

  /* Boks antar + logo */
  add(g, rbox(0.42, 0.40, 0.42, 0.08, P.ojolGreenDark, 0.2, { mat: getDieCastMat(P.ojolGreenDark) }), 0, 1.28, 0.95);
  add(g, label('OJOL', 0.34, 0.2, { bg: 'none', fg: P.warmWhite, h: 96, glow: 0.3 }), 0, 1.28, 1.17);
  add(g, label('OJOL', 0.34, 0.2, { bg: 'none', fg: P.warmWhite, h: 96, glow: 0.3 }), 0.22, 1.28, 0.95, { ry: Math.PI / 2 });

  /* Pengendara: jaket hijau, helm putih, condong agresif */
  const rider = new THREE.Group(); rider.name = 'rider';
  add(rider, rbox(0.36, 0.50, 0.26, 0.10, C.jacket, 0.6), 0, 1.45, 0.15, { rx: -0.22 });
  add(rider, sphere(0.19, C.helmet, 0.45), 0, 1.86, 0.02);
  add(rider, rbox(0.26, 0.10, 0.08, 0.03, P.tire, 0.4), 0, 1.84, -0.14);
  add(rider, rbox(0.30, 0.05, 0.30, 0.02, C.jacket, 0.5), 0, 1.95, 0.02);
  for (const sx of [-1, 1]) {
    limb(rider, [sx * 0.20, 1.62, 0.05], [sx * 0.24, 1.27, -0.58], 0.06, C.jacket, 0.6);
    add(rider, sphere(0.06, P.skin, 0.6), sx * 0.24, 1.26, -0.60);
    limb(rider, [sx * 0.14, 1.08, 0.28], [sx * 0.20, 0.82, -0.02], 0.07, P.asphaltDark, 0.7);
    limb(rider, [sx * 0.20, 0.82, -0.02], [sx * 0.22, 0.48, 0.12], 0.06, P.asphaltDark, 0.7);
    add(rider, rbox(0.10, 0.08, 0.22, 0.03, P.tire, 0.7), sx * 0.22, 0.46, 0.10);
  }
  g.add(rider);
  return g;
}

/* =====================================================================
   MODEL PROSEDURAL — LANDMARK SALATIGA
   ===================================================================== */

function buildKoperasi(def) {
  const g = new THREE.Group(); g.name = 'koperasi_merah_putih';
  const C = def.colors;
  // Plinth & halaman
  add(g, rbox(12.2, 0.42, 10.6, 0.16, P.concrete, 0.8), 0, 0.21, 0, { receive: true });
  add(g, rbox(11.4, 0.18, 9.8, 0.08, P.stone, 0.78), 0, 0.46, 0, { receive: true });

  // Badan bangunan utama + sabuk merah bawah + lis atap
  add(g, rbox(9.2, 3.8, 6.8, 0.2, C.wall, 0.65), 0, 2.45, 0.2, { receive: true });
  add(g, rbox(9.35, 0.55, 6.95, 0.08, C.accent, 0.58), 0, 0.82, 0.2);
  add(g, rbox(9.45, 0.22, 7.05, 0.06, P.stone, 0.65), 0, 4.35, 0.2);

  // Atap pelana bertingkat dengan bevel + nok + kubah kecil
  add(g, rbox(5.6, 0.32, 7.9, 0.11, C.roof, 0.52), -2.2, 5.2, 0.2, { rz: 0.42 });
  add(g, rbox(5.6, 0.32, 7.9, 0.11, C.roof, 0.52), 2.2, 5.2, 0.2, { rz: -0.42 });
  add(g, rbox(0.8, 0.32, 8.0, 0.09, P.gold, 0.42, { metal: 0.35 }), 0, 6.22, 0.2);
  add(g, rbox(8.8, 1.65, 0.25, 0.06, C.wall, 0.65), 0, 4.95, -3.1);
  add(g, rbox(8.8, 1.65, 0.25, 0.06, C.wall, 0.65), 0, 4.95, 3.5);
  // Menara lonceng/kubah kecil atap
  add(g, rbox(1.5, 0.9, 1.5, 0.08, C.wall, 0.6), 0, 6.65, 0.2);
  add(g, rbox(1.75, 0.22, 1.75, 0.06, C.roof, 0.5), 0, 7.15, 0.2);
  add(g, cyl(0.08, 0.65, 0.75, C.roof, 0.5, 4), 0, 7.6, 0.2, { ry: Math.PI / 4 });

  // Serambi depan + pilar + tangga + kanopi belang merah-putih
  add(g, rbox(5.4, 0.26, 1.6, 0.06, P.concrete, 0.8), 0, 0.64, -3.7, { receive: true });
  add(g, rbox(3.0, 0.18, 0.8, 0.05, P.stone, 0.75), 0, 0.48, -4.45, { receive: true });
  for (const px of [-2.3, -1.1, 1.1, 2.3]) {
    add(g, rbox(0.32, 0.25, 0.32, 0.05, C.accent, 0.6), px, 0.88, -4.25);
    add(g, cyl(0.12, 0.14, 2.4, P.warmWhite, 0.55, 12), px, 2.15, -4.25);
  }
  add(g, rbox(1.8, 2.4, 0.16, 0.05, P.woodDark, 0.55), 0, 1.8, -3.22);
  add(g, rbox(1.4, 0.45, 0.1, 0.03, P.glass, 0.4, { mat: glassMat(), cast: false }), 0, 2.55, -3.24);
  for (let i = 0; i < 9; i++) {
    add(g, rbox(0.56, 0.14, 1.45, 0.04, i % 2 ? P.warmWhite : C.accent, 0.5), -2.24 + i * 0.56, 3.35, -3.95, { rx: 0.28 });
  }
  // Plang besar dengan bingkai emas
  add(g, rbox(6.6, 1.45, 0.22, 0.08, P.gold, 0.4, { metal: 0.45 }), 0, 4.35, -3.42);
  add(g, label('KOPERASI DESA\nMERAH PUTIH', 6.3, 1.28, { bg: C.accent, fg: P.warmWhite, h: 240, glow: 0.35, border: P.warmWhite }), 0, 4.35, -3.55);

  // Jendela berbingkai & daun jendela
  const addWindow = (x, y, z, ry = 0) => {
    const wg = new THREE.Group();
    add(wg, rbox(1.36, 1.36, 0.12, 0.04, P.warmWhite, 0.55), 0, 0, 0);
    add(wg, rbox(1.1, 1.1, 0.14, 0.03, P.glass, 0.35, { mat: glassMat(), cast: false }), 0, 0, 0.02);
    add(wg, rbox(1.48, 0.14, 0.24, 0.03, C.accent, 0.55), 0, -0.7, 0.05);
    add(wg, rbox(0.28, 1.24, 0.08, 0.02, P.toyGreen, 0.6), -0.82, 0, 0.03);
    add(wg, rbox(0.28, 1.24, 0.08, 0.02, P.toyGreen, 0.6), 0.82, 0, 0.03);
    wg.position.set(x, y, z);
    wg.rotation.y = ry;
    g.add(wg);
  };
  for (const wx of [-3.1, 3.1]) addWindow(wx, 2.35, -3.22, Math.PI);
  for (const sx of [-4.62, 4.62]) for (const wz of [-1.7, 0.2, 2.1]) {
    addWindow(sx, 2.35, wz, sx < 0 ? -Math.PI / 2 : Math.PI / 2);
  }
  for (const lx of [-1.25, 1.25]) add(g, sphere(0.14, P.headlight, 0.35, { emissive: P.headlight, ei: 1.5 }), lx, 2.95, -3.55);

  add(g, flagPole(6.2), 5.0, 0.55, -3.8);
  add(g, bush(0.6), -3.5, 0.72, -4.3);
  add(g, bush(0.6), 3.5, 0.72, -4.3);
  add(g, tree(1.05), -5.0, 0.55, 3.8);
  return g;
}

function buildPasarRaya(def) {
  const g = new THREE.Group(); g.name = 'pasar_raya_salatiga';
  const C = def.colors;
  // Plinth bertingkat & trotoar
  add(g, rbox(16.8, 0.42, 12.6, 0.16, P.concrete, 0.8), 0, 0.21, 0, { receive: true });
  add(g, rbox(16.0, 0.2, 11.8, 0.08, P.stone, 0.78), 0, 0.5, 0, { receive: true });

  // Hall utama dua tingkat + jendela atas (clerestory)
  add(g, rbox(13.6, 3.8, 8.0, 0.2, C.wall, 0.65), 0, 2.5, 1.0, { receive: true });
  add(g, rbox(13.8, 0.45, 8.2, 0.08, P.terracotta, 0.65), 0, 0.82, 1.0);
  add(g, rbox(9.6, 1.45, 5.2, 0.14, P.warmWhite, 0.65), 0, 5.2, 1.0);

  // Atap utama bertingkat hijau bevel + atap mahkota atas
  add(g, rbox(7.8, 0.34, 9.5, 0.12, C.roof, 0.5), -3.3, 4.95, 1.0, { rz: 0.34 });
  add(g, rbox(7.8, 0.34, 9.5, 0.12, C.roof, 0.5), 3.3, 4.95, 1.0, { rz: -0.34 });
  add(g, rbox(5.6, 0.28, 6.2, 0.1, C.roof, 0.5), -2.3, 6.25, 1.0, { rz: 0.36 });
  add(g, rbox(5.6, 0.28, 6.2, 0.1, C.roof, 0.5), 2.3, 6.25, 1.0, { rz: -0.36 });
  add(g, rbox(0.85, 0.32, 6.4, 0.09, P.toyYellow, 0.45), 0, 7.12, 1.0);

  // Jendela clerestory di lantai 2
  for (const cx of [-3.2, -1.6, 0, 1.6, 3.2]) {
    add(g, rbox(1.1, 0.75, 0.12, 0.03, P.glass, 0.35, { mat: glassMat(), cast: false }), cx, 5.2, -1.62);
  }
  // Jendela samping gedung
  for (const sx of [-6.82, 6.82]) for (const wz of [-1.2, 1.0, 3.2]) {
    add(g, rbox(0.14, 1.4, 1.5, 0.04, P.warmWhite, 0.55), sx, 2.75, wz);
    add(g, rbox(0.16, 1.1, 1.2, 0.03, P.glass, 0.35, { mat: glassMat(), cast: false }), sx, 2.75, wz);
  }

  // Arkade depan dengan 6 pilar + balok + plang megah
  for (let i = 0; i < 6; i++) {
    const px = -5.75 + i * 2.3;
    add(g, rbox(0.55, 0.3, 0.55, 0.06, P.stone, 0.7), px, 0.75, -3.7);
    add(g, cyl(0.2, 0.24, 2.8, C.column, 0.55, 12), px, 2.25, -3.7);
    add(g, rbox(0.5, 0.22, 0.5, 0.05, C.column, 0.55), px, 3.7, -3.7);
  }
  add(g, rbox(14.2, 0.34, 3.0, 0.1, C.roof, 0.52), 0, 3.92, -3.75, { rx: -0.08 });
  add(g, rbox(9.6, 1.55, 0.26, 0.08, P.toyYellow, 0.42), 0, 3.9, -5.18);
  add(g, label('GEDUNG PASAR RAYA II', 9.2, 1.32, { bg: P.angkotGreenDark, fg: P.cream, h: 170, glow: 0.38, border: P.toyYellow }), 0, 3.9, -5.33);
  add(g, label('KOTA SALATIGA', 4.4, 0.62, { bg: P.warmWhite, fg: P.ink, h: 90, glow: 0.2, border: P.angkotGreenDark }), 0, 2.9, -5.3);

  // Empat lapak buah & sayur di bawah arkade dengan lampu gantung
  const stallColors = [[P.merahPutih, P.warmWhite], [P.toyGreen, P.warmWhite], [P.toyOrange, P.warmWhite], [P.toyBlue, P.warmWhite]];
  const produce = [P.toyOrange, P.toyRed, P.toyGreen, P.toyYellow];
  for (let s = 0; s < 4; s++) {
    const sx = -4.6 + s * 3.05;
    add(g, rbox(2.0, 0.65, 1.1, 0.07, P.wood, 0.7), sx, 0.88, -3.55, { receive: true });
    for (let i = 0; i < 5; i++) {
      add(g, rbox(0.46, 0.12, 1.45, 0.03, stallColors[s][i % 2], 0.55), sx - 0.92 + i * 0.46, 2.6, -3.6, { rx: 0.26 });
    }
    for (let f = 0; f < 6; f++) {
      add(g, sphere(0.14, produce[s], 0.52), sx - 0.6 + (f % 3) * 0.45, 1.28, -3.75 + Math.floor(f / 3) * 0.38);
    }
    add(g, sphere(0.13, P.headlight, 0.35, { emissive: P.headlight, ei: 1.5 }), sx, 3.35, -3.6);
  }

  // Gerobak kayu parkir di sisi hall
  const cart = new THREE.Group();
  add(cart, rbox(1.5, 0.65, 0.95, 0.06, P.wood, 0.7), 0, 0.9, 0);
  add(cart, wheel(0.32, 0.11, 'wheel_cart_L'), -0.65, 0.32, 0);
  add(cart, wheel(0.32, 0.11, 'wheel_cart_R'), 0.65, 0.32, 0);
  add(cart, cyl(0.04, 0.04, 1.0, P.woodDark, 0.7, 8), 0, 1.0, -0.95, { rx: 1.1 });
  add(cart, rbox(1.65, 0.1, 1.05, 0.04, P.merahPutih, 0.55), 0, 1.72, 0);
  add(cart, cyl(0.04, 0.04, 0.55, P.woodDark, 0.7, 8), -0.65, 1.42, 0.42);
  add(cart, cyl(0.04, 0.04, 0.55, P.woodDark, 0.7, 8), 0.65, 1.42, 0.42);
  cart.position.set(7.2, 0.5, -4.1); cart.rotation.y = 0.45;
  g.add(cart);
  return g;
}

function buildRumdin(def) {
  const g = new THREE.Group(); g.name = 'rumah_dinas_walikota';
  const C = def.colors;
  // Taman & teras bertingkat + pagar rendah keliling
  add(g, rbox(14.8, 0.42, 11.8, 0.16, P.grass, 0.8), 0, 0.21, 0, { receive: true });
  add(g, rbox(13.8, 0.2, 10.6, 0.08, P.stone, 0.78), 0, 0.48, 0, { receive: true });

  // Bangunan utama kolonial megah + sayap samping
  add(g, rbox(9.6, 3.8, 7.0, 0.2, C.wall, 0.62), 0, 2.45, 0.9, { receive: true });
  add(g, rbox(9.8, 0.38, 7.2, 0.08, P.stone, 0.7), 0, 0.75, 0.9);
  add(g, rbox(9.9, 0.24, 7.3, 0.06, P.warmWhite, 0.55), 0, 4.38, 0.9);

  // Atap limasan bertingkat terakota + ornamen mahkota atap
  add(g, rbox(10.5, 0.3, 4.3, 0.1, C.roof, 0.55), 0, 5.15, -0.9, { rx: -0.48 });
  add(g, rbox(10.5, 0.3, 4.3, 0.1, C.roof, 0.55), 0, 5.15, 2.7, { rx: 0.48 });
  add(g, rbox(4.0, 0.3, 7.9, 0.1, C.roof, 0.55), -3.45, 5.15, 0.9, { rz: 0.48 });
  add(g, rbox(4.0, 0.3, 7.9, 0.1, C.roof, 0.55), 3.45, 5.15, 0.9, { rz: -0.48 });
  add(g, rbox(4.8, 0.42, 2.2, 0.1, C.roof, 0.52), 0, 6.25, 0.9);
  add(g, rbox(5.0, 0.34, 0.55, 0.09, P.gold, 0.42, { metal: 0.4 }), 0, 6.58, 0.9);

  // Pendopo depan megah: 6 pilar klasik putih + tangga seremonial
  add(g, rbox(7.8, 0.42, 2.8, 0.08, C.column, 0.65), 0, 0.72, -3.45, { receive: true });
  for (const cx of [-3.3, -1.98, -0.66, 0.66, 1.98, 3.3]) {
    add(g, rbox(0.42, 0.26, 0.42, 0.05, P.stone, 0.7), cx, 1.02, -4.45);
    add(g, cyl(0.16, 0.2, 2.7, C.column, 0.52, 14), cx, 2.45, -4.45);
    add(g, rbox(0.42, 0.2, 0.42, 0.05, C.column, 0.55), cx, 3.85, -4.45);
  }
  add(g, rbox(8.3, 0.3, 3.3, 0.1, C.roof, 0.55), 0, 4.08, -3.65, { rx: -0.12 });
  add(g, rbox(3.6, 0.18, 0.8, 0.05, P.concrete, 0.8), 0, 0.54, -5.05, { receive: true });
  add(g, rbox(2.8, 0.18, 0.55, 0.05, P.concrete, 0.8), 0, 0.72, -4.75, { receive: true });

  // Pintu kayu ganda + plang emas Walikota
  add(g, rbox(1.8, 2.55, 0.14, 0.05, P.woodDark, 0.58), 0, 2.15, -2.56);
  add(g, rbox(5.4, 1.05, 0.2, 0.07, P.gold, 0.42, { metal: 0.45 }), 0, 3.68, -2.62);
  add(g, label('RUMAH DINAS WALIKOTA\nSALATIGA', 5.1, 0.9, { bg: P.ink, fg: P.gold, h: 150, glow: 0.32, border: P.gold }), 0, 3.68, -2.74);

  // Jendela kolonial dengan daun jendela hijau
  for (const wx of [-3.1, 3.1]) {
    add(g, rbox(1.45, 1.45, 0.12, 0.04, P.warmWhite, 0.55), wx, 2.35, -2.56);
    add(g, rbox(1.2, 1.2, 0.14, 0.03, P.glass, 0.35, { mat: glassMat(), cast: false }), wx, 2.35, -2.57);
    for (const sx of [-0.85, 0.85]) add(g, rbox(0.3, 1.32, 0.08, 0.02, P.toyGreen, 0.6), wx + sx, 2.35, -2.59);
  }
  for (const sx of [-4.82, 4.82]) for (const wz of [-0.8, 1.2, 3.0]) {
    add(g, rbox(0.12, 1.4, 1.36, 0.04, P.warmWhite, 0.55), sx, 2.35, wz);
    add(g, rbox(0.14, 1.15, 1.15, 0.03, P.glass, 0.35, { mat: glassMat(), cast: false }), sx, 2.35, wz);
  }

  add(g, flagPole(6.4), -5.8, 0.55, -4.0);
  add(g, rbox(2.4, 0.08, 3.6, 0.03, P.concrete, 0.8), 0, 0.54, -4.3, { receive: true });
  for (const bx of [-2.3, 2.3]) {
    add(g, cyl(0.24, 0.3, 0.45, P.terracotta, 0.7, 12), bx, 0.72, -5.0);
    add(g, bush(0.5), bx, 1.2, -5.0);
    add(g, sphere(0.13, P.headlight, 0.35, { emissive: P.headlight, ei: 1.4 }), bx, 3.65, -4.55);
  }
  add(g, tree(1.25), -6.2, 0.55, 3.9);
  add(g, tree(1.1), 6.2, 0.55, 3.6);
  return g;
}

function buildMonas(def) {
  const g = new THREE.Group(); g.name = 'monas';
  const C = def.colors;
  // Pelataran plaza bertingkat & rumput
  add(g, rbox(7.8, 0.42, 7.8, 0.16, P.concrete, 0.8), 0, 0.21, 0, { receive: true });
  add(g, rbox(6.4, 0.22, 6.4, 0.08, C.lawn, 0.78), 0, 0.52, 0, { receive: true });

  // Cawan pedestal bertingkat dengan bevel halus
  add(g, rbox(4.6, 0.9, 4.6, 0.14, C.stone, 0.62), 0, 1.05, 0, { receive: true });
  add(g, rbox(3.4, 0.85, 3.4, 0.12, C.stone, 0.62), 0, 1.85, 0);
  add(g, rbox(2.5, 0.7, 2.5, 0.1, C.stone, 0.6), 0, 2.55, 0);
  // Pagar pelataran cawan
  add(g, rbox(3.55, 0.14, 3.55, 0.04, P.gold, 0.42, { metal: 0.45 }), 0, 2.3, 0);

  // Tugu obelisk bertingkat
  add(g, rbox(1.45, 6.2, 1.45, 0.12, C.stone, 0.58), 0, 5.95, 0);
  add(g, rbox(1.65, 0.42, 1.65, 0.08, C.stone, 0.58), 0, 9.15, 0);
  add(g, rbox(1.08, 5.2, 1.08, 0.1, C.stone, 0.58), 0, 11.85, 0);

  // Pelataran puncak emas + mahkota
  add(g, rbox(2.1, 0.58, 2.1, 0.1, C.stone, 0.56), 0, 14.7, 0);
  add(g, rbox(2.26, 0.14, 2.26, 0.05, C.gold, 0.35, { metal: 0.6 }), 0, 15.05, 0);
  add(g, rbox(1.55, 0.7, 1.55, 0.08, C.stone, 0.56), 0, 15.42, 0);

  /* Lidah api emas multi-part — suar kota saat golden hour */
  const goldMat = getMat(C.gold, 0.32, { metal: 0.75, emissive: C.gold, ei: 0.62 });
  add(g, cyl(0.52, 0.38, 0.42, C.gold, 0.32, 16, { mat: goldMat }), 0, 15.95, 0);
  add(g, sphere(0.42, C.gold, 0.32, { mat: goldMat }), 0, 16.32, 0);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.65, 14), goldMat);
  flame.castShadow = true;
  add(g, flame, 0, 17.25, 0);

  /* Pagar keliling + 4 lampu taman + plang emas */
  for (const [px, pz] of [[-2.9,-2.9],[2.9,-2.9],[-2.9,2.9],[2.9,2.9],[0,-2.9],[0,2.9],[-2.9,0],[2.9,0]]) {
    add(g, cyl(0.06, 0.07, 0.65, P.warmWhite, 0.58, 8), px, 0.92, pz);
  }
  for (const rz of [-2.9, 2.9]) add(g, rbox(5.9, 0.08, 0.08, 0.02, P.warmWhite, 0.58), 0, 1.2, rz);
  for (const rx of [-2.9, 2.9]) add(g, rbox(0.08, 0.08, 5.9, 0.02, P.warmWhite, 0.58), rx, 1.2, 0);
  for (const [lx, lz] of [[-3.4,-3.4],[3.4,-3.4],[-3.4,3.4],[3.4,3.4]]) {
    add(g, sphere(0.16, P.headlight, 0.35, { emissive: P.headlight, ei: 1.45 }), lx, 0.72, lz);
  }
  add(g, label('MONAS SALATIGA', 3.4, 0.65, { bg: P.ink, fg: P.gold, h: 110, glow: 0.35, border: P.gold }), 0, 1.15, -2.36);
  return g;
}

/* =====================================================================
   MODEL PROSEDURAL — BUAH MAINAN GLOSSY 3D (roughness: 0.2)
   ===================================================================== */
export const FRUIT_TYPES = Object.freeze(['strawberry', 'melon', 'banana', 'orange']);

function makeMelonTexture() {
  const key = 'tex|melon_stripes';
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#38b000';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1b5e20';
  const stripes = 8;
  const sw = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    const cx = i * sw + sw * 0.5;
    g.beginPath();
    for (let y = 0; y <= 128; y += 8) {
      const wave = Math.sin((y / 128) * Math.PI * 5 + i) * 5;
      const x = cx - 8 + wave;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    for (let y = 128; y >= 0; y -= 8) {
      const wave = Math.sin((y / 128) * Math.PI * 5 + i) * 5;
      g.lineTo(cx + 8 + wave, y);
    }
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  texCache.set(key, tex);
  return tex;
}

function getFruitGeo(key, factory) {
  if (!geoCache.has(key)) geoCache.set(key, factory());
  return geoCache.get(key);
}

export function buildToyFruit(type = 'strawberry') {
  const g = new THREE.Group();
  g.name = `fruit_${type}`;

  if (type === 'strawberry') {
    const bodyGeo = getFruitGeo('fr|straw_body', () => {
      const pts = [
        new THREE.Vector2(0.01, -0.62),
        new THREE.Vector2(0.24, -0.52),
        new THREE.Vector2(0.46, -0.22),
        new THREE.Vector2(0.58, 0.14),
        new THREE.Vector2(0.50, 0.42),
        new THREE.Vector2(0.26, 0.54),
        new THREE.Vector2(0.01, 0.55),
      ];
      return new THREE.LatheGeometry(pts, 20);
    });
    const berry = new THREE.Mesh(bodyGeo, getGlossMat('#e63946', { emissive: '#a4161a', ei: 0.18 }));
    berry.castShadow = true;
    g.add(berry);

    const seedGeo = getFruitGeo('fr|straw_seed', () => new THREE.SphereGeometry(0.042, 6, 5));
    const seedMat = getGlossMat('#ffbe0b', { emissive: '#ffbe0b', ei: 0.25 });
    const rings = [
      { y: 0.24, r: 0.55, count: 7, off: 0 },
      { y: -0.05, r: 0.49, count: 6, off: 0.45 },
      { y: -0.32, r: 0.36, count: 5, off: 0.2 },
    ];
    for (const rg of rings) {
      for (let k = 0; k < rg.count; k++) {
        const ang = (k / rg.count) * Math.PI * 2 + rg.off;
        const seed = new THREE.Mesh(seedGeo, seedMat);
        seed.position.set(Math.cos(ang) * rg.r, rg.y, Math.sin(ang) * rg.r);
        seed.scale.set(0.85, 1.35, 0.85);
        g.add(seed);
      }
    }

    const leafGeo = getFruitGeo('fr|leaf', () => {
      const lg = new THREE.ConeGeometry(0.18, 0.44, 5);
      lg.scale(1.0, 1.0, 0.35);
      return lg;
    });
    const leafMat = getGlossMat('#38b000', { rough: 0.28 });
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(ang) * 0.22, 0.52, Math.sin(ang) * 0.22);
      leaf.rotation.y = -ang;
      leaf.rotation.z = -1.25;
      g.add(leaf);
    }
    const stem = cyl(0.05, 0.07, 0.24, '#2b9348', 0.35, 8);
    stem.position.y = 0.65;
    g.add(stem);
    g.scale.setScalar(1.22);
  } else if (type === 'melon') {
    const melonGeo = getFruitGeo('fr|melon_body', () => new THREE.SphereGeometry(0.64, 22, 18));
    const melonMat = getGlossMat('#ffffff', {
      map: makeMelonTexture(), mapKey: 'melon',
      emissive: '#1b4332', ei: 0.14,
    });
    const body = new THREE.Mesh(melonGeo, melonMat);
    body.scale.set(1.06, 0.94, 1.06);
    body.castShadow = true;
    g.add(body);
    const stem = cyl(0.055, 0.08, 0.24, '#4d7c0f', 0.35, 8);
    stem.position.set(0.03, 0.65, 0);
    stem.rotation.z = -0.25;
    g.add(stem);
    g.scale.setScalar(1.16);
  } else if (type === 'banana') {
    const bananaGeo = getFruitGeo('fr|banana_body', () => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.56, -0.34, 0),
        new THREE.Vector3(-0.22, -0.48, 0),
        new THREE.Vector3(0.22, -0.32, 0),
        new THREE.Vector3(0.50, 0.08, 0),
        new THREE.Vector3(0.54, 0.50, 0),
      ]);
      const segU = 22, segV = 12;
      const tg = new THREE.TubeGeometry(curve, segU, 0.22, segV, false);
      const pos = tg.attributes.position;
      for (let u = 0; u <= segU; u++) {
        const t = u / segU;
        const center = curve.getPointAt(t);
        const taper = Math.max(0.22, Math.pow(Math.sin(t * Math.PI), 0.55));
        for (let v = 0; v <= segV; v++) {
          const idx = u * (segV + 1) + v;
          const vx = pos.getX(idx) - center.x;
          const vy = pos.getY(idx) - center.y;
          const vz = pos.getZ(idx) - center.z;
          pos.setXYZ(idx, center.x + vx * taper, center.y + vy * taper, center.z + vz * taper);
        }
      }
      tg.computeVertexNormals();
      return tg;
    });
    const body = new THREE.Mesh(bananaGeo, getGlossMat('#ffe135', { emissive: '#ffbe0b', ei: 0.16 }));
    body.castShadow = true;
    g.add(body);

    const tipMat = getGlossMat('#6b4423', { rough: 0.45 });
    const tipGeo = getFruitGeo('fr|banana_tip', () => new THREE.SphereGeometry(0.065, 8, 8));
    const t1 = new THREE.Mesh(tipGeo, tipMat); t1.position.set(-0.56, -0.34, 0);
    const t2 = new THREE.Mesh(tipGeo, tipMat); t2.position.set(0.54, 0.52, 0);
    g.add(t1, t2);
    g.rotation.z = 0.22;
    g.scale.setScalar(1.26);
  } else {
    // Orange
    const orangeGeo = getFruitGeo('fr|orange_body', () => new THREE.SphereGeometry(0.58, 22, 16));
    const body = new THREE.Mesh(orangeGeo, getGlossMat('#fb5607', { emissive: '#e85d04', ei: 0.18 }));
    body.scale.set(1.04, 0.96, 1.04);
    body.castShadow = true;
    g.add(body);

    const stem = cyl(0.05, 0.065, 0.22, '#2b9348', 0.35, 8);
    stem.position.y = 0.60;
    g.add(stem);

    const leafGeo = getFruitGeo('fr|orange_leaf', () => {
      const lg = new THREE.SphereGeometry(0.22, 10, 8);
      lg.scale(1.4, 0.25, 0.65);
      return lg;
    });
    const leafMat = getGlossMat('#38b000', { rough: 0.26 });
    const l1 = new THREE.Mesh(leafGeo, leafMat);
    l1.position.set(0.24, 0.62, 0.06);
    l1.rotation.set(0.2, 0.3, 0.35);
    const l2 = new THREE.Mesh(leafGeo, leafMat);
    l2.position.set(-0.20, 0.60, -0.05);
    l2.rotation.set(-0.15, -0.4, -0.32);
    g.add(l1, l2);
    g.scale.setScalar(1.2);
  }

  return g;
}

/* ==================== Registry & API publik ==================== */
const VEHICLE_BUILDERS = { angkot: buildAngkot, bemo: buildBemo, l300: buildL300, ojol: buildOjol };
const LANDMARK_BUILDERS = { koperasi: buildKoperasi, pasarRaya: buildPasarRaya, rumdin: buildRumdin, monas: buildMonas };

function getPrototype(kind, type) {
  const key = `${kind}:${type}`;
  if (!protoCache.has(key)) {
    protoCache.set(key, (async () => {
      const isV = kind === 'v';
      const def = isV ? getVehicleDef(type) : getLandmarkDef(type);
      let wrapper = null;
      try {
        wrapper = await tryLoadGLB(def.glbName, def.targetSize);
      } catch {
        console.info(`[assetFactory] ${def.glbName}.glb belum tersedia — memakai model prosedural ${def.label}.`);
        const builder = isV ? VEHICLE_BUILDERS[type] : LANDMARK_BUILDERS[type];
        const built = (builder || (isV ? buildAngkot : buildKoperasi))(def);
        wrapper = normalizeToTarget(built, def.targetSize);
        wrapper.userData.source = 'procedural';
      }
      wrapper.userData.kind = isV ? 'vehicle' : 'landmark';
      wrapper.userData.type = type;
      wrapper.userData.label = def.label;
      wrapper.userData.size = { ...def.targetSize };
      wrapper.userData.wheelRadius = isV ? def.wheelRadius : 0;
      if (isV) {
        attachSlotUnderglow(wrapper, def.targetSize);
        attachTwinExhaustFlames(wrapper, type, def.targetSize);
      }
      return wrapper;
    })());
  }
  return protoCache.get(key);
}

function instantiate(proto) {
  const clone = proto.clone(true); // geometri & material dibagi pakai (hemat memori)
  return bindRuntimeRefs(clone);
}

/** Kontrak terkunci: async loadVehicle(type) -> THREE.Group (pivot dasar y=0) */
export async function loadVehicle(type) {
  return instantiate(await getPrototype('v', type));
}

/** Kontrak terkunci: async loadLandmark(type) -> THREE.Group (pivot dasar y=0) */
export async function loadLandmark(type) {
  return instantiate(await getPrototype('l', type));
}

/** Pemuatan berurutan seluruh aset untuk layar muat. onProgress(i, total, label). */
export async function preloadAll(onProgress) {
  const jobs = [
    ...VEHICLE_TYPES.map((t) => ['v', t, VEHICLES[t].label]),
    ...LANDMARK_TYPES.map((t) => ['l', t, LANDMARKS[t].label]),
  ];
  for (let i = 0; i < jobs.length; i++) {
    const [kind, type, label] = jobs[i];
    await getPrototype(kind, type);
    onProgress?.(i + 1, jobs.length, label);
  }
}

/** Lepaskan seluruh cache (dipanggil saat teardown penuh). */
export function disposeAssetCache() {
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  for (const t of texCache.values()) t.dispose();
  geoCache.clear(); matCache.clear(); texCache.clear(); protoCache.clear();
  if (dracoLoader) { dracoLoader.dispose(); dracoLoader = null; gltfLoader = null; }
}

/** Pita neon 3D zero-GC di belakang kendaraan (untuk P1-P4) */
export function createNeonRibbonTrail(scene, hexColor = '#00e5ff', halfWidth = 0.56) {
  const N = 22;
  const positions = new Float32Array(N * 2 * 3);
  const colors = new Float32Array(N * 2 * 3);
  const histPos = new Float32Array(N * 3);
  const histRight = new Float32Array(N * 3);
  const indices = [];
  for (let i = 0; i < N - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  const baseCol = new THREE.Color(hexColor);
  let initialized = false;
  let lastDistSq = 0;

  function applyColor() {
    for (let i = 0; i < N; i++) {
      const fade = Math.pow(1 - i / (N - 1), 1.65);
      const r = baseCol.r * fade, g = baseCol.g * fade, b = baseCol.b * fade;
      const cIdx = i * 6;
      colors[cIdx] = r; colors[cIdx + 1] = g; colors[cIdx + 2] = b;
      colors[cIdx + 3] = r; colors[cIdx + 4] = g; colors[cIdx + 5] = b;
    }
    geo.attributes.color.needsUpdate = true;
  }
  applyColor();

  function rebuildVertices() {
    for (let i = 0; i < N; i++) {
      const taper = halfWidth * (1 - (i / (N - 1)) * 0.78);
      const cx = histPos[i * 3], cy = histPos[i * 3 + 1], cz = histPos[i * 3 + 2];
      const rx = histRight[i * 3] * taper, ry = histRight[i * 3 + 1] * taper, rz = histRight[i * 3 + 2] * taper;
      const vIdx = i * 6;
      positions[vIdx] = cx - rx; positions[vIdx + 1] = cy - ry; positions[vIdx + 2] = cz - rz;
      positions[vIdx + 3] = cx + rx; positions[vIdx + 4] = cy + ry; positions[vIdx + 5] = cz + rz;
    }
    geo.attributes.position.needsUpdate = true;
  }

  function reset(x = 0, y = 0, z = 0) {
    initialized = true;
    for (let i = 0; i < N; i++) {
      histPos[i * 3] = x; histPos[i * 3 + 1] = y; histPos[i * 3 + 2] = z;
      histRight[i * 3] = 1; histRight[i * 3 + 1] = 0; histRight[i * 3 + 2] = 0;
    }
    rebuildVertices();
  }

  function update(x, y, z, rx = 1, ry = 0, rz = 0) {
    if (!initialized) { reset(x, y, z); return; }
    const dx = x - histPos[0], dy = y - histPos[1], dz = z - histPos[2];
    lastDistSq = dx * dx + dy * dy + dz * dz;
    if (lastDistSq > 144) { reset(x, y, z); return; }
    if (lastDistSq > 0.28) {
      for (let i = N - 1; i > 0; i--) {
        const dst = i * 3, src = (i - 1) * 3;
        histPos[dst] = histPos[src]; histPos[dst + 1] = histPos[src + 1]; histPos[dst + 2] = histPos[src + 2];
        histRight[dst] = histRight[src]; histRight[dst + 1] = histRight[src + 1]; histRight[dst + 2] = histRight[src + 2];
      }
      histPos[0] = x; histPos[1] = y; histPos[2] = z;
      histRight[0] = rx; histRight[1] = ry; histRight[2] = rz;
    } else {
      histPos[0] = x; histPos[1] = y; histPos[2] = z;
      histRight[0] = rx; histRight[1] = ry; histRight[2] = rz;
    }
    rebuildVertices();
  }

  function setColor(hex) {
    baseCol.set(hex);
    applyColor();
  }

  function setVisible(v) { mesh.visible = !!v; }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
  }

  return { update, reset, setColor, setVisible, dispose };
}

