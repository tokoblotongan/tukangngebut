/* =====================================================================
   salatigaLandmark.js — Streaming landmark ikonik Salatiga di pinggir
   trek. Memakai pipeline dual-mode assetFactory (GLB → prosedural).
   Pool tetap per tipe (tanpa kloning runtime) agar referensi userData
   tetap valid. Landmark muncul tiap TRACK.landmarkEvery segmen,
   bergantian kiri/kanan, menghadap jalan.
   ===================================================================== */
import * as THREE from 'three';
import { TRACK, LANDMARKS, LANDMARK_TYPES, PALETTE as P } from '../config/gameConfig.js';
import { loadLandmark } from '../entities/assetFactory.js';
import { FLOOR_Y } from './trackGenerator.js';

const L = TRACK.segmentLength;
const EVERY = TRACK.landmarkEvery;
const POOL_PER_TYPE = 5;
const LANDMARK_SCALE = 0.80;

function makeSoftShadowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 22, 128, 128, 128);
  grad.addColorStop(0, 'rgba(20,30,48,0.52)');
  grad.addColorStop(0.58, 'rgba(20,30,48,0.22)');
  grad.addColorStop(1, 'rgba(20,30,48,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function createLandmarkManager(scene) {
  const shadowTex = makeSoftShadowTex();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, opacity: 0.62,
  });
  const rimGeo = new THREE.BoxGeometry(1.04, 0.14, 1.04);
  const rimMat = new THREE.MeshStandardMaterial({ color: P.stone, roughness: 0.78 });
  const spurGeo = new THREE.BoxGeometry(1, 0.18, 1);
  const spurMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.86 });

  /* Preload pool tetap per tipe — semua async di sini, bukan di loop */
  const freeByType = {};
  const allGroups = [];
  for (const type of LANDMARK_TYPES) {
    freeByType[type] = [];
    for (let k = 0; k < POOL_PER_TYPE; k++) {
      const g = await loadLandmark(type);
      const def = LANDMARKS[type];

      /* Skala diorama samping agar jalan raya tetap jadi pusat perhatian utama */
      g.scale.setScalar(LANDMARK_SCALE);

      /* Soft contact shadow tepat di bawah pondasi landmark */
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.03;
      shadow.scale.set(def.targetSize.x * 1.22, def.targetSize.z * 1.22, 1);
      shadow.renderOrder = 1;
      g.add(shadow);

      /* Pelat trotoar tipis rata tanah (tanpa tiang hijau tinggi) */
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.07;
      rim.scale.set(def.targetSize.x * 1.06, 1, def.targetSize.z * 1.06);
      rim.receiveShadow = true;
      g.add(rim);

      /* Apron/jalan masuk aspal kecil menghubungkan halaman bangunan ke jalan samping */
      const spur = new THREE.Mesh(spurGeo, spurMat);
      spur.position.set(0, 0.09, -(def.targetSize.z * 0.5 + 3.0));
      spur.scale.set(Math.min(def.targetSize.x * 0.56, 3.8), 1, 6.0);
      spur.receiveShadow = true;
      g.add(spur);

      g.visible = false;
      scene.add(g);
      freeByType[type].push(g);
      allGroups.push(g);
    }
  }

  const slots = []; // { key, index, side, type, group }

  function landmarkSpec(i, side) {
    const n = Math.floor(i / EVERY);
    const offsetIdx = side < 0 ? n : (n + 1 + (n % 2));
    const type = LANDMARK_TYPES[offsetIdx % LANDMARK_TYPES.length];
    const def = LANDMARKS[type];
    const zOffset = side < 0 ? 0 : (L * 0.28);
    const z = -(i + 0.5) * L - zOffset;
    const scaledDepth = def.targetSize.z * LANDMARK_SCALE;
    const x = side * (23.4 + scaledDepth * 0.5);
    return { key: `${i}:${side}`, index: i, side, type, z, x, def };
  }

  function place(slot, spec) {
    const group = freeByType[spec.type].pop();
    if (!group) return false;
    slot.key = spec.key;
    slot.index = spec.index;
    slot.side = spec.side;
    slot.type = spec.type;
    slot.group = group;
    group.visible = true;
    /* Duduk langsung di dasar daratan diorama (FLOOR_Y) */
    group.position.set(spec.x, FLOOR_Y, spec.z);
    group.rotation.set(0, spec.side < 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    return true;
  }

  function release(slot) {
    if (!slot.group) return;
    slot.group.visible = false;
    freeByType[slot.type].push(slot.group);
    slot.group = null; slot.index = null; slot.type = null; slot.key = null;
  }

  function update(playerZ) {
    const cur = Math.floor(-playerZ / L);
    const min = cur - TRACK.segmentsBehind;
    const max = cur + TRACK.segmentsAhead;

    const needed = [];
    for (let i = Math.max(2, min); i <= max; i++) {
      if (i % EVERY === 0) {
        needed.push(landmarkSpec(i, -1));
        needed.push(landmarkSpec(i, 1));
      }
    }
    const neededKeys = new Set(needed.map((s) => s.key));

    for (const slot of slots) {
      if (slot.key !== null && !neededKeys.has(slot.key)) release(slot);
    }
    for (let k = slots.length - 1; k >= 0; k--) {
      if (slots[k].key === null) slots.splice(k, 1);
    }

    const presentKeys = new Set(slots.map((s) => s.key));
    for (const spec of needed) {
      if (presentKeys.has(spec.key)) continue;
      const slot = { key: null, index: null, side: null, type: null, group: null };
      if (place(slot, spec)) slots.push(slot);
    }
  }

  function dispose() {
    for (const g of allGroups) scene.remove(g);
    for (const type of LANDMARK_TYPES) freeByType[type].length = 0;
    slots.length = 0;
    shadowTex.dispose(); shadowGeo.dispose(); shadowMat.dispose();
    rimGeo.dispose(); rimMat.dispose();
    spurGeo.dispose(); spurMat.dispose();
  }

  return { update, dispose, get activeCount() { return slots.length; } };
}
