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
const RAMP_W = 7.4, RAMP_LEN = 5.2, RAMP_RISE = 1.5;
const RAMP_GAP_START = -3.3; // lz (ramp ends around -2.6)
const RAMP_GAP_END = -10.5;  // lz (rejoins road before -12 seam)
const BOOST_W = 4.2, BOOST_LEN = 3.2;
export const LOOP_RADIUS = TRACK.loopRadius ?? 7.8;
export const LOOP_HALF_W = (TRACK.loopWidth ?? 6.4) * 0.5;
const LOOP_HELIX = 3.55;
export const LOOP_ARC_LEN = Math.PI * 2 * LOOP_RADIUS + 14;
const LOOP_STEPS = 44;
const NARROW_HALF_W = (TRACK.narrowWidth ?? 5.5) * 0.5;
const FORK_HALF_L = (TRACK.forkWidthL ?? 4.3) * 0.5;
const FORK_HALF_R = (TRACK.forkWidthR ?? 5.5) * 0.5;
const RIBBON_STEPS = 16;
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
  const m = ((i % 12) + 12) % 12;
  if (m === 10) return 'loop';
  if (m === 9) return 'boost'; // booster tepat di depan setiap loop 360°
  if (m === 7) return 'fork';
  if (m === 5) return 'narrow';
  if (m === 4) return 'bridge';
  if (m === 3 || m === 8) return 'ramp';
  if (m === 6) return 'boost';
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

export function getNarrowHalfWidth(t) {
  const shrink = smoothstep(0.02, 0.24, t) * (1 - smoothstep(0.76, 0.98, t));
  return THREE.MathUtils.lerp(W / 2, NARROW_HALF_W, shrink);
}

export function getForkProfile(t) {
  const split = smoothstep(0.05, 0.24, t) * (1 - smoothstep(0.76, 0.95, t));
  return {
    split,
    cxL: -4.25 * split,
    hwL: THREE.MathUtils.lerp(W / 2, FORK_HALF_L, split),
    yOffL: 0.95 * split,
    cxR: 3.95 * split,
    hwR: THREE.MathUtils.lerp(W / 2, FORK_HALF_R, split),
    yOffR: 0,
  };
}

const _lpForward = new THREE.Vector3();
const _lpInward = new THREE.Vector3();
const _lpUp = new THREE.Vector3();
const _lpRight = new THREE.Vector3();
const _lpZAxis = new THREE.Vector3();
const _lpMat = new THREE.Matrix4();

export function evalLoopPose(zStart, zEnd, y0, y1, u, lateralX, outPos, outQuat, outRight = null) {
  const clampedU = Math.min(1, Math.max(0, u));
  const theta = clampedU * Math.PI * 2;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const baseY = THREE.MathUtils.lerp(y0, y1, clampedU);

  const cx = LOOP_HELIX * sinT;
  const cy = baseY + LOOP_RADIUS * (1 - cosT);
  const cz = THREE.MathUtils.lerp(zStart, zEnd, clampedU) - LOOP_RADIUS * sinT;

  const dTheta = Math.PI * 2;
  const spanZ = zEnd - zStart; // -L
  _lpForward.set(
    LOOP_HELIX * cosT * dTheta,
    LOOP_RADIUS * sinT * dTheta + (y1 - y0),
    spanZ - LOOP_RADIUS * cosT * dTheta
  ).normalize();

  _lpInward.set(0, cosT, sinT);
  const dot = _lpInward.dot(_lpForward);
  _lpUp.copy(_lpInward).addScaledVector(_lpForward, -dot).normalize();
  _lpRight.crossVectors(_lpForward, _lpUp).normalize();

  if (outPos) {
    outPos.set(
      cx + _lpRight.x * lateralX,
      cy + _lpRight.y * lateralX,
      cz + _lpRight.z * lateralX
    );
  }
  if (outQuat) {
    _lpZAxis.copy(_lpForward).negate();
    _lpMat.makeBasis(_lpRight, _lpUp, _lpZAxis);
    outQuat.setFromRotationMatrix(_lpMat);
  }
  if (outRight) outRight.copy(_lpRight);
}

/** Kueri permukaan trek murni di (x, z) — dipakai Player & AI Racers */
export function getTrackSurfaceAt(x, z) {
  const i = Math.floor(-z / L);
  const type = getSegmentType(i);
  const z0 = -i * L;
  const t = Math.min(1, Math.max(0, (z0 - z) / L));
  const centerZ = -(i + 0.5) * L;
  const lz = z - centerZ; // +L/2 at entry, -L/2 at exit
  const baseY = getTrackHeight(z);
  const slope = getTrackSlope(z);

  if (type === 'narrow') {
    const hw = getNarrowHalfWidth(t);
    const onTrack = Math.abs(x) <= hw + 0.25;
    return { type, segIndex: i, t, onTrack, groundY: baseY, slope, safeCenterX: 0, safeHalfW: hw, inGap: !onTrack, hasGuardrails: false };
  }

  if (type === 'fork') {
    const fp = getForkProfile(t);
    if (fp.split < 0.25) {
      const onTrack = Math.abs(x) <= W / 2 + 0.35;
      return { type, segIndex: i, t, onTrack, groundY: baseY, slope, safeCenterX: 0, safeHalfW: W / 2, inGap: !onTrack, hasGuardrails: false };
    }
    const onLeft = Math.abs(x - fp.cxL) <= fp.hwL + 0.25;
    const onRight = Math.abs(x - fp.cxR) <= fp.hwR + 0.25;
    const onTrack = onLeft || onRight;
    const nearLeft = Math.abs(x - fp.cxL) <= Math.abs(x - fp.cxR);
    return {
      type,
      segIndex: i,
      t,
      onTrack,
      groundY: baseY + (onLeft ? fp.yOffL : 0),
      slope,
      safeCenterX: nearLeft ? fp.cxL : fp.cxR,
      safeHalfW: nearLeft ? fp.hwL : fp.hwR,
      inGap: !onTrack,
      hasGuardrails: false,
    };
  }

  if (type === 'ramp') {
    const inChasm = lz <= RAMP_GAP_START && lz >= RAMP_GAP_END;
    const onTrack = !inChasm && Math.abs(x) <= W / 2 + 0.45;
    return {
      type,
      segIndex: i,
      t,
      onTrack,
      groundY: baseY,
      slope,
      safeCenterX: 0,
      safeHalfW: W / 2,
      inGap: inChasm || !onTrack,
      hasGuardrails: !inChasm,
    };
  }

  if (type === 'loop') {
    const onTrack = Math.abs(x) <= LOOP_HALF_W + 0.45;
    return { type, segIndex: i, t, onTrack, groundY: baseY, slope, safeCenterX: 0, safeHalfW: LOOP_HALF_W, inGap: !onTrack, hasGuardrails: true };
  }

  return {
    type,
    segIndex: i,
    t,
    onTrack: Math.abs(x) <= W / 2 + 0.5,
    groundY: baseY,
    slope,
    safeCenterX: 0,
    safeHalfW: W / 2,
    inGap: false,
    hasGuardrails: true,
  };
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
  const type = getSegmentType(i);
  if (type === 'boost') {
    const zc = -(i + 0.5) * L;
    if (Math.abs(z - zc) < BOOST_LEN / 2 && Math.abs(x) < BOOST_W / 2) return { z: zc, x: 0, width: BOOST_W };
  } else if (type === 'loop') {
    const zEntry = -i * L - 2.2;
    if (Math.abs(z - zEntry) < 2.2 && Math.abs(x) < LOOP_HALF_W) return { z: zEntry, x: 0, width: LOOP_HALF_W * 2 };
  }
  return null;
}

/* ---------- Tekstur Trek Plastik Oranye Hot Wheels + Speed Grooves + Normal Map ---------- */
function makeStylizedRoadTextures() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');

  // Gradien dasar plastik satin oranye ikonik Hot Wheels (#FF6B00)
  const baseGrad = g.createLinearGradient(0, 0, size, 0);
  baseGrad.addColorStop(0, '#d95300');
  baseGrad.addColorStop(0.06, '#ff6b00');
  baseGrad.addColorStop(0.5, '#ff7b1a');
  baseGrad.addColorStop(0.94, '#ff6b00');
  baseGrad.addColorStop(1, '#d95300');
  g.fillStyle = baseGrad;
  g.fillRect(0, 0, size, size);

  // Highlight kilap plastik di tengah & alur kecepatan memanjang (speed grooves)
  const sheenGrad = g.createLinearGradient(0, 0, size, 0);
  sheenGrad.addColorStop(0, 'rgba(255, 210, 140, 0)');
  sheenGrad.addColorStop(0.28, 'rgba(255, 224, 170, 0.14)');
  sheenGrad.addColorStop(0.5, 'rgba(255, 238, 195, 0.22)');
  sheenGrad.addColorStop(0.72, 'rgba(255, 224, 170, 0.14)');
  sheenGrad.addColorStop(1, 'rgba(255, 210, 140, 0)');
  g.fillStyle = sheenGrad;
  g.fillRect(0, 0, size, size);

  // Alur kecepatan tengah (center speed grooves) & rel pemandu lajur halus
  const grooveXs = [
    size * 0.19, size * 0.21,
    size * 0.47, size * 0.50, size * 0.53,
    size * 0.79, size * 0.81,
  ];
  for (const gx of grooveXs) {
    const isCenter = Math.abs(gx - size * 0.5) < size * 0.05;
    const gw = isCenter ? 5 : 3;
    g.fillStyle = isCenter ? 'rgba(165, 52, 0, 0.26)' : 'rgba(180, 62, 0, 0.18)';
    g.fillRect(gx - gw * 0.5, 0, gw, size);
    g.fillStyle = 'rgba(255, 200, 120, 0.24)';
    g.fillRect(gx + gw * 0.5, 0, 2, size);
  }

  // Tekstur plastik satin mikro yang halus
  for (let i = 0; i < 480; i++) {
    const x = hash(i * 5.3 + 9) * size;
    const y = hash(i * 11.1 + 3) * size;
    g.fillStyle = i % 2 === 0 ? 'rgba(255,245,220,0.04)' : 'rgba(160,50,0,0.035)';
    g.fillRect(x, y, 2, 10);
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 2);
  map.anisotropy = 4;

  // Normal map prosedural untuk alur plastik cetakan (molded grooves)
  const nc = document.createElement('canvas'); nc.width = nc.height = 256;
  const ng = nc.getContext('2d');
  const img = ng.createImageData(256, 256);
  const hBuf = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256;
      const centerGroove =
        Math.exp(-Math.pow((u - 0.5) * 48, 2)) * -0.85 +
        Math.exp(-Math.pow((u - 0.47) * 58, 2)) * -0.55 +
        Math.exp(-Math.pow((u - 0.53) * 58, 2)) * -0.55 +
        Math.exp(-Math.pow((u - 0.2) * 52, 2)) * -0.4 +
        Math.exp(-Math.pow((u - 0.8) * 52, 2)) * -0.4;
      const micro = (hash(x * 37 + y * 131) - 0.5) * 0.08;
      hBuf[y * 256 + x] = centerGroove + micro;
    }
  }
  const strength = 1.6;
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
  normalMap.repeat.set(1, 4);

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
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#d90429');
  grad.addColorStop(0.5, '#ff6b00');
  grad.addColorStop(1, '#d90429');
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(6, 6, 1012, 180, 26); g.fill();
  g.strokeStyle = '#ffd100';
  g.lineWidth = 12;
  g.beginPath(); g.roundRect(14, 14, 996, 164, 20); g.stroke();
  g.fillStyle = '#fff8eb';
  g.font = '700 58px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('🔥 JURAGAN NGEBUT • KING OF THE ROAD 🔥', 512, 98);
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
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.28,
    metalness: 0.08,
  });

  /* Material bahu jalan dengan transisi vertex color oranye/stone → rumput */
  const matShoulderBlend = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  const matDeckSide = new THREE.MeshStandardMaterial({ color: P.trackOrangeDark, roughness: 0.34, metalness: 0.06 });
  const matCurb = new THREE.MeshStandardMaterial({ color: P.trackOrange, roughness: 0.28, metalness: 0.08 });
  const matLine = new THREE.MeshStandardMaterial({ color: '#ffe599', roughness: 0.35, emissive: '#ffbe0b', emissiveIntensity: 0.22 });
  const matConnectorBlue = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.26, metalness: 0.12,
    emissive: '#0044aa', emissiveIntensity: 0.14,
  });
  const hazardStripeTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffbe0b';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#18181b';
    for (let x = -64; x < 320; x += 36) {
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + 18, 0); g.lineTo(x + 42, 64); g.lineTo(x + 24, 64);
      g.closePath();
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    return tex;
  })();
  const skullSignTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 256, 0);
    bg.addColorStop(0, '#d00000'); bg.addColorStop(0.5, '#1d4ed8'); bg.addColorStop(1, '#d00000');
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(4, 4, 248, 152, 20); g.fill();
    g.strokeStyle = '#ffbe0b'; g.lineWidth = 8; g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(128, 66, 30, 0, Math.PI * 2); g.fill();
    g.fillRect(112, 86, 32, 18);
    g.fillStyle = '#18181b';
    g.beginPath(); g.arc(117, 63, 7, 0, Math.PI * 2); g.arc(139, 63, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.moveTo(86, 128); g.lineTo(170, 102); g.moveTo(170, 128); g.lineTo(86, 102); g.stroke();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const matHazardStripe = new THREE.MeshStandardMaterial({
    map: hazardStripeTex, roughness: 0.34, emissive: '#ffbe0b', emissiveIntensity: 0.18,
  });
  const matRamp = new THREE.MeshStandardMaterial({
    color: '#10b981', roughness: 0.24, metalness: 0.08,
    emissive: '#059669', emissiveIntensity: 0.28,
  });
  const matRampStripe = new THREE.MeshStandardMaterial({
    color: '#ffe135', roughness: 0.25,
    emissive: '#ffbe0b', emissiveIntensity: 0.85,
  });
  const matFireRing = new THREE.MeshPhysicalMaterial({
    color: '#ffbe0b', roughness: 0.14, metalness: 0.65, clearcoat: 1.0,
    emissive: '#ff5400', emissiveIntensity: 0.88,
  });
  const matFireFlame = new THREE.MeshStandardMaterial({
    color: '#ff6b00', roughness: 0.3, emissive: '#ff9500', emissiveIntensity: 1.15,
  });
  const matConeOrange = new THREE.MeshStandardMaterial({ color: '#ff5400', roughness: 0.35 });
  const matConeWhite = new THREE.MeshStandardMaterial({ color: '#fff8eb', roughness: 0.35 });
  const matBarrelRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.35, metalness: 0.15 });
  const matBarrelYellow = new THREE.MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.35, metalness: 0.15 });
  const matSkullSign = new THREE.MeshStandardMaterial({
    map: skullSignTex, roughness: 0.38, emissive: '#ffffff', emissiveMap: skullSignTex, emissiveIntensity: 0.22,
  });
  const matBeaconRed = new THREE.MeshStandardMaterial({ color: '#ff2a4b', emissive: '#ff0033', emissiveIntensity: 1.5, roughness: 0.2 });
  const matBeaconBlue = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0077ff', emissiveIntensity: 1.5, roughness: 0.2 });
  const matBoost = new THREE.MeshStandardMaterial({
    color: '#ffbe0b', roughness: 0.28,
    emissive: '#ff9500', emissiveIntensity: 0.72,
  });
  const matChevron = new THREE.MeshStandardMaterial({
    color: '#fff3b0', roughness: 0.25,
    emissive: '#ffd100', emissiveIntensity: 0.9,
  });
  const matBoosterWheel = new THREE.MeshStandardMaterial({
    color: '#ffd100', roughness: 0.32, metalness: 0.05,
    emissive: '#ffaa00', emissiveIntensity: 0.25,
  });
  const matBoosterHub = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.24, metalness: 0.35,
  });
  const matPillar = new THREE.MeshStandardMaterial({ color: P.concrete, roughness: 0.75 });
  const matRailColors = [
    new THREE.MeshStandardMaterial({ color: P.trackOrange, roughness: 0.28, metalness: 0.08 }),
    new THREE.MeshStandardMaterial({ color: '#ff7b1a', roughness: 0.28, metalness: 0.08 }),
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
  const geoDash = new THREE.BoxGeometry(0.24, 0.025, 1.75);
  const geoRamp = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(-RAMP_LEN * 0.5, 0);
    shape.lineTo(RAMP_LEN * 0.5, 0);
    shape.lineTo(RAMP_LEN * 0.5, RAMP_RISE);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: RAMP_W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    g.center();
    g.rotateY(Math.PI / 2);
    return g;
  })();
  const geoRampRail = new RoundedBoxGeometry(0.36, 0.95, RAMP_LEN + 0.3, 2, 0.08);
  const geoRampStripe = new THREE.BoxGeometry(RAMP_W - 0.8, 0.12, 0.55);
  const geoRampLipHazard = new THREE.BoxGeometry(RAMP_W + 0.28, 0.34, 0.78);
  const geoBoost = new RoundedBoxGeometry(BOOST_W, 0.12, BOOST_LEN, 3, 0.06);
  const geoChevron = new THREE.BoxGeometry(2.6, 0.06, 0.35);
  const geoBoosterHousing = new RoundedBoxGeometry(1.05, 0.92, BOOST_LEN + 0.9, 3, 0.16);
  const geoBoosterWheel = new THREE.CylinderGeometry(0.72, 0.72, 0.38, 16);
  geoBoosterWheel.rotateZ(Math.PI / 2);
  const geoBoosterHub = new THREE.CylinderGeometry(0.34, 0.34, 0.42, 8);
  geoBoosterHub.rotateZ(Math.PI / 2);
  const geoConnectorBar = new RoundedBoxGeometry(W + 1.35, 0.34, 1.15, 2, 0.08);
  const geoConnectorEar = new RoundedBoxGeometry(0.55, 0.92, 1.45, 2, 0.1);
  const geoFireRingTorus = new THREE.TorusGeometry(1.82, 0.19, 10, 28);
  const geoFireFlame = new THREE.ConeGeometry(0.22, 0.68, 5);
  const geoSkyLoop = new THREE.TorusGeometry(9.5, 1.35, 10, 32);
  const geoConeBody = new THREE.ConeGeometry(0.42, 1.05, 12);
  const geoConeBase = new THREE.BoxGeometry(0.95, 0.14, 0.95);
  const geoConeCollar = new THREE.CylinderGeometry(0.21, 0.28, 0.26, 12);
  const geoBarrelBody = new THREE.CylinderGeometry(0.54, 0.54, 1.25, 14);
  const geoBarrelBand = new THREE.CylinderGeometry(0.56, 0.56, 0.32, 14);
  const geoHazardBody = new RoundedBoxGeometry(3.4, 1.65, 0.62, 2, 0.12);
  const geoHazardSign = new THREE.PlaneGeometry(3.0, 1.4);
  const geoHazardBeacon = new THREE.SphereGeometry(0.26, 10, 8);
  const geoMascotPlinth = new THREE.CylinderGeometry(2.8, 3.2, 1.4, 14);
  const geoMascotHead = new THREE.SphereGeometry(1.5, 14, 12);
  const geoMascotBody = new RoundedBoxGeometry(2.5, 2.9, 1.8, 3, 0.4);
  const geoMascotArm = new RoundedBoxGeometry(0.65, 2.0, 0.65, 2, 0.2);
  const geoMonsterWheel = new THREE.CylinderGeometry(1.15, 1.15, 0.9, 14);
  geoMonsterWheel.rotateZ(Math.PI / 2);
  const geoMonsterCabin = new RoundedBoxGeometry(2.8, 1.75, 4.6, 3, 0.3);
  const geoPillar = new THREE.CylinderGeometry(0.55, 0.72, 1, 12);
  const geoGuardPost = new RoundedBoxGeometry(0.24, 0.82, 0.28, 2, 0.05);
  const geoGuardBeam = new RoundedBoxGeometry(0.32, 0.56, 4.18, 2, 0.08);

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

  /* Geometri ribbon dinamis untuk Narrow Bridge, Y-Split Fork, dan 360° Loop */
  function makeRibbonGridGeo(steps) {
    const pos = new Float32Array((steps + 1) * 2 * 3);
    const uv = new Float32Array((steps + 1) * 2 * 2);
    const idx = [];
    for (let s = 0; s <= steps; s++) {
      const v = s / steps;
      uv[s * 4] = 0; uv[s * 4 + 1] = v * 2;
      uv[s * 4 + 2] = 1; uv[s * 4 + 3] = v * 2;
    }
    for (let s = 0; s < steps; s++) {
      const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function makeGapRoadGeo(zStartLocal, zEndLocal, steps = 6) {
    const len = zStartLocal - zEndLocal;
    const g = new THREE.PlaneGeometry(W, len, 1, steps);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, (zStartLocal + zEndLocal) * 0.5);
    return g;
  }

  const matForkLeft = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    color: '#ff9068',
    roughness: 0.26,
    metalness: 0.08,
  });
  const matLoopSurface = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.24,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const matGapCap = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.26, metalness: 0.14,
    emissive: '#0044aa', emissiveIntensity: 0.2,
  });
  const geoGapCap = new RoundedBoxGeometry(W + 0.5, 0.42, 0.52, 2, 0.08);
  const geoLoopStrut = new THREE.CylinderGeometry(0.32, 0.45, 1, 10);
  const geoForkSignPost = new THREE.CylinderGeometry(0.16, 0.2, 4.4, 8);
  const geoForkSignBoard = new THREE.PlaneGeometry(6.8, 1.3);
  const forkSignTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112;
    const g = c.getContext('2d');
    g.fillStyle = '#1b1b22';
    g.beginPath(); g.roundRect(4, 4, 504, 104, 18); g.fill();
    g.strokeStyle = '#ffbe0b'; g.lineWidth = 6; g.stroke();
    g.font = '700 30px Fredoka, "Plus Jakarta Sans", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ff6b8b'; g.fillText('⬅️ RISIKO + BUAH', 140, 56);
    g.fillStyle = '#38bdf8'; g.fillText('AMAN + KOIN ➡️', 380, 56);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const matForkSign = new THREE.MeshStandardMaterial({
    map: forkSignTex, roughness: 0.45, emissive: '#ffffff', emissiveMap: forkSignTex, emissiveIntensity: 0.25,
  });

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

  function buildFireRingMesh() {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(geoFireRingTorus, matFireRing);
    torus.castShadow = false;
    g.add(torus);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const flame = new THREE.Mesh(geoFireFlame, matFireFlame);
      flame.position.set(Math.cos(a) * 2.04, Math.sin(a) * 2.04, 0);
      flame.rotation.z = a - Math.PI / 2;
      g.add(flame);
    }
    return g;
  }

  function buildPropMesh(kind) {
    const g = new THREE.Group();
    if (kind === 'cone') {
      const base = new THREE.Mesh(geoConeBase, matConeOrange);
      base.position.y = 0.07;
      base.castShadow = true;
      const body = new THREE.Mesh(geoConeBody, matConeOrange);
      body.position.y = 0.58;
      body.castShadow = true;
      const collar = new THREE.Mesh(geoConeCollar, matConeWhite);
      collar.position.y = 0.68;
      g.add(base, body, collar);
    } else {
      const body = new THREE.Mesh(geoBarrelBody, matBarrelRed);
      body.position.y = 0.62;
      body.castShadow = true;
      const band1 = new THREE.Mesh(geoBarrelBand, matBarrelYellow);
      band1.position.y = 0.34;
      const band2 = new THREE.Mesh(geoBarrelBand, matBarrelYellow);
      band2.position.y = 0.90;
      g.add(body, band1, band2);
    }
    return g;
  }

  function buildSkullHazardMesh() {
    const g = new THREE.Group();
    for (const sx of [-1.35, 1.35]) {
      const leg = new THREE.Mesh(geoGuardPost, matConnectorBlue);
      leg.position.set(sx, 0.42, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    const bar = new THREE.Mesh(geoHazardBody, matBarrelRed);
    bar.position.set(0, 1.12, 0);
    bar.castShadow = true;
    const front = new THREE.Mesh(geoHazardSign, matSkullSign);
    front.position.set(0, 1.12, 0.33);
    const back = new THREE.Mesh(geoHazardSign, matSkullSign);
    back.position.set(0, 1.12, -0.33);
    back.rotation.y = Math.PI;
    const beaconL = new THREE.Mesh(geoHazardBeacon, matBeaconRed);
    beaconL.position.set(-1.35, 2.08, 0);
    const beaconR = new THREE.Mesh(geoHazardBeacon, matBeaconBlue);
    beaconR.position.set(1.35, 2.08, 0);
    g.add(bar, front, back, beaconL, beaconR);
    g.userData = { beaconL, beaconR };
    return g;
  }

  function buildSkyLoopDecor() {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(geoSkyLoop, matAsphalt);
    deck.position.y = 10.0;
    const rim = new THREE.Mesh(geoSkyLoop, matCurb);
    rim.position.y = 10.0;
    rim.scale.set(1.04, 1.04, 0.45);
    g.add(deck, rim);
    for (const sx of [-4.2, 4.2]) {
      const strut = new THREE.Mesh(geoLoopStrut, matConnectorBlue);
      strut.scale.set(1, 10.2, 1);
      strut.position.set(sx, 5.1, 0);
      g.add(strut);
    }
    return g;
  }

  function buildMascotDisplay(variant) {
    const g = new THREE.Group();
    const plinth = new THREE.Mesh(geoMascotPlinth, matConnectorBlue);
    plinth.position.y = 0.7;
    plinth.castShadow = true;
    g.add(plinth);
    if (variant === 0) {
      const body = new THREE.Mesh(geoMascotBody, matBarrelRed);
      body.position.y = 2.85;
      body.castShadow = true;
      const head = new THREE.Mesh(geoMascotHead, matRampStripe);
      head.position.y = 5.15;
      head.castShadow = true;
      const armL = new THREE.Mesh(geoMascotArm, matBarrelYellow);
      armL.position.set(-1.75, 3.25, 0);
      armL.rotation.z = 0.55;
      const armR = new THREE.Mesh(geoMascotArm, matBarrelYellow);
      armR.position.set(1.75, 3.25, 0);
      armR.rotation.z = -0.55;
      g.add(body, head, armL, armR);
      g.userData = { variant: 0, armL, armR };
    } else {
      const cabin = new THREE.Mesh(geoMonsterCabin, matBarrelRed);
      cabin.position.y = 3.15;
      cabin.castShadow = true;
      g.add(cabin);
      for (const wx of [-1.65, 1.65]) for (const wz of [-1.45, 1.45]) {
        const w = new THREE.Mesh(geoMonsterWheel, matLampPole);
        w.position.set(wx, 2.05, wz);
        w.castShadow = true;
        g.add(w);
      }
      g.userData = { variant: 1 };
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
      road: null, rampRoads: [], rampCaps: [],
      shoulders: [], skirts: [], edges: [], dashes: [],
      guardPosts: [], guardBeams: [], connector: null,
      narrowRoad: null, narrowGroup: null,
      forkGroup: null, forkLeftRoad: null, forkRightRoad: null, forkSign: null,
      loopGroup: null, loopDeck: null, loopRailL: null, loopRailR: null, loopStruts: [],
      ramp: null, boost: null, boosterWheels: [], bridge: null, piers: [],
      floor: null, blocks: [], fences: [], arch: null,
      skyLoop: null, mascot0: null, mascot1: null,
      smashProps: [], hazard: null,
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

    /* Jalan plastik oranye + bahu rumput + deck skirt + potongan chasm ramp */
    seg.road = new THREE.Mesh(makeRoadGeo(W), matAsphalt);
    seg.road.receiveShadow = true;
    group.add(seg.road);

    const rampApproach = new THREE.Mesh(makeGapRoadGeo(L / 2, RAMP_GAP_START, 8), matAsphalt);
    rampApproach.receiveShadow = true; rampApproach.visible = false;
    const rampExit = new THREE.Mesh(makeGapRoadGeo(RAMP_GAP_END, -L / 2, 2), matAsphalt);
    rampExit.receiveShadow = true; rampExit.visible = false;
    group.add(rampApproach, rampExit);
    seg.rampRoads.push({ mesh: rampApproach, z0: L / 2, z1: RAMP_GAP_START }, { mesh: rampExit, z0: RAMP_GAP_END, z1: -L / 2 });
    for (const cz of [RAMP_GAP_START, RAMP_GAP_END]) {
      const cap = new THREE.Mesh(geoGapCap, matHazardStripe);
      cap.visible = false;
      group.add(cap);
      seg.rampCaps.push({ mesh: cap, lz: cz });
    }

    /* Narrowing Beam Bridge (half normal width, guardrails terbuka!) */
    const narrowGroup = new THREE.Group();
    const narrowRoad = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matAsphalt);
    narrowRoad.receiveShadow = true;
    narrowGroup.add(narrowRoad);
    narrowGroup.visible = false;
    group.add(narrowGroup);
    seg.narrowGroup = narrowGroup;
    seg.narrowRoad = narrowRoad;

    /* Y-Split Forked Paths (Kiri: buah risiko tinggi | Kanan: koin aman) */
    const forkGroup = new THREE.Group();
    const forkLeftRoad = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matForkLeft);
    forkLeftRoad.receiveShadow = true;
    const forkRightRoad = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matAsphalt);
    forkRightRoad.receiveShadow = true;
    const forkSign = new THREE.Group();
    const fPost = new THREE.Mesh(geoForkSignPost, matConnectorBlue);
    fPost.position.set(0, 2.2, 0); fPost.castShadow = true;
    const fBoard = new THREE.Mesh(geoForkSignBoard, matForkSign);
    fBoard.position.set(0, 4.15, 0);
    forkSign.add(fPost, fBoard);
    forkGroup.add(forkLeftRoad, forkRightRoad, forkSign);
    forkGroup.visible = false;
    group.add(forkGroup);
    seg.forkGroup = forkGroup;
    seg.forkLeftRoad = forkLeftRoad;
    seg.forkRightRoad = forkRightRoad;
    seg.forkSign = forkSign;

    /* 360° Hot Wheels Vertical Loop */
    const loopGroup = new THREE.Group();
    const loopDeck = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matLoopSurface);
    loopDeck.receiveShadow = true;
    const loopRailL = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matCurb);
    const loopRailR = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matCurb);
    loopGroup.add(loopDeck, loopRailL, loopRailR);
    for (const [sx, sz] of [[-LOOP_HALF_W - 0.6, -2.5], [LOOP_HALF_W + 0.6, 2.5]]) {
      const st = new THREE.Mesh(geoLoopStrut, matConnectorBlue);
      st.castShadow = true;
      loopGroup.add(st);
      seg.loopStruts.push({ mesh: st, x: sx, z: sz });
    }
    loopGroup.visible = false;
    group.add(loopGroup);
    seg.loopGroup = loopGroup;
    seg.loopDeck = loopDeck;
    seg.loopRailL = loopRailL;
    seg.loopRailR = loopRailR;

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

    /* Guardrail sisi oranye menonjol (Hot Wheels Track Walls) + Klip Konektor Biru (#0077FF) */
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const post = new THREE.Mesh(geoGuardPost, matCurb);
        post.castShadow = true;
        group.add(post);
        seg.guardPosts.push({ mesh: post, side, k });

        const beam = new THREE.Mesh(geoGuardBeam, matRailColors[k % matRailColors.length]);
        beam.castShadow = true;
        beam.receiveShadow = true;
        group.add(beam);
        seg.guardBeams.push({ mesh: beam, side, k });
      }
    }

    const connector = new THREE.Group();
    const connBar = new THREE.Mesh(geoConnectorBar, matConnectorBlue);
    connBar.position.set(0, -0.14, 0);
    connBar.castShadow = true;
    connector.add(connBar);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(geoConnectorEar, matConnectorBlue);
      ear.position.set(side * (W / 2 + 0.38), 0.34, 0);
      ear.castShadow = true;
      connector.add(ear);
    }
    group.add(connector);
    seg.connector = connector;

    /* Pilar penopang jalan layang ke lantai playroom */
    for (const px of [-W / 2 + 1.5, W / 2 - 1.5]) {
      const p = new THREE.Mesh(geoPillar, matPillar);
      p.castShadow = true;
      group.add(p);
      seg.piers.push({ mesh: p, x: px });
    }

    /* Steep Glowing Green/Blue Triangular Launch Ramp with Yellow-Black Hazard Edge */
    const ramp = new THREE.Group();
    const slab = new THREE.Mesh(geoRamp, matRamp);
    slab.castShadow = true; slab.receiveShadow = true;
    ramp.add(slab);
    const rampAngle = Math.atan2(RAMP_RISE, RAMP_LEN);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(geoRampRail, matConnectorBlue);
      rail.position.set(side * (RAMP_W / 2 + 0.14), 0.14, 0);
      rail.rotation.x = rampAngle;
      rail.castShadow = true;
      ramp.add(rail);
    }
    for (let s = 0; s < 4; s++) {
      const lz = 1.65 - s * 1.1;
      const u = (s + 0.5) / 4;
      const st = new THREE.Mesh(geoRampStripe, matRampStripe);
      st.position.set(0, -RAMP_RISE * 0.45 + u * RAMP_RISE + 0.06, lz);
      st.rotation.x = rampAngle;
      ramp.add(st);
    }
    const hazardLip = new THREE.Mesh(geoRampLipHazard, matHazardStripe);
    hazardLip.position.set(0, RAMP_RISE * 0.46, -RAMP_LEN * 0.47);
    ramp.add(hazardLip);
    ramp.visible = false;
    group.add(ramp); seg.ramp = ramp;

    /* Boost Pad + Motorized Spinning Blue/Yellow Wheel Boosters di kedua sisi */
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
    for (const side of [-1, 1]) {
      const hx = side * (BOOST_W / 2 + 0.68);
      const housing = new THREE.Mesh(geoBoosterHousing, matConnectorBlue);
      housing.position.set(hx, 0.44, 0);
      housing.castShadow = true;
      boost.add(housing);

      for (const wz of [-0.95, 0.95]) {
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(side * (BOOST_W / 2 + 0.24), 0.48, wz);
        const tire = new THREE.Mesh(geoBoosterWheel, matBoosterWheel);
        tire.castShadow = true;
        const hub = new THREE.Mesh(geoBoosterHub, matBoosterHub);
        wheelGroup.add(tire, hub);
        boost.add(wheelGroup);
        seg.boosterWheels.push({ mesh: wheelGroup, side });
      }
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

    /* Dekorasi langit: Background Sky Loops + Giant Mascot / Monster Truck Displays */
    seg.skyLoop = buildSkyLoopDecor();
    seg.skyLoop.visible = false;
    group.add(seg.skyLoop);

    seg.mascot0 = buildMascotDisplay(0);
    seg.mascot0.visible = false;
    group.add(seg.mascot0);

    seg.mascot1 = buildMascotDisplay(1);
    seg.mascot1.visible = false;
    group.add(seg.mascot1);

    /* Smashable cones & barrels (2 barel + 2 kerucut per segmen) */
    for (let p = 0; p < 4; p++) {
      const kind = p < 2 ? 'barrel' : 'cone';
      const mesh = buildPropMesh(kind);
      mesh.visible = false;
      group.add(mesh);
      seg.smashProps.push({
        mesh, kind, lx: 0, lz: 0, baseY: 0,
        active: false, hit: false, vx: 0, vy: 0, vz: 0, rvx: 0, rvz: 0,
      });
    }

    /* Penghalang bahaya tengkorak merah/biru */
    const hazMesh = buildSkullHazardMesh();
    hazMesh.visible = false;
    group.add(hazMesh);
    seg.hazard = {
      mesh: hazMesh, lx: 0, lz: 0, baseY: 0,
      active: false, hit: false, vx: 0, vy: 0, vz: 0, rvx: 0, rvz: 0,
    };

    /* Pool kolektibel per segmen (koin emas, permata pelangi, buah 3D glossy, & Fire Ring) */
    for (let c = 0; c < MAX_COLLECTIBLES; c++) {
      const wrapper = new THREE.Group();
      const coinMesh = buildCoinMesh();
      const gemMesh = buildGemMesh();
      const fruitType = FRUIT_TYPES[c % FRUIT_TYPES.length];
      const fruitMesh = buildToyFruit(fruitType);
      const fireRingMesh = buildFireRingMesh();
      wrapper.add(coinMesh, gemMesh, fruitMesh, fireRingMesh);
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
        fireRingMesh,
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

  function displaceRibbon(mesh, steps, evalFn) {
    const pos = mesh.geometry.attributes.position;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const { lx, rx, y, z } = evalFn(t);
      const i0 = s * 2, i1 = i0 + 1;
      pos.setXYZ(i0, lx, y, z);
      pos.setXYZ(i1, rx, y, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  const _tmpLPos = new THREE.Vector3();
  const _tmpRPos = new THREE.Vector3();
  function displaceLoop(seg, centerZ) {
    const z0 = L / 2, z1 = -L / 2;
    const y0 = getTrackHeight(centerZ + z0);
    const y1 = getTrackHeight(centerZ + z1);
    const pos = seg.loopDeck.geometry.attributes.position;
    const posRL = seg.loopRailL.geometry.attributes.position;
    const posRR = seg.loopRailR.geometry.attributes.position;

    for (let s = 0; s <= LOOP_STEPS; s++) {
      const u = s / LOOP_STEPS;
      evalLoopPose(z0, z1, y0, y1, u, -LOOP_HALF_W, _tmpLPos, null, _lpRight);
      evalLoopPose(z0, z1, y0, y1, u, LOOP_HALF_W, _tmpRPos, null, _lpRight);
      const i0 = s * 2, i1 = i0 + 1;
      pos.setXYZ(i0, _tmpLPos.x, _tmpLPos.y, _tmpLPos.z);
      pos.setXYZ(i1, _tmpRPos.x, _tmpRPos.y, _tmpRPos.z);

      // Raised side rails along the loop
      evalLoopPose(z0, z1, y0, y1, u, -LOOP_HALF_W - 0.15, _tmpLPos, null, _lpRight);
      posRL.setXYZ(i0, _tmpLPos.x, _tmpLPos.y, _tmpLPos.z);
      posRL.setXYZ(i1, _tmpLPos.x + _lpUp.x * 0.65, _tmpLPos.y + _lpUp.y * 0.65, _tmpLPos.z + _lpUp.z * 0.65);

      evalLoopPose(z0, z1, y0, y1, u, LOOP_HALF_W + 0.15, _tmpRPos, null, _lpRight);
      posRR.setXYZ(i0, _tmpRPos.x, _tmpRPos.y, _tmpRPos.z);
      posRR.setXYZ(i1, _tmpRPos.x + _lpUp.x * 0.65, _tmpRPos.y + _lpUp.y * 0.65, _tmpRPos.z + _lpUp.z * 0.65);
    }
    pos.needsUpdate = true; seg.loopDeck.geometry.computeVertexNormals();
    posRL.needsUpdate = true; seg.loopRailL.geometry.computeVertexNormals();
    posRR.needsUpdate = true; seg.loopRailR.geometry.computeVertexNormals();

    const midY = (y0 + y1) * 0.5 + LOOP_RADIUS * 1.4;
    const h = Math.max(4, midY - FLOOR_Y);
    for (const st of seg.loopStruts) {
      st.mesh.scale.y = h;
      st.mesh.position.set(st.x, FLOOR_Y + h * 0.5, st.z);
    }
  }

  function assignCollectibles(seg, i, centerZ) {
    for (const item of seg.collectibles) {
      item.active = false;
      item.collected = false;
      item.obj.visible = false;
      item.groundRing.visible = false;
    }

    let cursor = 0;
    const placeItem = (kind, lx, lz, yOff, absY = null) => {
      if (cursor >= MAX_COLLECTIBLES) return;
      const slot = seg.collectibles[cursor++];
      slot.kind = kind;
      slot.lx = lx;
      slot.lz = lz;
      const trackY = absY !== null ? absY : getTrackHeight(centerZ + lz);
      slot.baseY = absY !== null ? absY : (trackY + yOff);
      slot.phase = (i * 0.9 + cursor * 0.65);
      slot.active = true;
      slot.collected = false;
      slot.coinMesh.visible = kind === 'coin';
      slot.gemMesh.visible = kind === 'gem';
      slot.fruitMesh.visible = kind === 'fruit';
      slot.fireRingMesh.visible = kind === 'ring';
      slot.obj.position.set(lx, slot.baseY, lz);
      slot.obj.visible = true;

      if (absY === null && (kind === 'fruit' || kind === 'gem')) {
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
      placeItem('coin', 0, -3.5, 0.95);
      placeItem('coin', 0, -6.0, 0.95);
      placeItem('fruit', 0, -9.2, 1.25);
      return;
    }

    if (seg.type === 'loop') {
      const z0 = L / 2, z1 = -L / 2;
      const y0 = getTrackHeight(centerZ + z0);
      const y1 = getTrackHeight(centerZ + z1);
      const lp = new THREE.Vector3();
      const loopUs = [0.18, 0.34, 0.5, 0.66, 0.82];
      loopUs.forEach((u, idx) => {
        evalLoopPose(z0, z1, y0, y1, u, 0, lp, null, _lpRight);
        const kind = idx === 2 ? 'gem' : idx % 2 === 1 ? 'fruit' : 'coin';
        placeItem(kind, lp.x, lp.z, 0, lp.y + (u > 0.25 && u < 0.75 ? -1.1 : 1.1));
      });
      return;
    }

    if (seg.type === 'fork') {
      // Kiri: jalur risiko tinggi penuh buah glossy & Fire Ring! Kanan: jalur aman berderet koin
      const ts = [0.22, 0.38, 0.54, 0.70, 0.82];
      ts.forEach((t, idx) => {
        const fp = getForkProfile(t);
        const lz = L / 2 - t * L;
        const kindL = idx === 2 ? 'ring' : idx === 3 ? 'gem' : 'fruit';
        placeItem(kindL, fp.cxL, lz, fp.yOffL + (kindL === 'ring' ? 1.85 : 1.25));
        placeItem('coin', fp.cxR, lz, 0.95);
      });
      return;
    }

    if (seg.type === 'narrow') {
      for (let k = 0; k < 6; k++) {
        const lz = 9.0 - k * 3.6;
        const kind = k === 2 || k === 5 ? 'fruit' : 'coin';
        placeItem(kind, Math.sin(k * 0.9) * 0.85, lz, kind === 'fruit' ? 1.25 : 0.95);
      }
      return;
    }

    if (seg.type === 'ramp') {
      placeItem('coin', 0, 5.5, 0.95);
      placeItem('coin', 0, 2.2, 1.2);
      const arcSteps = [-0.8, -3.2, -5.6, -8.0, -10.4];
      arcSteps.forEach((lz, idx) => {
        const u = (idx + 1) / arcSteps.length;
        const yOff = 1.6 + Math.sin(u * Math.PI * 0.58) * 3.15;
        const kind = idx === 2 ? 'ring' : idx === 3 ? 'gem' : 'coin';
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
      placeItem(i % 2 === 0 ? 'ring' : 'fruit', 0, -4.8, i % 2 === 0 ? 1.9 : 1.25);
      placeItem('coin', 0, -7.8, 0.95);
      placeItem('coin', 0, -10.2, 0.95);
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

    const isPlainDeck = seg.type !== 'narrow' && seg.type !== 'fork' && seg.type !== 'loop' && seg.type !== 'ramp';
    seg.road.visible = isPlainDeck;
    if (isPlainDeck) displace(seg.road, centerZ);

    const showRampDeck = seg.type === 'ramp';
    for (const rr of seg.rampRoads) {
      rr.mesh.visible = showRampDeck;
      if (showRampDeck) displace(rr.mesh, centerZ);
    }
    for (const rc of seg.rampCaps) {
      rc.mesh.visible = showRampDeck;
      if (showRampDeck) {
        rc.mesh.position.set(0, getTrackHeight(centerZ + rc.lz) - 0.16, rc.lz);
        rc.mesh.rotation.x = Math.atan(-getTrackSlope(centerZ + rc.lz));
      }
    }

    seg.narrowGroup.visible = seg.type === 'narrow';
    if (seg.narrowGroup.visible) {
      displaceRibbon(seg.narrowRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const hw = getNarrowHalfWidth(t);
        return { lx: -hw, rx: hw, y: getTrackHeight(centerZ + lz), z: lz };
      });
    }

    seg.forkGroup.visible = seg.type === 'fork';
    if (seg.forkGroup.visible) {
      displaceRibbon(seg.forkLeftRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const fp = getForkProfile(t);
        return { lx: fp.cxL - fp.hwL, rx: fp.cxL + fp.hwL, y: getTrackHeight(centerZ + lz) + fp.yOffL, z: lz };
      });
      displaceRibbon(seg.forkRightRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const fp = getForkProfile(t);
        return { lx: fp.cxR - fp.hwR, rx: fp.cxR + fp.hwR, y: getTrackHeight(centerZ + lz) + fp.yOffR, z: lz };
      });
      seg.forkSign.position.set(0, getTrackHeight(centerZ + L * 0.34), L * 0.34);
    }

    seg.loopGroup.visible = seg.type === 'loop';
    if (seg.loopGroup.visible) {
      displaceLoop(seg, centerZ);
    }

    const showShoulders = isPlainDeck;
    for (const sh of seg.shoulders) {
      sh.mesh.visible = showShoulders;
      if (showShoulders) displaceShoulder(sh.mesh, sh.side, centerZ);
    }
    for (const sk of seg.skirts) {
      sk.visible = isPlainDeck;
      if (isPlainDeck) displaceSkirt(sk, centerZ);
    }
    for (const e of seg.edges) {
      e.visible = isPlainDeck;
      if (isPlainDeck) displace(e, centerZ, 0.02);
    }
    seg.dashes.forEach((d, k) => {
      const lz = -L / 2 + 2 + k * 4;
      d.visible = isPlainDeck || (showRampDeck && (lz > RAMP_GAP_START || lz < RAMP_GAP_END));
      if (d.visible) {
        d.position.set(0, getTrackHeight(centerZ + lz) + 0.03, lz);
        d.rotation.x = Math.atan(-getTrackSlope(centerZ + lz));
      }
    });

    const showGuards = isPlainDeck || showRampDeck;
    for (const gp of seg.guardPosts) {
      const lz = -L / 2 + 2 + gp.k * 4;
      gp.mesh.visible = showGuards && !(showRampDeck && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5);
      if (gp.mesh.visible) {
        const y = getTrackHeight(centerZ + lz);
        gp.mesh.position.set(gp.side * (W / 2 + 0.32), y + 0.36, lz);
      }
    }
    for (const gb of seg.guardBeams) {
      const lz = -L / 2 + 2 + gb.k * 4;
      gb.mesh.visible = showGuards && !(showRampDeck && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5);
      if (gb.mesh.visible) {
        const y = getTrackHeight(centerZ + lz);
        gb.mesh.position.set(gb.side * (W / 2 + 0.14), y + 0.32, lz);
        gb.mesh.rotation.x = Math.atan(-getTrackSlope(centerZ + lz));
      }
    }
    if (seg.connector) {
      const seamZ = L / 2;
      seg.connector.position.set(0, getTrackHeight(centerZ + seamZ), seamZ);
      seg.connector.rotation.x = Math.atan(-getTrackSlope(centerZ + seamZ));
    }

    const roadMidY = getTrackHeight(centerZ);
    const pierH = Math.max(2, roadMidY - FLOOR_Y);
    for (const p of seg.piers) {
      p.mesh.visible = seg.type !== 'loop' && seg.type !== 'fork';
      if (p.mesh.visible) {
        p.mesh.scale.y = pierH;
        p.mesh.position.set(seg.type === 'narrow' ? p.x * 0.32 : p.x, FLOOR_Y + pierH / 2, 0);
      }
    }

    seg.ramp.visible = seg.type === 'ramp';
    if (seg.ramp.visible) {
      seg.ramp.position.set(0, getTrackHeight(centerZ) + RAMP_RISE * 0.5, 0);
      seg.ramp.rotation.x = Math.atan(-getTrackSlope(centerZ));
    }

    seg.boost.visible = seg.type === 'boost' || seg.type === 'loop';
    if (seg.boost.visible) {
      const bz = seg.type === 'loop' ? (L / 2 - 2.2) : 0;
      seg.boost.position.set(0, getTrackHeight(centerZ + bz) + 0.07, bz);
      seg.boost.rotation.x = Math.atan(-getTrackSlope(centerZ + bz));
    }

    seg.bridge.visible = seg.type === 'bridge';
    if (seg.bridge.visible) {
      const plateauY = getTrackHeight(centerZ);
      const h = Math.max(2, plateauY - FLOOR_Y);
      for (const p of seg.pillars) {
        p.scale.y = h;
        p.position.y = FLOOR_Y + h / 2;
      }
    }

    seg.arch.visible = i >= 4 && i % (TRACK.archEvery || 8) === 0 && seg.type !== 'loop';
    if (seg.arch.visible) seg.arch.position.set(0, roadMidY, 0);

    /* Sky Loops di cakrawala atas Salatiga + Maskot / Monster Truck raksasa di tepi */
    seg.skyLoop.visible = i >= 1 && i % 3 === 0;
    if (seg.skyLoop.visible) {
      const side = i % 2 === 0 ? -1 : 1;
      seg.skyLoop.position.set(side * 42, FLOOR_Y, 0);
      seg.skyLoop.rotation.y = side * -0.52;
    }
    const showMascot = i >= 2 && i % 4 === 0 && seg.type !== 'loop';
    const useMonster = (Math.floor(i / 4) % 2) === 1;
    seg.mascot0.visible = showMascot && !useMonster;
    seg.mascot1.visible = showMascot && useMonster;
    if (showMascot) {
      const side = i % 8 === 0 ? -1 : 1;
      const mObj = useMonster ? seg.mascot1 : seg.mascot0;
      mObj.position.set(side * 24.5, FLOOR_Y, -3.5);
      mObj.rotation.y = side < 0 ? 0.55 : -0.55;
    }

    /* Smashable props (kerucut & tong mainan) + Penghalang tengkorak merah/biru */
    const LANE_W = W / TRACK.lanes;
    const propLaneIdx = Math.floor(hash(i * 37 + 11) * 3) % 3;
    const propLaneX = (propLaneIdx - 1) * LANE_W;
    const showProps = (seg.type === 'plain' || seg.type === 'boost') && i >= 2;
    seg.smashProps.forEach((p, idx) => {
      p.hit = false;
      p.vx = 0; p.vy = 0; p.vz = 0; p.rvx = 0; p.rvz = 0;
      p.mesh.rotation.set(0, 0, 0);
      p.active = showProps;
      p.mesh.visible = showProps;
      if (showProps) {
        const ox = (idx % 2 === 0 ? -0.68 : 0.68);
        const oz = 3.5 - Math.floor(idx / 2) * 3.4;
        p.lx = propLaneX + ox;
        p.lz = oz;
        p.baseY = getTrackHeight(centerZ + oz);
        p.mesh.position.set(p.lx, p.baseY, p.lz);
      }
    });

    const haz = seg.hazard;
    const showHazard = seg.type === 'plain' && i >= 5 && (i % 3 === 1 || i % 7 === 2);
    haz.hit = false;
    haz.vx = 0; haz.vy = 0; haz.vz = 0; haz.rvx = 0; haz.rvz = 0;
    haz.mesh.rotation.set(0, 0, 0);
    haz.active = showHazard;
    haz.mesh.visible = showHazard;
    if (showHazard) {
      const hazLaneIdx = (propLaneIdx + 1 + (i % 2)) % 3;
      haz.lx = (hazLaneIdx - 1) * LANE_W;
      haz.lz = -4.5;
      haz.baseY = getTrackHeight(centerZ + haz.lz);
      haz.mesh.position.set(haz.lx, haz.baseY, haz.lz);
    }

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

  let prevTrackT = null;

  /* ---------- Daur ulang segmen + animasi angin & kolektibel ---------- */
  function updateTrack(playerZ, t = 0) {
    windUniform.value = t;
    const dt = prevTrackT === null ? 0.016 : Math.min(0.05, Math.max(0, t - prevTrackT));
    prevTrackT = t;

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

      if (seg.mascot0.visible && seg.mascot0.userData.armL) {
        seg.mascot0.userData.armL.rotation.z = 0.55 + Math.sin(t * 4.4 + seg.index) * 0.35;
        seg.mascot0.userData.armR.rotation.z = -0.55 - Math.cos(t * 4.4 + seg.index) * 0.35;
      }

      for (const p of seg.smashProps) {
        if (!p.active || !p.hit || !p.mesh.visible) continue;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 28 * dt;
        p.mesh.rotation.x += p.rvx * dt;
        p.mesh.rotation.z += p.rvz * dt;
        if (p.mesh.position.y < FLOOR_Y - 6) p.mesh.visible = false;
      }

      if (seg.hazard.active && seg.hazard.hit && seg.hazard.mesh.visible) {
        const hz = seg.hazard;
        hz.mesh.position.x += hz.vx * dt;
        hz.mesh.position.y += hz.vy * dt;
        hz.mesh.position.z += hz.vz * dt;
        hz.vy -= 30 * dt;
        hz.mesh.rotation.x += hz.rvx * dt;
        hz.mesh.rotation.z += hz.rvz * dt;
        if (hz.mesh.position.y < FLOOR_Y - 6) hz.mesh.visible = false;
      }

      if (seg.boost.visible) {
        for (const bw of seg.boosterWheels) {
          bw.mesh.rotation.x = -t * 22;
        }
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
        } else if (item.kind === 'ring') {
          item.fireRingMesh.rotation.z = t * 3.2 + item.phase;
          item.fireRingMesh.rotation.y = Math.sin(t * 1.6 + item.phase) * 0.18;
        } else {
          item.fruitMesh.rotation.y = t * 2.4 + item.phase;
          item.fruitMesh.rotation.z = Math.sin(t * 1.9 + item.phase) * 0.1;
          item.groundRing.scale.setScalar(0.95 + Math.sin(t * 4.2 + item.phase) * 0.16);
        }
      }
    }

    matBoost.emissiveIntensity = 0.5 + Math.sin(t * 4) * 0.3;
    matChevron.emissiveIntensity = 0.35 + Math.sin(t * 4 + 1) * 0.2;
    matBeaconRed.emissiveIntensity = 1.0 + Math.sin(t * 12) * 0.7;
    matBeaconBlue.emissiveIntensity = 1.0 - Math.sin(t * 12) * 0.7;
  }

  /* ---------- Deteksi pengambilan koin, buah, permata & Fire Ring (zero-GC) ---------- */
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
        const hitPad = item.kind === 'ring' ? 2.9 : item.kind === 'fruit' ? 2.45 : 2.2;
        const hitY = item.kind === 'ring' ? 3.2 : 2.55;
        if (
          Math.abs(pos.x - wx) < hitPad &&
          Math.abs(py - wy) < hitY &&
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

  const _smashed = [];
  function checkPropSmash(pos, half = { x: 1.15, z: 1.75 }) {
    _smashed.length = 0;
    for (const seg of pool) {
      if (seg.index === null) continue;
      const centerZ = seg.group.position.z;
      if (Math.abs(centerZ - pos.z) > L * 0.85) continue;
      for (const p of seg.smashProps) {
        if (!p.active || p.hit) continue;
        const wz = centerZ + p.lz;
        if (
          Math.abs(pos.x - p.lx) < half.x + 0.55 &&
          Math.abs(pos.z - wz) < half.z + 0.55 &&
          Math.abs(pos.y - p.baseY) < 1.8
        ) {
          p.hit = true;
          const dir = p.lx >= pos.x ? 1 : -1;
          p.vx = dir * (6 + Math.random() * 6);
          p.vy = 11 + Math.random() * 5;
          p.vz = -(14 + Math.random() * 8);
          p.rvx = (Math.random() > 0.5 ? 1 : -1) * 11;
          p.rvz = (Math.random() > 0.5 ? 1 : -1) * 9;
          _smashed.push({ kind: p.kind, x: p.lx, y: p.baseY + 0.5, z: wz });
        }
      }
    }
    return _smashed;
  }

  function checkHazardCollision(pos, half = { x: 0.95, z: 1.55 }) {
    for (const seg of pool) {
      if (seg.index === null) continue;
      const hz = seg.hazard;
      if (!hz.active || hz.hit) continue;
      const centerZ = seg.group.position.z;
      const wz = centerZ + hz.lz;
      if (
        Math.abs(pos.x - hz.lx) < half.x + 1.45 &&
        Math.abs(pos.z - wz) < half.z + 0.45 &&
        Math.abs(pos.y - hz.baseY) < 2.2
      ) {
        hz.hit = true;
        hz.vx = (hz.lx >= pos.x ? 1 : -1) * 9;
        hz.vy = 12;
        hz.vz = -16;
        hz.rvx = 8;
        hz.rvz = -9;
        return { x: hz.lx, y: hz.baseY + 0.8, z: wz };
      }
    }
    return null;
  }

  const _upcomingHazards = [];
  function getUpcomingHazards(playerZ, maxDist = 72) {
    _upcomingHazards.length = 0;
    for (const seg of pool) {
      if (seg.index === null) continue;
      const hz = seg.hazard;
      if (!hz.active || hz.hit) continue;
      const wz = seg.group.position.z + hz.lz;
      const dist = playerZ - wz;
      if (dist > 0.5 && dist <= maxDist) {
        _upcomingHazards.push({ laneX: hz.lx, dist, z: wz });
      }
    }
    _upcomingHazards.sort((a, b) => a.dist - b.dist);
    return _upcomingHazards;
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
      for (const p of seg.smashProps) {
        if (p.active) {
          p.hit = false;
          p.vx = 0; p.vy = 0; p.vz = 0;
          p.mesh.rotation.set(0, 0, 0);
          p.mesh.position.set(p.lx, p.baseY, p.lz);
          p.mesh.visible = true;
        }
      }
      if (seg.hazard.active) {
        seg.hazard.hit = false;
        seg.hazard.vx = 0; seg.hazard.vy = 0; seg.hazard.vz = 0;
        seg.hazard.mesh.rotation.set(0, 0, 0);
        seg.hazard.mesh.position.set(seg.hazard.lx, seg.hazard.baseY, seg.hazard.lz);
        seg.hazard.mesh.visible = true;
      }
    }
  }

  function getCollectibleTargets(zMin, zMax, out = []) {
    out.length = 0;
    for (const seg of pool) {
      if (seg.index === null) continue;
      const centerZ = seg.group.position.z;
      if (centerZ + L * 0.6 < zMin || centerZ - L * 0.6 > zMax) continue;
      for (const item of seg.collectibles) {
        if (!item.active || item.collected) continue;
        const wz = centerZ + item.lz;
        if (wz >= zMin && wz <= zMax) {
          out.push({ x: item.lx, y: item.obj.position.y, z: wz, kind: item.kind });
        }
      }
    }
    return out;
  }

  function dispose() {
    for (const seg of pool) {
      scene.remove(seg.group);
      seg.road.geometry.dispose();
      for (const rr of seg.rampRoads) rr.mesh.geometry.dispose();
      seg.narrowRoad.geometry.dispose();
      seg.forkLeftRoad.geometry.dispose();
      seg.forkRightRoad.geometry.dispose();
      seg.loopDeck.geometry.dispose();
      seg.loopRailL.geometry.dispose();
      seg.loopRailR.geometry.dispose();
      for (const sh of seg.shoulders) sh.mesh.geometry.dispose();
      for (const sk of seg.skirts) sk.geometry.dispose();
      for (const e of seg.edges) e.geometry.dispose();
      seg.grassInst.dispose();
      seg.flowerInst.dispose();
      for (const item of seg.collectibles) item.gemMesh.userData.gemMat.dispose();
    }
    [
      geoDash, geoRamp, geoRampRail, geoRampStripe, geoRampLipHazard, geoBoost, geoChevron,
      geoBoosterHousing, geoBoosterWheel, geoBoosterHub, geoConnectorBar, geoConnectorEar,
      geoFireRingTorus, geoFireFlame, geoSkyLoop, geoConeBody, geoConeBase, geoConeCollar,
      geoBarrelBody, geoBarrelBand, geoHazardBody, geoHazardSign, geoHazardBeacon,
      geoMascotPlinth, geoMascotHead, geoMascotBody, geoMascotArm, geoMonsterWheel, geoMonsterCabin,
      geoGapCap, geoLoopStrut, geoForkSignPost, geoForkSignBoard,
      geoPillar, geoGuardPost, geoGuardBeam, geoTrunk, geoCanopy, geoBushLobe, geoBerry,
      geoPlantShadow, geoGrassTuft, geoFlower, geoLampBase, geoLampPole,
      geoLampArm, geoLampHead, geoFloor, geoBlock, geoFencePost, geoFenceRail,
      geoArchPillar, geoArchBeam, geoArchSign, geoArchBulb, geoBunting,
      geoCoinBody, geoCoinRim, geoCoinCore, geoGemStar, geoGemRing, geoGlowRing,
    ].forEach((g) => g.dispose());
    [
      matAsphalt, matForkLeft, matLoopSurface, matGapCap, matForkSign, matHazardStripe,
      matFireRing, matFireFlame, matConeOrange, matConeWhite, matBarrelRed, matBarrelYellow,
      matSkullSign, matBeaconRed, matBeaconBlue,
      matShoulderBlend, matDeckSide, matCurb, matLine, matConnectorBlue,
      matRamp, matRampStripe, matBoost, matChevron, matBoosterWheel, matBoosterHub,
      matPillar, ...matRailColors,
      matTrunk, matLeaf1, matLeaf2, matLeaf3, matBushEmerald, matBushPurple,
      matBerry, matGrassTuft, matFlower, matPlantShadow, matLampPole,
      matLampCollar, matLampHead, ...floorMats, ...blockMats, matArchBanner,
      matArchBlue, matArchGold, matFenceRed, matFenceWhite, matCoinGold,
      matCoinRim, matGemHalo, ...Object.values(ringMats),
    ].forEach((m) => m.dispose());
    [
      roadTex.map, roadTex.normalMap, plantShadowTex, glowRingTex, forkSignTex,
      hazardStripeTex, skullSignTex,
      ...floorTextures, ...blockTextures, archBannerTex,
    ].forEach((t) => t.dispose());
    pool.length = 0;
  }

  return {
    updateTrack, collectNearby, checkPropSmash, checkHazardCollision, getUpcomingHazards,
    getCollectibleTargets, resetCollectibles, dispose,
    getTrackHeight, getTrackSlope, getTrackSurfaceAt, evalLoopPose,
    checkRampCollision, checkBoostCollision, getSegmentType,
    get segmentCount() { return pool.length; },
  };
}
