/* =====================================================================
   trackGenerator.js — Trek streaming undulasi + object pooling,
   tekstur aspal hand-painted Dota 2 + normal map + transisi bahu rumput,
   foliage berlapis (InstancedMesh rumput & bunga dengan wind sway, pohon
   kanopi berlapis, semak hias ungu/zamrud + contact shadow), koin emas,
   permata pelangi, dan buah mainan 3D glossy di atas cincin bercahaya.
   Fungsi murni (tanpa scene): getTrackHeight, getTrackSlope,
   checkRampCollision, checkBoostCollision, getSegmentType.
   Arah maju = -Z. Segmen i membentang z ∈ [-i*L, -(i+1)*L].
   ===================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TRACK, PHYSICS, PALETTE as P } from '../config/gameConfig.js';
import { FRUIT_TYPES, buildToyFruit } from '../entities/assetFactory.js';

const L = TRACK.segmentLength;
const W = TRACK.width;
const BRIDGE_H = 4.6;
const FLOOR_Y = -8.5;
const RAMP_W = 7, RAMP_LEN = 5, RAMP_RISE = 1.5;
const BOOST_W = 4, BOOST_LEN = 3;
const MAX_COLLECTIBLES = 14;
const GRASS_PER_SEG = 34;
const FLOWERS_PER_SEG = 18;

/* ---------- Util deterministik ---------- */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export function getSegmentType(i) {
  if (i < 3) return 'plain';
  if (i % TRACK.bridgeEvery === 0) return 'bridge';
  if (i % TRACK.rampEvery === 0) return 'ramp';
  if (i % TRACK.boostEvery === 0) return 'boost';
  return 'plain';
}

/* ---------- Matematika ketinggian & kemiringan (kontrak terkunci) ---------- */
export function getTrackHeight(z) {
  const { amp1, freq1, amp2, freq2 } = TRACK.hill;
  let h = amp1 * Math.sin(z * freq1) + amp2 * Math.sin(z * freq2 + 1.7);
  const i = Math.floor(-z / L);
  if (getSegmentType(i) === 'bridge') {
    const z0 = -i * L, z1 = -(i + 1) * L;
    const t = (z - z0) / (z1 - z0);
    h += BRIDGE_H * (smoothstep(0, 0.28, t) - smoothstep(0.72, 1, t));
  }
  return h;
}
export function getTrackSlope(z) {
  const e = 0.4;
  return (getTrackHeight(z + e) - getTrackHeight(z - e)) / (2 * e);
}

/* ---------- Deteksi ramp & boost pad (murni, dipakai playerController) ---------- */
export function checkRampCollision(x, z) {
  const i = Math.floor(-z / L);
  if (getSegmentType(i) !== 'ramp') return null;
  const zc = -(i + 0.5) * L;
  if (Math.abs(z - zc) < RAMP_LEN / 2 && Math.abs(x) < RAMP_W / 2) {
    return { z: zc, x: 0, width: RAMP_W, launchVy: PHYSICS.ramp.launchVy, topY: getTrackHeight(zc) + RAMP_RISE };
  }
  return null;
}
export function checkBoostCollision(x, z) {
  const i = Math.floor(-z / L);
  if (getSegmentType(i) !== 'boost') return null;
  const zc = -(i + 0.5) * L;
  if (Math.abs(z - zc) < BOOST_LEN / 2 && Math.abs(x) < BOOST_W / 2) return { z: zc, x: 0, width: BOOST_W };
  return null;
}

/* ---------- Tekstur aspal hand-painted Dota 2 + Normal Map ---------- */
function makeStylizedRoadTextures() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');

  // Gradien dasar aspal hangat-sejuk (tepi agak lebih gelap & menyatu dengan bahu)
  const baseGrad = g.createLinearGradient(0, 0, size, 0);
  baseGrad.addColorStop(0, '#363c48');
  baseGrad.addColorStop(0.08, '#464d5c');
  baseGrad.addColorStop(0.5, '#4c5464');
  baseGrad.addColorStop(0.92, '#464d5c');
  baseGrad.addColorStop(1, '#363c48');
  g.fillStyle = baseGrad;
  g.fillRect(0, 0, size, size);

  // Sapuan kuas hand-painted lembut ala Source 2
  for (let i = 0; i < 420; i++) {
    const x = hash(i * 13.7) * size;
    const y = hash(i * 29.3) * size;
    const w = 18 + hash(i * 7.1) * 54;
    const h = 4 + hash(i * 19.9) * 10;
    const bright = hash(i * 41.3) > 0.5;
    g.fillStyle = bright ? 'rgba(130, 146, 175, 0.06)' : 'rgba(26, 30, 38, 0.07)';
    g.beginPath();
    g.ellipse(x, y, w * 0.5, h * 0.5, (hash(i * 3.7) - 0.5) * 0.25, 0, Math.PI * 2);
    g.fill();
  }

  // Jejak ban halus di 3 lajur (kiri, tengah, kanan)
  for (const laneCenter of [size * 0.2, size * 0.5, size * 0.8]) {
    for (const trackOff of [-22, 22]) {
      const trGrad = g.createLinearGradient(laneCenter + trackOff - 16, 0, laneCenter + trackOff + 16, 0);
      trGrad.addColorStop(0, 'rgba(22,26,34,0)');
      trGrad.addColorStop(0.5, 'rgba(22,26,34,0.18)');
      trGrad.addColorStop(1, 'rgba(22,26,34,0)');
      g.fillStyle = trGrad;
      g.fillRect(laneCenter + trackOff - 16, 0, 32, size);
    }
  }

  // Detail bintik agregat halus
  for (let i = 0; i < 900; i++) {
    const x = hash(i * 5.3 + 9) * size;
    const y = hash(i * 11.1 + 3) * size;
    g.fillStyle = i % 2 === 0 ? 'rgba(255,245,225,0.035)' : 'rgba(15,20,30,0.05)';
    g.fillRect(x, y, 2, 2);
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 2);
  map.anisotropy = 4;

  // Normal map prosedural untuk tekstur taktil halus
  const nc = document.createElement('canvas'); nc.width = nc.height = 256;
  const ng = nc.getContext('2d');
  const img = ng.createImageData(256, 256);
  const hBuf = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n1 = Math.sin(x * 0.14 + Math.cos(y * 0.11) * 1.4) * 0.35;
      const n2 = Math.cos(y * 0.22 + x * 0.06) * 0.25;
      const n3 = (hash(x * 37 + y * 131) - 0.5) * 0.4;
      hBuf[y * 256 + x] = n1 + n2 + n3;
    }
  }
  const strength = 1.4;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const xm = (x - 1 + 256) & 255;
      const xp = (x + 1) & 255;
      const ym = (y - 1 + 256) & 255;
      const yp = (y + 1) & 255;
      const dx = (hBuf[y * 256 + xp] - hBuf[y * 256 + xm]) * strength;
      const dy = (hBuf[yp * 256 + x] - hBuf[ym * 256 + x]) * strength;
      const len = Math.hypot(-dx, -dy, 1);
      const idx = (y * 256 + x) * 4;
      img.data[idx] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ng.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(3, 6);

  return { map, normalMap };
}

function makePlantShadowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(18,32,45,0.48)');
  grad.addColorStop(0.6, 'rgba(18,32,45,0.2)');
  grad.addColorStop(1, 'rgba(18,32,45,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowRingTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 16, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- Tekstur lantai diorama, blok ABC & gerbang ---------- */
function makePlayroomTex(kind) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  if (kind === 0) {
    // Padang rumput Dota 2 zamrud lembut + petak karpet hangat
    const cols = ['#74c69d', '#95d5b2', '#52b788', '#a3e4a8'];
    const sz = 64;
    for (let y = 0; y < 256; y += sz) {
      for (let x = 0; x < 512; x += sz) {
        const idx = ((x / sz) + (y / sz)) % 4;
        g.fillStyle = cols[idx];
        g.fillRect(x, y, sz, sz);
        g.strokeStyle = 'rgba(255,255,255,0.16)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, sz - 2, sz - 2);
      }
    }
  } else if (kind === 1) {
    // Taman bermain hijau zamrud dengan jalur jalan mini & bunga
    g.fillStyle = '#40916c';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#52b788';
    for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 32, 256);
    g.fillStyle = '#f9e5b4';
    g.fillRect(0, 96, 512, 64);
    g.strokeStyle = '#ffffff';
    g.setLineDash([18, 14]);
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 128); g.lineTo(512, 128); g.stroke();
    g.setLineDash([]);
    const flowers = ['#ff6b8b', '#ffbe0b', '#4cc9f0', '#fff8eb'];
    for (let k = 0; k < 14; k++) {
      g.fillStyle = flowers[k % flowers.length];
      g.beginPath();
      g.arc((k * 73 + 25) % 512, (k % 2 === 0 ? 44 : 210), 9, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Karpet kotak-kotak biru langit & aprikot hangat
    g.fillStyle = '#a8dadc';
    g.fillRect(0, 0, 512, 256);
    const sz = 64;
    for (let y = 0; y < 256; y += sz) {
      for (let x = 0; x < 512; x += sz) {
        if (((x / sz) + (y / sz)) % 2 === 0) {
          g.fillStyle = '#ffe5b8';
          g.fillRect(x, y, sz, sz);
        }
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 3;
        g.strokeRect(x, y, sz, sz);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.anisotropy = 4;
  return tex;
}

function makeBlockTex(letter, bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f5e1c0';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(16, 16, 224, 224, 22); g.fill();
  g.strokeStyle = '#fff8eb';
  g.lineWidth = 10;
  g.beginPath(); g.roundRect(24, 24, 208, 208, 16); g.stroke();
  g.fillStyle = fg;
  g.font = '700 138px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeArchBannerTex() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = P.toyRed;
  g.beginPath(); g.roundRect(6, 6, 1012, 180, 26); g.fill();
  g.strokeStyle = P.toyYellow;
  g.lineWidth = 12;
  g.beginPath(); g.roundRect(14, 14, 996, 164, 20); g.stroke();
  g.fillStyle = '#fff8eb';
  g.font = '700 66px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('★  JURAGAN NGEBUT • SALATIGA  ★', 512, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* =====================================================================
   VISUAL STREAMING — pool segmen tetap, didaur ulang tanpa alokasi baru
   ===================================================================== */
export function createTrackGenerator(scene) {
  const roadTex = makeStylizedRoadTextures();
  const matAsphalt = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.78,
    metalness: 0.04,
  });

  /* Material bahu jalan dengan transisi vertex color curb → rumput */
  const matShoulderBlend = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  const matDeckSide = new THREE.MeshStandardMaterial({ color: P.concrete, roughness: 0.72 });
  const matCurb = new THREE.MeshStandardMaterial({ color: P.stone, roughness: 0.65 });
  const matLine = new THREE.MeshStandardMaterial({ color: P.line, roughness: 0.55, emissive: P.line, emissiveIntensity: 0.12 });
  const matRamp = new THREE.MeshStandardMaterial({ color: P.toyOrange, roughness: 0.44 });
  const matRampStripe = new THREE.MeshStandardMaterial({ color: P.toyYellow, roughness: 0.4, emissive: P.toyYellow, emissiveIntensity: 0.28 });
  const matBoost = new THREE.MeshStandardMaterial({ color: P.toyYellow, roughness: 0.38, emissive: P.toyYellow, emissiveIntensity: 0.6 });
  const matChevron = new THREE.MeshStandardMaterial({ color: P.toyOrange, roughness: 0.42, emissive: P.toyOrange, emissiveIntensity: 0.45 });
  const matPillar = new THREE.MeshStandardMaterial({ color: P.concrete, roughness: 0.75 });
  const matRailColors = [
    new THREE.MeshStandardMaterial({ color: P.toyRed, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: P.toyYellow, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: P.toyBlue, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: P.warmWhite, roughness: 0.44 }),
  ];

  /* Foliage berlapis + wind shader */
  const windUniform = { value: 0 };
  function applyWindShader(mat, amp = 0.15) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windUniform;
      shader.vertexShader = `uniform float uWindTime;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wPhase = 0.0;
        #ifdef USE_INSTANCING
          wPhase = instanceMatrix[3].x * 0.45 + instanceMatrix[3].z * 0.35;
        #endif
        float sway = sin(uWindTime * 2.4 + wPhase + position.y * 2.1) * max(0.0, position.y) * ${amp.toFixed(3)};
        transformed.x += sway;
        transformed.z += sway * 0.45;`
      );
    };
  }

  const matTrunk = new THREE.MeshStandardMaterial({ color: P.woodDark, roughness: 0.82 });
  const matLeaf1 = new THREE.MeshStandardMaterial({ color: '#38b000', roughness: 0.72 });
  const matLeaf2 = new THREE.MeshStandardMaterial({ color: '#4d7c0f', roughness: 0.74 });
  const matLeaf3 = new THREE.MeshStandardMaterial({ color: '#52b788', roughness: 0.7 });
  const matBushEmerald = new THREE.MeshStandardMaterial({ color: '#2ec4b6', roughness: 0.7 });
  const matBushPurple = new THREE.MeshStandardMaterial({ color: '#8338ec', roughness: 0.65 });
  const matBerry = new THREE.MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.35, emissive: '#ffbe0b', emissiveIntensity: 0.2 });

  const matGrassTuft = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.78, side: THREE.DoubleSide });
  applyWindShader(matGrassTuft, 0.22);
  const matFlower = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 });
  applyWindShader(matFlower, 0.18);

  const plantShadowTex = makePlantShadowTex();
  const matPlantShadow = new THREE.MeshBasicMaterial({
    map: plantShadowTex, transparent: true, depthWrite: false, opacity: 0.58,
  });

  const matLampPole = new THREE.MeshStandardMaterial({ color: P.tire, roughness: 0.52 });
  const matLampCollar = new THREE.MeshStandardMaterial({ color: P.toyRed, roughness: 0.42 });
  const matLampHead = new THREE.MeshStandardMaterial({ color: P.headlight, roughness: 0.3, emissive: P.headlight, emissiveIntensity: 1.5 });

  /* Material lantai diorama & blok ABC & gerbang */
  const floorTextures = [0, 1, 2].map((k) => makePlayroomTex(k));
  const floorMats = floorTextures.map((tex) => new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.86, metalness: 0.02,
  }));

  const blockSpecs = [
    ['A', P.pastelCoral, '#fff8eb'],
    ['B', P.pastelSky, '#fff8eb'],
    ['C', P.pastelMint, P.ink],
    ['1', P.pastelButter, P.ink],
    ['2', P.pastelLavender, '#fff8eb'],
    ['3', P.toyOrange, '#fff8eb'],
  ];
  const blockTextures = blockSpecs.map(([ch, bg, fg]) => makeBlockTex(ch, bg, fg));
  const blockMats = blockTextures.map((tex) => new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.52, metalness: 0.04,
  }));

  const archBannerTex = makeArchBannerTex();
  const matArchBanner = new THREE.MeshStandardMaterial({
    map: archBannerTex, roughness: 0.45, emissive: '#ffffff', emissiveMap: archBannerTex, emissiveIntensity: 0.22,
  });
  const matArchBlue = new THREE.MeshStandardMaterial({ color: P.toyBlue, roughness: 0.42 });
  const matArchGold = new THREE.MeshStandardMaterial({ color: P.coinGold, roughness: 0.22, metalness: 0.65 });
  const matFenceRed = new THREE.MeshStandardMaterial({ color: P.toyRed, roughness: 0.48 });
  const matFenceWhite = new THREE.MeshStandardMaterial({ color: P.warmWhite, roughness: 0.48 });

  /* Material koin emas mengilap (#FFBE0B), permata, & cincin bercahaya */
  const matCoinGold = new THREE.MeshPhysicalMaterial({
    color: P.coinGold, metalness: 0.86, roughness: 0.16,
    clearcoat: 0.85, clearcoatRoughness: 0.1,
    emissive: '#fb8500', emissiveIntensity: 0.24,
  });
  const matCoinRim = new THREE.MeshPhysicalMaterial({
    color: P.coinGoldRim, metalness: 0.88, roughness: 0.2,
    clearcoat: 0.85, emissive: '#f77f00', emissiveIntensity: 0.18,
  });
  const matGemHalo = new THREE.MeshStandardMaterial({
    color: '#ffffff', metalness: 0.5, roughness: 0.2,
    emissive: '#ffbe0b', emissiveIntensity: 0.55,
  });
  const glowRingTex = makeGlowRingTex();
  const RING_COLORS = {
    strawberry: '#ff4d6d',
    melon: '#2ec4b6',
    banana: '#ffe135',
    orange: '#fb5607',
    gem: '#ffbe0b',
  };
  const ringMats = Object.fromEntries(
    Object.entries(RING_COLORS).map(([k, col]) => [
      k,
      new THREE.MeshBasicMaterial({
        map: glowRingTex, color: col, transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    ])
  );

  /* Geometri bersama */
  const geoDash = new THREE.BoxGeometry(0.28, 0.03, 1.7);
  const geoRamp = new RoundedBoxGeometry(RAMP_W, 0.6, RAMP_LEN, 3, 0.14);
  const geoRampStripe = new THREE.BoxGeometry(RAMP_W - 0.6, 0.06, 0.4);
  const geoBoost = new RoundedBoxGeometry(BOOST_W, 0.12, BOOST_LEN, 3, 0.06);
  const geoChevron = new THREE.BoxGeometry(2.6, 0.06, 0.35);
  const geoPillar = new THREE.CylinderGeometry(0.55, 0.72, 1, 12);
  const geoGuardPost = new THREE.CylinderGeometry(0.09, 0.11, 0.88, 8);
  const geoGuardBeam = new RoundedBoxGeometry(0.16, 0.22, 4.1, 2, 0.04);

  const geoTrunk = new THREE.CylinderGeometry(0.14, 0.26, 1.25, 10);
  const geoCanopy = new THREE.SphereGeometry(0.86, 14, 10);
  const geoBushLobe = new THREE.SphereGeometry(0.56, 12, 10);
  const geoBerry = new THREE.SphereGeometry(0.1, 7, 6);
  const geoPlantShadow = new THREE.PlaneGeometry(2.4, 2.4);
  geoPlantShadow.rotateX(-Math.PI / 2);

  /* Geometri rumput & bunga instanced (pivot di y=0 agar wind sway dari akar) */
  const geoGrassTuft = (() => {
    const pos = [];
    const blades = [
      { ox: -0.14, oz: 0, h: 0.48, lean: -0.09, rot: 0.2 },
      { ox: 0.02, oz: 0.06, h: 0.62, lean: 0.06, rot: 1.4 },
      { ox: 0.14, oz: -0.04, h: 0.44, lean: 0.1, rot: 2.5 },
    ];
    for (const b of blades) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const w = 0.075;
      const p0 = [b.ox - w * c, 0, b.oz - w * s];
      const p1 = [b.ox + w * c, 0, b.oz + w * s];
      const p2 = [b.ox + b.lean, b.h, b.oz];
      pos.push(...p0, ...p1, ...p2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  })();

  const geoFlower = (() => {
    const g = new THREE.ConeGeometry(0.16, 0.34, 6);
    g.rotateX(Math.PI);
    g.translate(0, 0.26, 0);
    return g;
  })();

  const geoLampBase = new THREE.CylinderGeometry(0.18, 0.24, 0.35, 10);
  const geoLampPole = new THREE.CylinderGeometry(0.07, 0.09, 3.1, 8);
  const geoLampArm = new THREE.BoxGeometry(0.95, 0.08, 0.08);
  const geoLampHead = new THREE.SphereGeometry(0.22, 12, 10);

  const geoFloor = new THREE.PlaneGeometry(210, L);
  geoFloor.rotateX(-Math.PI / 2);
  const geoBlock = new RoundedBoxGeometry(4.6, 4.6, 4.6, 3, 0.32);
  const geoFencePost = new RoundedBoxGeometry(0.24, 1.15, 0.24, 2, 0.04);
  const geoFenceRail = new THREE.BoxGeometry(0.12, 0.16, 4.0);
  const geoArchPillar = new RoundedBoxGeometry(1.1, 10.8, 1.1, 3, 0.14);
  const geoArchBeam = new RoundedBoxGeometry(W + 3.4, 1.45, 1.25, 3, 0.18);
  const geoArchSign = new THREE.PlaneGeometry(W + 1.8, 2.2);
  const geoArchBulb = new THREE.SphereGeometry(0.22, 10, 8);
  const geoBunting = new THREE.ConeGeometry(0.32, 0.65, 3);

  /* Geometri koin, permata & cincin lantai */
  const geoCoinBody = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 20);
  geoCoinBody.rotateX(Math.PI / 2);
  const geoCoinRim = new THREE.TorusGeometry(0.55, 0.09, 10, 24);
  const geoCoinCore = new THREE.CylinderGeometry(0.30, 0.30, 0.21, 6);
  geoCoinCore.rotateX(Math.PI / 2);

  const geoGemStar = new THREE.OctahedronGeometry(0.68, 0);
  const geoGemRing = new THREE.TorusGeometry(0.92, 0.055, 8, 24);
  const geoGlowRing = new THREE.PlaneGeometry(2.35, 2.35);

  const pool = [];
  const POOL_SIZE = TRACK.segmentsAhead + TRACK.segmentsBehind + 2;

  function makeRoadGeo(width) {
    const g = new THREE.PlaneGeometry(width, L, 1, 14);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /** Bahu rumput-ke-trotoar di sisi kiri/kanan jalan dengan transisi vertex color halus */
  function makeShoulderBlendGeo(side) {
    const shoulderW = 2.6;
    const g = new THREE.PlaneGeometry(shoulderW, L, 2, 14);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const innerCol = new THREE.Color('#cfc4b4'); // stone curb
    const midCol = new THREE.Color('#65a30d');   // mossy grass transition
    const outerCol = new THREE.Color('#38b000'); // lush emerald
    const tmp = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const lx = pos.getX(v);
      // t = 0 di tepi dalam (menempel aspal), 1 di tepi luar
      const t = side < 0 ? (shoulderW * 0.5 - lx) / shoulderW : (lx + shoulderW * 0.5) / shoulderW;
      if (t < 0.35) tmp.lerpColors(innerCol, midCol, t / 0.35);
      else tmp.lerpColors(midCol, outerCol, (t - 0.35) / 0.65);
      cols[v * 3] = tmp.r;
      cols[v * 3 + 1] = tmp.g;
      cols[v * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  }

  function makeSkirtGeo() {
    const g = new THREE.PlaneGeometry(L, 1.25, 14, 1);
    g.rotateY(Math.PI / 2);
    return g;
  }

  function buildCoinMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(geoCoinBody, matCoinGold);
    const rim = new THREE.Mesh(geoCoinRim, matCoinRim);
    const core = new THREE.Mesh(geoCoinCore, matCoinRim);
    body.castShadow = true;
    g.add(body, rim, core);
    return g;
  }

  function buildGemMesh() {
    const g = new THREE.Group();
    const gemMat = new THREE.MeshPhysicalMaterial({
      color: '#ff6b6b', emissive: '#ff6b6b', emissiveIntensity: 0.65,
      roughness: 0.08, metalness: 0.25, clearcoat: 1.0,
    });
    const s1 = new THREE.Mesh(geoGemStar, gemMat);
    const s2 = new THREE.Mesh(geoGemStar, gemMat);
    s2.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    const ring = new THREE.Mesh(geoGemRing, matGemHalo);
    ring.rotation.x = Math.PI / 3;
    s1.castShadow = true;
    g.add(s1, s2, ring);
    g.userData.gemMat = gemMat;
    g.userData.ring = ring;
    return g;
  }

  function buildStyledTree() {
    const g = new THREE.Group();
    const shadow = new THREE.Mesh(geoPlantShadow, matPlantShadow);
    shadow.position.y = 0.04;
    g.add(shadow);

    const trunk = new THREE.Mesh(geoTrunk, matTrunk);
    trunk.position.y = 0.62;
    trunk.castShadow = true;
    g.add(trunk);

    const c1 = new THREE.Mesh(geoCanopy, matLeaf1); c1.position.set(0, 1.75, 0); c1.scale.set(1.12, 0.92, 1.12); c1.castShadow = true;
    const c2 = new THREE.Mesh(geoCanopy, matLeaf2); c2.position.set(-0.48, 1.48, 0.28); c2.scale.setScalar(0.74); c2.castShadow = true;
    const c3 = new THREE.Mesh(geoCanopy, matLeaf3); c3.position.set(0.46, 1.56, -0.22); c3.scale.setScalar(0.7); c3.castShadow = true;
    const c4 = new THREE.Mesh(geoCanopy, matLeaf3); c4.position.set(0.08, 2.34, 0.08); c4.scale.setScalar(0.66); c4.castShadow = true;
    g.add(c1, c2, c3, c4);
    return g;
  }

  function buildOrnamentalBush(isPurple) {
    const g = new THREE.Group();
    const shadow = new THREE.Mesh(geoPlantShadow, matPlantShadow);
    shadow.position.y = 0.04;
    shadow.scale.setScalar(0.65);
    g.add(shadow);

    const mat = isPurple ? matBushPurple : matBushEmerald;
    const m1 = new THREE.Mesh(geoBushLobe, mat); m1.position.set(0, 0.42, 0); m1.scale.set(1.15, 0.85, 1.15); m1.castShadow = true;
    const m2 = new THREE.Mesh(geoBushLobe, mat); m2.position.set(-0.42, 0.34, 0.14); m2.scale.setScalar(0.76); m2.castShadow = true;
    const m3 = new THREE.Mesh(geoBushLobe, mat); m3.position.set(0.4, 0.36, -0.12); m3.scale.setScalar(0.72); m3.castShadow = true;
    g.add(m1, m2, m3);

    if (isPurple) {
      for (const [bx, by, bz] of [[-0.25, 0.72, 0.2], [0.22, 0.74, -0.15], [0, 0.84, 0.05]]) {
        const b = new THREE.Mesh(geoBerry, matBerry);
        b.position.set(bx, by, bz);
        g.add(b);
      }
    }
    return g;
  }

  const _dummy = new THREE.Object3D();
  const _col = new THREE.Color();
  const GRASS_SHADES = ['#38b000', '#4d7c0f', '#52b788', '#70e000'];
  const FLOWER_SHADES = ['#ffbe0b', '#ff6b8b', '#4cc9f0', '#fff3b0', '#c77dff'];

  function buildSegment() {
    const group = new THREE.Group();
    const seg = {
      group, index: null, type: 'plain',
      road: null, shoulders: [], skirts: [], edges: [], dashes: [],
      guardPosts: [], guardBeams: [],
      ramp: null, boost: null, bridge: null, piers: [],
      floor: null, blocks: [], fences: [], arch: null,
      decor: [], grassInst: null, flowerInst: null,
      collectibles: [],
    };

    /* Lantai diorama playroom (di bawah jalan layang) */
    seg.floor = new THREE.Mesh(geoFloor, floorMats[0]);
    seg.floor.position.y = FLOOR_Y;
    seg.floor.receiveShadow = true;
    group.add(seg.floor);

    /* Balok kayu ABC pastel di kiri & kanan area diorama */
    for (let b = 0; b < 4; b++) {
      const m = new THREE.Mesh(geoBlock, blockMats[b % blockMats.length]);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      seg.blocks.push(m);
    }

    /* Pagar mainan belang di sisi diorama */
    for (const side of [-1, 1]) {
      const fg = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const lz = -L / 2 + 2 + k * 4;
        const post = new THREE.Mesh(geoFencePost, k % 2 ? matFenceRed : matFenceWhite);
        post.position.set(0, 0.58, lz);
        post.castShadow = true;
        fg.add(post);
      }
      for (const ry of [0.38, 0.82]) {
        for (let k = 0; k < 6; k++) {
          const rail = new THREE.Mesh(geoFenceRail, k % 2 ? matFenceWhite : matFenceRed);
          rail.position.set(0, ry, -L / 2 + 2 + k * 4);
          fg.add(rail);
        }
      }
      fg.position.set(side * 21.5, FLOOR_Y, 0);
      group.add(fg);
      seg.fences.push(fg);
    }

    /* Jalan aspal hand-painted + bahu rumput-trotoar blend + deck skirt */
    seg.road = new THREE.Mesh(makeRoadGeo(W), matAsphalt);
    seg.road.receiveShadow = true;
    group.add(seg.road);

    for (const side of [-1, 1]) {
      const sh = new THREE.Mesh(makeShoulderBlendGeo(side), matShoulderBlend);
      sh.position.x = side * (W / 2 + 1.3);
      sh.receiveShadow = true;
      group.add(sh);
      seg.shoulders.push({ mesh: sh, side });
    }

    for (const sx of [-W / 2, W / 2]) {
      const sk = new THREE.Mesh(makeSkirtGeo(), matDeckSide);
      sk.position.x = sx;
      sk.receiveShadow = true;
      group.add(sk);
      seg.skirts.push(sk);
    }

    for (const ex of [-W / 2 + 0.3, W / 2 - 0.3]) {
      const e = new THREE.Mesh(makeRoadGeo(0.26), matLine);
      e.position.x = ex; e.receiveShadow = true;
      group.add(e); seg.edges.push(e);
    }
    for (let d = 0; d < 6; d++) {
      const m = new THREE.Mesh(geoDash, matLine);
      group.add(m); seg.dashes.push(m);
    }

    /* Guardrail warna-warni di kedua sisi jalan */
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const post = new THREE.Mesh(geoGuardPost, matCurb);
        post.castShadow = true;
        group.add(post);
        seg.guardPosts.push({ mesh: post, side, k });

        const beam = new THREE.Mesh(geoGuardBeam, matRailColors[k % matRailColors.length]);
        beam.castShadow = true;
        group.add(beam);
        seg.guardBeams.push({ mesh: beam, side, k });
      }
    }

    /* Pilar penopang jalan layang ke lantai playroom */
    for (const px of [-W / 2 + 1.5, W / 2 - 1.5]) {
      const p = new THREE.Mesh(geoPillar, matPillar);
      p.castShadow = true;
      group.add(p);
      seg.piers.push({ mesh: p, x: px });
    }

    /* Ramp & Boost pad */
    const ramp = new THREE.Group();
    const slab = new THREE.Mesh(geoRamp, matRamp);
    slab.castShadow = true; slab.receiveShadow = true;
    ramp.add(slab);
    for (let s = 0; s < 3; s++) {
      const st = new THREE.Mesh(geoRampStripe, matRampStripe);
      st.position.set(0, 0.32, -1.4 + s * 1.4);
      ramp.add(st);
    }
    ramp.rotation.x = 0.27;
    ramp.visible = false;
    group.add(ramp); seg.ramp = ramp;

    const boost = new THREE.Group();
    const pad = new THREE.Mesh(geoBoost, matBoost);
    pad.receiveShadow = true;
    boost.add(pad);
    for (let c = 0; c < 3; c++) {
      const ch = new THREE.Mesh(geoChevron, matChevron);
      ch.position.set(0, 0.08, -0.9 + c * 0.9);
      ch.rotation.y = c % 2 ? 0.35 : -0.35;
      boost.add(ch);
    }
    boost.visible = false;
    group.add(boost); seg.boost = boost;

    /* Jembatan layang */
    const bridge = new THREE.Group();
    seg.pillars = [];
    for (const px of [-W / 2 + 1, W / 2 - 1]) for (const pz of [-L * 0.22, L * 0.22]) {
      const p = new THREE.Mesh(geoPillar, matPillar);
      p.castShadow = true; p.position.set(px, 0, pz);
      bridge.add(p); seg.pillars.push(p);
    }
    bridge.visible = false;
    group.add(bridge); seg.bridge = bridge;

    /* Gerbang festival di atas jalan (setiap archEvery segmen) */
    const arch = new THREE.Group();
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(geoArchPillar, matArchBlue);
      col.position.set(sx * (W / 2 + 1.15), 2.2, 0);
      col.castShadow = true;
      arch.add(col);
      const cap = new THREE.Mesh(geoArchBulb, matArchGold);
      cap.position.set(sx * (W / 2 + 1.15), 7.8, 0);
      cap.scale.setScalar(2.4);
      arch.add(cap);
    }
    const beam = new THREE.Mesh(geoArchBeam, matArchGold);
    beam.position.set(0, 6.7, 0);
    beam.castShadow = true;
    arch.add(beam);
    const signFront = new THREE.Mesh(geoArchSign, matArchBanner);
    signFront.position.set(0, 6.7, 0.66);
    arch.add(signFront);
    const signBack = new THREE.Mesh(geoArchSign, matArchBanner);
    signBack.position.set(0, 6.7, -0.66);
    signBack.rotation.y = Math.PI;
    arch.add(signBack);
    for (let b = 0; b < 7; b++) {
      const bx = -W / 2 + 1 + b * ((W - 2) / 6);
      const bulb = new THREE.Mesh(geoArchBulb, matLampHead);
      bulb.position.set(bx, 7.62, 0);
      arch.add(bulb);
      const flag = new THREE.Mesh(geoBunting, matRailColors[b % matRailColors.length]);
      flag.position.set(bx, 5.7, 0);
      flag.rotation.x = Math.PI;
      arch.add(flag);
    }
    arch.visible = false;
    group.add(arch);
    seg.arch = arch;

    /* Foliage pinggir: 3 pohon kanopi berlapis + 3 semak hias ungu/zamrud + 2 lampu jalan */
    for (let t = 0; t < 3; t++) {
      const tree = buildStyledTree();
      group.add(tree);
      seg.decor.push({ obj: tree, kind: 'tree', phase: t * 1.4 });
    }
    for (let b = 0; b < 3; b++) {
      const bush = buildOrnamentalBush(b === 1);
      group.add(bush);
      seg.decor.push({ obj: bush, kind: 'bush', phase: b * 1.7 + 0.5 });
    }
    for (let l = 0; l < 2; l++) {
      const lamp = new THREE.Group();
      const base = new THREE.Mesh(geoLampBase, matLampCollar); base.position.y = 0.17; base.castShadow = true;
      const pole = new THREE.Mesh(geoLampPole, matLampPole); pole.position.y = 1.72; pole.castShadow = true;
      const arm = new THREE.Mesh(geoLampArm, matLampPole); arm.position.set(0.42, 3.22, 0);
      const head = new THREE.Mesh(geoLampHead, matLampHead); head.position.set(0.84, 3.06, 0);
      lamp.add(base, pole, arm, head);
      group.add(lamp); seg.decor.push({ obj: lamp, kind: 'lamp', sideIdx: l });
    }

    /* InstancedMesh rumpun rumput & bunga liar di bahu jalan + halaman diorama */
    const grassInst = new THREE.InstancedMesh(geoGrassTuft, matGrassTuft, GRASS_PER_SEG);
    grassInst.frustumCulled = false;
    group.add(grassInst);
    seg.grassInst = grassInst;

    const flowerInst = new THREE.InstancedMesh(geoFlower, matFlower, FLOWERS_PER_SEG);
    flowerInst.frustumCulled = false;
    group.add(flowerInst);
    seg.flowerInst = flowerInst;

    /* Pool kolektibel per segmen (koin emas, permata pelangi, & buah 3D glossy) */
    for (let c = 0; c < MAX_COLLECTIBLES; c++) {
      const wrapper = new THREE.Group();
      const coinMesh = buildCoinMesh();
      const gemMesh = buildGemMesh();
      const fruitType = FRUIT_TYPES[c % FRUIT_TYPES.length];
      const fruitMesh = buildToyFruit(fruitType);
      wrapper.add(coinMesh, gemMesh, fruitMesh);
      wrapper.visible = false;
      group.add(wrapper);

      const groundRing = new THREE.Mesh(geoGlowRing, ringMats[fruitType]);
      groundRing.rotation.x = -Math.PI / 2;
      groundRing.visible = false;
      groundRing.renderOrder = 2;
      group.add(groundRing);

      seg.collectibles.push({
        obj: wrapper,
        groundRing,
        coinMesh,
        gemMesh,
        fruitMesh,
        fruitType,
        kind: 'coin',
        lx: 0,
        lz: 0,
        baseY: 0,
        phase: c * 0.55,
        active: false,
        collected: false,
      });
    }

    scene.add(group);
    return seg;
  }

  function displace(mesh, centerZ, yOffset = 0) {
    const pos = mesh.geometry.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      pos.setY(v, getTrackHeight(centerZ + pos.getZ(v)) + yOffset);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceShoulder(mesh, side, centerZ) {
    const pos = mesh.geometry.attributes.position;
    const shoulderW = 2.6;
    for (let v = 0; v < pos.count; v++) {
      const lx = pos.getX(v);
      const t = side < 0 ? (shoulderW * 0.5 - lx) / shoulderW : (lx + shoulderW * 0.5) / shoulderW;
      const drop = t * 0.22;
      pos.setY(v, getTrackHeight(centerZ + pos.getZ(v)) - 0.01 - drop);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceSkirt(mesh, centerZ) {
    const pos = mesh.geometry.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const h = getTrackHeight(centerZ + pos.getZ(v));
      const isTop = v < pos.count / 2;
      pos.setY(v, isTop ? h + 0.01 : h - 1.25);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function assignCollectibles(seg, i, centerZ) {
    for (const item of seg.collectibles) {
      item.active = false;
      item.collected = false;
      item.obj.visible = false;
      item.groundRing.visible = false;
    }

    let cursor = 0;
    const placeItem = (kind, lx, lz, yOff) => {
      if (cursor >= MAX_COLLECTIBLES) return;
      const slot = seg.collectibles[cursor++];
      slot.kind = kind;
      slot.lx = lx;
      slot.lz = lz;
      const trackY = getTrackHeight(centerZ + lz);
      slot.baseY = trackY + yOff;
      slot.phase = (i * 0.9 + cursor * 0.65);
      slot.active = true;
      slot.collected = false;
      slot.coinMesh.visible = kind === 'coin';
      slot.gemMesh.visible = kind === 'gem';
      slot.fruitMesh.visible = kind === 'fruit';
      slot.obj.position.set(lx, slot.baseY, lz);
      slot.obj.visible = true;

      if (kind === 'fruit' || kind === 'gem') {
        slot.groundRing.material = ringMats[kind === 'gem' ? 'gem' : slot.fruitType];
        slot.groundRing.position.set(lx, trackY + 0.06, lz);
        slot.groundRing.rotation.set(-Math.PI / 2 - getTrackSlope(centerZ + lz), 0, 0);
        slot.groundRing.visible = true;
      } else {
        slot.groundRing.visible = false;
      }
    };

    const prevType = getSegmentType(i - 1);
    const LANE_W = W / TRACK.lanes;

    if (i === 0) {
      // Baris koin + buah mainan raksasa menyambut di depan start
      placeItem('coin', 0, -3.5, 0.95);
      placeItem('coin', 0, -6.0, 0.95);
      placeItem('fruit', 0, -9.2, 1.25);
      return;
    }

    if (seg.type === 'ramp') {
      placeItem('coin', 0, 5.5, 0.95);
      placeItem('coin', 0, 2.2, 1.2);
      const arcSteps = [-0.8, -3.2, -5.6, -8.0, -10.4];
      arcSteps.forEach((lz, idx) => {
        const u = (idx + 1) / arcSteps.length;
        const yOff = 1.6 + Math.sin(u * Math.PI * 0.58) * 3.15;
        const kind = idx === 3 ? 'gem' : idx === 2 ? 'fruit' : 'coin';
        placeItem(kind, 0, lz, yOff);
      });
      return;
    }

    if (prevType === 'ramp') {
      const descSteps = [10.4, 8.0, 5.6, 3.2, 0.8];
      descSteps.forEach((lz, idx) => {
        const u = idx / (descSteps.length - 1);
        const yOff = 4.4 - u * 3.35;
        placeItem(idx === 4 ? 'fruit' : 'coin', 0, lz, yOff);
      });
      placeItem('coin', LANE_W * 0.6, -4.5, 0.95);
      placeItem('coin', LANE_W * 0.9, -8.5, 0.95);
      return;
    }

    if (seg.type === 'boost') {
      const leadSide = hash(i * 19) > 0.5 ? 1 : -1;
      for (let k = 0; k < 5; k++) {
        const u = k / 4;
        const lz = 10.2 - u * 8.2;
        const lx = leadSide * LANE_W * (1 - u);
        placeItem('coin', lx, lz, 0.95);
      }
      placeItem('fruit', 0, -3.2, 1.25);
      placeItem('coin', 0, -7.0, 0.95);
      placeItem('coin', 0, -10.0, 0.95);
      return;
    }

    // Segmen normal / jembatan: pola slalom koin dengan buah glossy di puncak tikungan
    const dir = i % 2 === 0 ? 1 : -1;
    const count = 6;
    for (let k = 0; k < count; k++) {
      const u = k / (count - 1);
      const lz = 9.8 - u * 19.6;
      const lx = Math.sin(u * Math.PI * 1.5) * dir * LANE_W * 0.95;
      const isGem = (i % 4 === 1) && k === 3;
      const isFruit = !isGem && (k === 2 || k === 5);
      placeItem(isGem ? 'gem' : isFruit ? 'fruit' : 'coin', lx, lz, isGem || isFruit ? 1.25 : 0.95);
    }
  }

  function assignFoliageInstances(seg, i, centerZ) {
    for (let k = 0; k < GRASS_PER_SEG; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const onShoulder = k < 18;
      const lz = -L / 2 + 1 + hash(i * 61 + k * 3) * (L - 2);
      const lx = onShoulder
        ? side * (W / 2 + 0.9 + hash(i * 71 + k) * 1.65)
        : side * (W / 2 + 4.5 + hash(i * 79 + k) * 14.0);
      const ly = onShoulder ? getTrackHeight(centerZ + lz) - 0.14 : FLOOR_Y;
      _dummy.position.set(lx, ly, lz);
      _dummy.rotation.set(0, hash(i * 43 + k) * Math.PI * 2, 0);
      _dummy.scale.setScalar(onShoulder ? (0.8 + hash(i * 83 + k) * 0.55) : (1.2 + hash(i * 89 + k) * 0.8));
      _dummy.updateMatrix();
      seg.grassInst.setMatrixAt(k, _dummy.matrix);
      _col.set(GRASS_SHADES[(i + k) % GRASS_SHADES.length]);
      seg.grassInst.setColorAt(k, _col);
    }
    seg.grassInst.instanceMatrix.needsUpdate = true;
    if (seg.grassInst.instanceColor) seg.grassInst.instanceColor.needsUpdate = true;

    for (let k = 0; k < FLOWERS_PER_SEG; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const onShoulder = k < 10;
      const lz = -L / 2 + 1.5 + hash(i * 97 + k * 5) * (L - 3);
      const lx = onShoulder
        ? side * (W / 2 + 1.05 + hash(i * 101 + k) * 1.45)
        : side * (W / 2 + 5.0 + hash(i * 103 + k) * 13.0);
      const ly = onShoulder ? getTrackHeight(centerZ + lz) - 0.14 : FLOOR_Y;
      _dummy.position.set(lx, ly, lz);
      _dummy.rotation.set(0, hash(i * 59 + k) * Math.PI * 2, 0);
      _dummy.scale.setScalar(0.85 + hash(i * 67 + k) * 0.45);
      _dummy.updateMatrix();
      seg.flowerInst.setMatrixAt(k, _dummy.matrix);
      _col.set(FLOWER_SHADES[(i * 3 + k) % FLOWER_SHADES.length]);
      seg.flowerInst.setColorAt(k, _col);
    }
    seg.flowerInst.instanceMatrix.needsUpdate = true;
    if (seg.flowerInst.instanceColor) seg.flowerInst.instanceColor.needsUpdate = true;
  }

  function assign(seg, i) {
    seg.index = i;
    seg.type = getSegmentType(i);
    const centerZ = -(i + 0.5) * L;
    seg.group.position.set(0, 0, centerZ);

    const floorKind = Math.abs(Math.floor(i / 4)) % floorMats.length;
    seg.floor.material = floorMats[floorKind];

    seg.blocks.forEach((m, b) => {
      const side = b % 2 === 0 ? -1 : 1;
      const bx = side * (29 + hash(i * 31 + b) * 18);
      const bz = -L * 0.35 + (b % 2) * L * 0.55 + (hash(i * 41 + b) - 0.5) * 6;
      const sc = 0.85 + hash(i * 53 + b) * 0.55;
      m.material = blockMats[(Math.abs(i * 3 + b)) % blockMats.length];
      m.scale.setScalar(sc);
      if (b >= 2 && hash(i * 11 + b) > 0.45) {
        const base = seg.blocks[b - 2];
        m.position.set(base.position.x + 0.2, FLOOR_Y + 2.3 * base.scale.y + 2.3 * sc, base.position.z - 0.2);
        m.rotation.y = base.rotation.y + 0.35;
      } else {
        m.position.set(bx, FLOOR_Y + 2.3 * sc, bz);
        m.rotation.y = hash(i * 29 + b) * Math.PI * 0.5;
      }
    });

    displace(seg.road, centerZ);
    for (const sh of seg.shoulders) displaceShoulder(sh.mesh, sh.side, centerZ);
    for (const sk of seg.skirts) displaceSkirt(sk, centerZ);
    for (const e of seg.edges) displace(e, centerZ, 0.02);
    seg.dashes.forEach((d, k) => {
      const lz = -L / 2 + 2 + k * 4;
      d.position.set(0, getTrackHeight(centerZ + lz) + 0.03, lz);
      d.rotation.x = Math.atan(-getTrackSlope(centerZ + lz));
    });

    for (const gp of seg.guardPosts) {
      const lz = -L / 2 + 2 + gp.k * 4;
      const y = getTrackHeight(centerZ + lz);
      gp.mesh.position.set(gp.side * (W / 2 + 0.22), y + 0.42, lz);
    }
    for (const gb of seg.guardBeams) {
      const lz = -L / 2 + 2 + gb.k * 4;
      const y = getTrackHeight(centerZ + lz);
      gb.mesh.position.set(gb.side * (W / 2 + 0.22), y + 0.66, lz);
      gb.mesh.rotation.x = Math.atan(-getTrackSlope(centerZ + lz));
    }

    const roadMidY = getTrackHeight(centerZ);
    const pierH = Math.max(2, roadMidY - FLOOR_Y);
    for (const p of seg.piers) {
      p.mesh.scale.y = pierH;
      p.mesh.position.set(p.x, FLOOR_Y + pierH / 2, 0);
    }

    seg.ramp.visible = seg.type === 'ramp';
    if (seg.ramp.visible) seg.ramp.position.set(0, getTrackHeight(centerZ) + 0.35, 0);

    seg.boost.visible = seg.type === 'boost';
    if (seg.boost.visible) seg.boost.position.set(0, getTrackHeight(centerZ) + 0.07, 0);

    seg.bridge.visible = seg.type === 'bridge';
    if (seg.bridge.visible) {
      const plateauY = getTrackHeight(centerZ);
      const h = Math.max(2, plateauY - FLOOR_Y);
      for (const p of seg.pillars) {
        p.scale.y = h;
        p.position.y = FLOOR_Y + h / 2;
      }
    }

    seg.arch.visible = i >= 4 && i % (TRACK.archEvery || 8) === 0;
    if (seg.arch.visible) seg.arch.position.set(0, roadMidY, 0);

    seg.decor.forEach((d, k) => {
      if (d.kind === 'lamp') {
        const side = d.sideIdx === 0 ? -1 : 1;
        const lz = d.sideIdx === 0 ? -L * 0.25 : L * 0.25;
        const y = getTrackHeight(centerZ + lz);
        d.obj.position.set(side * (W / 2 + 0.72), y, lz);
        d.obj.rotation.y = side < 0 ? 0 : Math.PI;
      } else if (d.kind === 'bush') {
        const side = hash(i * 17 + k) > 0.5 ? 1 : -1;
        const lz = -L / 2 + 2.5 + hash(i * 23 + k) * (L - 5);
        const off = W / 2 + 1.45 + hash(i * 29 + k) * 1.1;
        const y = getTrackHeight(centerZ + lz);
        d.obj.position.set(side * off, y - 0.14, lz);
        d.obj.scale.setScalar(0.85 + hash(i * 31 + k) * 0.4);
      } else {
        const side = hash(i * 7 + k) > 0.5 ? 1 : -1;
        const lz = -L / 2 + 3 + hash(i * 13 + k) * (L - 6);
        const off = W / 2 + 1.9 + hash(i * 17 + k) * 1.3;
        const y = getTrackHeight(centerZ + lz);
        d.obj.position.set(side * off, y - 0.14, lz);
        d.obj.scale.setScalar(0.95 + hash(i * 23 + k) * 0.55);
      }
    });

    assignFoliageInstances(seg, i, centerZ);
    assignCollectibles(seg, i, centerZ);
  }

  for (let s = 0; s < POOL_SIZE; s++) pool.push(buildSegment());

  /* ---------- Daur ulang segmen + animasi angin & kolektibel ---------- */
  function updateTrack(playerZ, t = 0) {
    windUniform.value = t;

    const cur = Math.floor(-playerZ / L);
    const min = cur - TRACK.segmentsBehind;
    const max = cur + TRACK.segmentsAhead;
    const needed = new Set();
    for (let i = min; i <= max; i++) needed.add(i);

    for (const seg of pool) if (seg.index !== null && !needed.has(seg.index)) seg.index = null;

    const present = new Set(pool.filter((s) => s.index !== null).map((s) => s.index));
    for (const i of needed) {
      if (present.has(i)) continue;
      const free = pool.find((s) => s.index === null);
      if (free) { assign(free, i); present.add(i); }
    }

    for (const seg of pool) {
      if (seg.index === null) continue;

      for (const d of seg.decor) {
        if (d.kind === 'tree') d.obj.rotation.z = Math.sin(t * 1.5 + d.phase) * 0.028;
        else if (d.kind === 'bush') d.obj.rotation.z = Math.sin(t * 2.1 + d.phase) * 0.035;
      }

      for (const item of seg.collectibles) {
        if (!item.active || item.collected) continue;
        item.obj.position.y = item.baseY + Math.sin(t * 3.6 + item.phase) * 0.18;
        if (item.kind === 'coin') {
          item.coinMesh.rotation.y = t * 3.4 + item.phase;
        } else if (item.kind === 'gem') {
          item.gemMesh.rotation.y = t * 2.8 + item.phase;
          item.gemMesh.rotation.z = Math.sin(t * 2.2 + item.phase) * 0.22;
          const gm = item.gemMesh.userData.gemMat;
          const hue = (t * 0.55 + item.phase * 0.15) % 1;
          gm.color.setHSL(hue, 0.92, 0.62);
          gm.emissive.setHSL(hue, 0.95, 0.52);
          item.groundRing.scale.setScalar(0.92 + Math.sin(t * 4.5 + item.phase) * 0.14);
        } else {
          item.fruitMesh.rotation.y = t * 2.4 + item.phase;
          item.fruitMesh.rotation.z = Math.sin(t * 1.9 + item.phase) * 0.1;
          item.groundRing.scale.setScalar(0.95 + Math.sin(t * 4.2 + item.phase) * 0.16);
        }
      }
    }

    matBoost.emissiveIntensity = 0.5 + Math.sin(t * 4) * 0.3;
    matChevron.emissiveIntensity = 0.35 + Math.sin(t * 4 + 1) * 0.2;
  }

  /* ---------- Deteksi pengambilan koin, buah & permata (zero-GC) ---------- */
  const _collected = [];
  function collectNearby(pos) {
    _collected.length = 0;
    const py = pos.y + 0.9;
    for (const seg of pool) {
      if (seg.index === null) continue;
      const centerZ = seg.group.position.z;
      if (Math.abs(centerZ - pos.z) > L * 0.85) continue;
      for (const item of seg.collectibles) {
        if (!item.active || item.collected) continue;
        const wx = item.lx;
        const wy = item.obj.position.y;
        const wz = centerZ + item.lz;
        const hitPad = item.kind === 'fruit' ? 2.45 : 2.2;
        if (
          Math.abs(pos.x - wx) < hitPad &&
          Math.abs(py - wy) < 2.55 &&
          Math.abs(pos.z - wz) < 2.45
        ) {
          item.collected = true;
          item.obj.visible = false;
          item.groundRing.visible = false;
          _collected.push({ kind: item.kind, fruitType: item.fruitType, x: wx, y: wy, z: wz });
        }
      }
    }
    return _collected;
  }

  function resetCollectibles() {
    for (const seg of pool) {
      for (const item of seg.collectibles) {
        if (item.active) {
          item.collected = false;
          item.obj.visible = true;
          item.groundRing.visible = item.kind === 'fruit' || item.kind === 'gem';
        }
      }
    }
  }

  function dispose() {
    for (const seg of pool) {
      scene.remove(seg.group);
      seg.road.geometry.dispose();
      for (const sh of seg.shoulders) sh.mesh.geometry.dispose();
      for (const sk of seg.skirts) sk.geometry.dispose();
      for (const e of seg.edges) e.geometry.dispose();
      seg.grassInst.dispose();
      seg.flowerInst.dispose();
      for (const item of seg.collectibles) item.gemMesh.userData.gemMat.dispose();
    }
    [
      geoDash, geoRamp, geoRampStripe, geoBoost, geoChevron, geoPillar,
      geoGuardPost, geoGuardBeam, geoTrunk, geoCanopy, geoBushLobe, geoBerry,
      geoPlantShadow, geoGrassTuft, geoFlower, geoLampBase, geoLampPole,
      geoLampArm, geoLampHead, geoFloor, geoBlock, geoFencePost, geoFenceRail,
      geoArchPillar, geoArchBeam, geoArchSign, geoArchBulb, geoBunting,
      geoCoinBody, geoCoinRim, geoCoinCore, geoGemStar, geoGemRing, geoGlowRing,
    ].forEach((g) => g.dispose());
    [
      matAsphalt, matShoulderBlend, matDeckSide, matCurb, matLine, matRamp,
      matRampStripe, matBoost, matChevron, matPillar, ...matRailColors,
      matTrunk, matLeaf1, matLeaf2, matLeaf3, matBushEmerald, matBushPurple,
      matBerry, matGrassTuft, matFlower, matPlantShadow, matLampPole,
      matLampCollar, matLampHead, ...floorMats, ...blockMats, matArchBanner,
      matArchBlue, matArchGold, matFenceRed, matFenceWhite, matCoinGold,
      matCoinRim, matGemHalo, ...Object.values(ringMats),
    ].forEach((m) => m.dispose());
    [
      roadTex.map, roadTex.normalMap, plantShadowTex, glowRingTex,
      ...floorTextures, ...blockTextures, archBannerTex,
    ].forEach((t) => t.dispose());
    pool.length = 0;
  }

  return {
    updateTrack, collectNearby, resetCollectibles, dispose,
    getTrackHeight, getTrackSlope, checkRampCollision, checkBoostCollision, getSegmentType,
    get segmentCount() { return pool.length; },
  };
}
