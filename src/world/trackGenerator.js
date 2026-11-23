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
export const FLOOR_Y = -5.8;
const RAMP_W = 7.2, RAMP_LEN = 5.2, RAMP_RISE = 1.65, RAMP_OFFSET = 4.0, RAMP_SAFE_W = 8.0;
const RAMP_GAP_START = -3.3; // lz (ramp ends around -2.6)
const RAMP_GAP_END = -10.5;  // lz (rejoins road before -12 seam)
const BOOST_W = 5.0, BOOST_LEN = 3.4;
export const LOOP_RADIUS = TRACK.loopRadius ?? 7.8;
export const LOOP_HALF_W = (TRACK.loopWidth ?? 6.2) * 0.5;
export const LOOP_CENTER_X = -4.2;
export const BYPASS_CENTER_X = 4.2;
export const BYPASS_HALF_W = 3.6;
const LOOP_HELIX = 1.35;
export const LOOP_ARC_LEN = Math.PI * 2 * LOOP_RADIUS + 14;
const LOOP_STEPS = 44;
const NARROW_HALF_W = (TRACK.narrowWidth ?? 7.8) * 0.5;
const FORK_HALF_L = (TRACK.forkWidthL ?? 6.8) * 0.5;
const FORK_HALF_R = (TRACK.forkWidthR ?? 8.6) * 0.5;
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

export function getRampSide(i) {
  const m10 = ((i % 10) + 10) % 10;
  return m10 === 3 ? -1 : 1;
}

/* ---------- Kurva S-Curve, Banking & Ketinggian (kontrak terkunci) ---------- */
export function getTrackCenterX(z) {
  const c = TRACK.curve || { amp: 3.8, freq: 0.0135, startZ: 96, rampZ: 168 };
  const dist = Math.max(0, -z);
  if (dist <= c.startZ) return 0;
  return c.amp * smoothstep(c.startZ, c.rampZ, dist) * Math.sin(dist * c.freq);
}
export function getTrackSlopeX(z) {
  const e = 0.5;
  return (getTrackCenterX(z - e) - getTrackCenterX(z + e)) / (2 * e);
}
export function getTrackYaw(z) {
  return -Math.atan(getTrackSlopeX(z));
}
export function getTrackBank(z) {
  const c = TRACK.curve || { freq: 0.0135, startZ: 96, rampZ: 168, bankGain: 0.055 };
  const dist = Math.max(0, -z);
  if (dist <= c.startZ) return 0;
  const i = Math.floor(dist / L);
  const st = getSegmentType(i);
  const t = Math.min(1, Math.max(0, (dist - i * L) / L));
  let fade = 1;
  if (st === 'fork' || st === 'loop') {
    fade = 1 - smoothstep(0.0, 0.18, t) * (1 - smoothstep(0.82, 1.0, t));
  }
  return (c.bankGain ?? 0.055) * fade * smoothstep(c.startZ, c.rampZ, dist) * Math.sin(dist * c.freq);
}

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
    cxL: -6.0 * split,
    hwL: THREE.MathUtils.lerp(W / 2, FORK_HALF_L, split),
    yOffL: 4.6 * split,
    cxR: 3.2 * split,
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
  const cx0 = getTrackCenterX(zStart);
  const cx1 = getTrackCenterX(zEnd);
  const baseCx = THREE.MathUtils.lerp(cx0, cx1, clampedU);

  const cx = baseCx + LOOP_CENTER_X - LOOP_HELIX * sinT;
  const cy = baseY + LOOP_RADIUS * (1 - cosT);
  const cz = THREE.MathUtils.lerp(zStart, zEnd, clampedU) - LOOP_RADIUS * sinT;

  const dTheta = Math.PI * 2;
  const spanZ = zEnd - zStart; // -L
  _lpForward.set(
    (cx1 - cx0) - LOOP_HELIX * cosT * dTheta,
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
  const cx = getTrackCenterX(z);
  const bank = getTrackBank(z);
  const lx = x - cx;
  const baseY = getTrackHeight(z);
  const slope = getTrackSlope(z);

  if (type === 'narrow') {
    const hw = getNarrowHalfWidth(t);
    const onTrack = Math.abs(lx) <= hw + 0.25;
    return { type, segIndex: i, t, onTrack, groundY: baseY + lx * bank, slope, bank, centerX: cx, safeCenterX: cx, safeHalfW: hw, inGap: !onTrack, hasGuardrails: false };
  }

  if (type === 'fork') {
    const fp = getForkProfile(t);
    if (fp.split < 0.22) {
      const onTrack = Math.abs(lx) <= W / 2 + 0.35;
      return { type, segIndex: i, t, onTrack, groundY: baseY + lx * bank, slope, bank, centerX: cx, safeCenterX: cx, safeHalfW: W / 2, inGap: !onTrack, hasGuardrails: false };
    }
    const onLeft = Math.abs(lx - fp.cxL) <= fp.hwL + 0.28;
    const onRight = Math.abs(lx - fp.cxR) <= fp.hwR + 0.28;
    const onTrack = onLeft || onRight;
    const nearLeft = Math.abs(lx - fp.cxL) <= Math.abs(lx - fp.cxR);
    return {
      type,
      segIndex: i,
      t,
      onTrack,
      groundY: baseY + (onLeft ? fp.yOffL : 0),
      slope,
      bank: 0,
      centerX: cx,
      safeCenterX: cx + (nearLeft ? fp.cxL : fp.cxR),
      safeHalfW: nearLeft ? fp.hwL : fp.hwR,
      inGap: !onTrack,
      hasGuardrails: false,
    };
  }

  if (type === 'ramp') {
    const rampSide = getRampSide(i);
    const onGapSide = (lx * rampSide) > -0.15;
    const inChasm = onGapSide && lz <= RAMP_GAP_START && lz >= RAMP_GAP_END;
    const onTrack = !inChasm && Math.abs(lx) <= W / 2 + 0.45;
    return {
      type,
      segIndex: i,
      t,
      onTrack,
      groundY: baseY + lx * bank,
      slope,
      bank,
      centerX: cx,
      safeCenterX: cx + (inChasm ? -rampSide * RAMP_OFFSET : 0),
      safeHalfW: inChasm ? RAMP_SAFE_W * 0.48 : W / 2,
      inGap: inChasm || !onTrack,
      hasGuardrails: !inChasm,
      rampSide,
    };
  }

  if (type === 'loop') {
    const onEntryExit = t < 0.08 || t > 0.92;
    const onLoop = Math.abs(lx - LOOP_CENTER_X) <= LOOP_HALF_W + 0.45;
    const onBypass = Math.abs(lx - BYPASS_CENTER_X) <= BYPASS_HALF_W + 0.45;
    const onTrack = onEntryExit ? Math.abs(lx) <= W / 2 + 0.5 : (onLoop || onBypass);
    const nearLoop = lx < 0;
    return {
      type,
      segIndex: i,
      t,
      onTrack,
      groundY: baseY + lx * bank,
      slope,
      bank,
      centerX: cx,
      safeCenterX: cx + (nearLoop ? LOOP_CENTER_X : BYPASS_CENTER_X),
      safeHalfW: nearLoop ? LOOP_HALF_W : BYPASS_HALF_W,
      inGap: !onTrack,
      hasGuardrails: true,
    };
  }

  return {
    type,
    segIndex: i,
    t,
    onTrack: Math.abs(lx) <= W / 2 + 0.5,
    groundY: baseY + lx * bank,
    slope,
    bank,
    centerX: cx,
    safeCenterX: cx,
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
  const rx = getTrackCenterX(zc) + getRampSide(i) * RAMP_OFFSET;
  if (Math.abs(z - zc) < RAMP_LEN / 2 && Math.abs(x - rx) < RAMP_W / 2) {
    return { z: zc, x: rx, width: RAMP_W, launchVy: PHYSICS.ramp.launchVy, topY: getTrackHeight(zc) + RAMP_RISE };
  }
  return null;
}
export function checkBoostCollision(x, z) {
  const i = Math.floor(-z / L);
  const type = getSegmentType(i);
  if (type === 'boost') {
    const zc = -(i + 0.5) * L;
    const bx = getTrackCenterX(zc);
    if (Math.abs(z - zc) < BOOST_LEN / 2 && Math.abs(x - bx) < BOOST_W / 2) return { z: zc, x: bx, width: BOOST_W };
  } else if (type === 'loop') {
    const zEntry = -i * L - 2.2;
    const bx = getTrackCenterX(zEntry) + LOOP_CENTER_X;
    if (Math.abs(z - zEntry) < 2.2 && Math.abs(x - bx) < LOOP_HALF_W) {
      return { z: zEntry, x: bx, width: LOOP_HALF_W * 2 };
    }
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
    // Padang rumput kota kecil Salatiga yang lembut & rapi
    const cols = ['#6bbd8c', '#74c69d', '#5eb382', '#7fd1a4'];
    const sz = 64;
    for (let y = 0; y < 256; y += sz) {
      for (let x = 0; x < 512; x += sz) {
        const idx = ((x / sz) + (y / sz)) % 4;
        g.fillStyle = cols[idx];
        g.fillRect(x, y, sz, sz);
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.lineWidth = 1.5;
        g.strokeRect(x + 1, y + 1, sz - 2, sz - 2);
      }
    }
  } else if (kind === 1) {
    // Taman hijau dengan petak bunga mini lembut
    g.fillStyle = '#5eb382';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#6bbd8c';
    for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 32, 256);
    const flowers = ['#f4a2b8', '#f6d57a', '#8fd3e8', '#f5eee0'];
    for (let k = 0; k < 12; k++) {
      g.fillStyle = flowers[k % flowers.length];
      g.beginPath();
      g.arc((k * 79 + 25) % 512, (k % 2 === 0 ? 48 : 206), 7, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Padang rumput hijau hangat kotak halus
    g.fillStyle = '#6bbd8c';
    g.fillRect(0, 0, 512, 256);
    const sz = 64;
    for (let y = 0; y < 256; y += sz) {
      for (let x = 0; x < 512; x += sz) {
        if (((x / sz) + (y / sz)) % 2 === 0) {
          g.fillStyle = '#7cd1a0';
          g.fillRect(x, y, sz, sz);
        }
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

function makeArchBannerTex(text = '🔥 JURAGAN NGEBUT • KING OF THE ROAD 🔥', c0 = '#d90429', c1 = '#ff6b00', border = '#ffd100', checkered = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, c0);
  grad.addColorStop(0.5, c1);
  grad.addColorStop(1, c0);
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(6, 6, 1012, 180, 26); g.fill();
  if (checkered) {
    const sq = 22;
    for (let x = 22; x < 118; x += sq) {
      for (let y = 22; y < 170; y += sq) {
        g.fillStyle = ((Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0) ? '#ffffff' : '#18181b';
        g.fillRect(x, y, sq, sq);
        g.fillRect(1024 - x - sq, y, sq, sq);
      }
    }
  }
  g.strokeStyle = border;
  g.lineWidth = 12;
  g.beginPath(); g.roundRect(14, 14, 996, 164, 20); g.stroke();
  g.fillStyle = '#fff8eb';
  g.font = '700 54px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCheckeredStripeTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  const cols = 16, rows = 4;
  const cw = c.width / cols, ch = c.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      g.fillStyle = ((r + k) % 2 === 0) ? '#ffffff' : '#18181b';
      g.fillRect(k * cw, r * ch, cw + 0.5, ch + 0.5);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWarnTriangleTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#e11d48';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 16;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(128, 22);
  g.lineTo(234, 218);
  g.lineTo(22, 218);
  g.closePath();
  g.fill();
  g.stroke();

  g.fillStyle = '#ffbe0b';
  g.beginPath();
  g.moveTo(128, 48);
  g.lineTo(208, 198);
  g.lineTo(48, 198);
  g.closePath();
  g.fill();

  g.fillStyle = '#b91c1c';
  g.beginPath();
  g.moveTo(128, 60);
  g.lineTo(196, 190);
  g.lineTo(60, 190);
  g.closePath();
  g.fill();

  g.fillStyle = '#ffffff';
  g.font = '700 108px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('!', 128, 145);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeRampChevronTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ff3b00';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ff5400';
  g.fillRect(16, 0, 224, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 24;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let y = 52; y <= 212; y += 72) {
    g.beginPath();
    g.moveTo(48, y + 34);
    g.lineTo(128, y - 18);
    g.lineTo(208, y + 34);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* =====================================================================
   VISUAL STREAMING — pool segmen tetap, didaur ulang tanpa alokasi baru
   ===================================================================== */
export function createTrackGenerator(scene, { maxAnisotropy = 8 } = {}) {
  const tuneTex = (tex) => {
    if (!tex) return tex;
    tex.anisotropy = maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };

  const roadTex = makeStylizedRoadTextures();
  tuneTex(roadTex.map);
  tuneTex(roadTex.normalMap);
  const matAsphalt = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.36,
    metalness: 0.08,
  });

  /* Material bahu jalan dengan transisi vertex color oranye/stone → rumput */
  const matShoulderBlend = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  const matDeckSide = new THREE.MeshStandardMaterial({ color: P.trackOrangeDark, roughness: 0.38, metalness: 0.08 });
  const matCurb = new THREE.MeshStandardMaterial({ color: P.trackOrange, roughness: 0.36, metalness: 0.08 });
  const matLine = new THREE.MeshStandardMaterial({ color: '#ffe599', roughness: 0.36, metalness: 0.04, emissive: '#ffbe0b', emissiveIntensity: 0.2 });
  const matConnectorBlue = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.36, metalness: 0.08,
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
    return tuneTex(tex);
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
    return tuneTex(tex);
  })();
  const matHazardStripe = new THREE.MeshStandardMaterial({
    map: hazardStripeTex, roughness: 0.36, metalness: 0.08, emissive: '#ffbe0b', emissiveIntensity: 0.16,
  });
  const rampChevronTex = tuneTex(makeRampChevronTex());
  const matRamp = new THREE.MeshStandardMaterial({
    color: '#ff3b00', map: rampChevronTex, roughness: 0.36, metalness: 0.08,
    emissive: '#ff3b00', emissiveMap: rampChevronTex, emissiveIntensity: 0.22,
  });
  const matRampStripe = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.24,
    emissive: '#ffe066', emissiveIntensity: 0.8,
  });
  const matFireRing = new THREE.MeshPhysicalMaterial({
    color: '#ffbe0b', roughness: 0.14, metalness: 0.65, clearcoat: 1.0,
    emissive: '#ff5400', emissiveIntensity: 0.88,
  });
  const matFireFlame = new THREE.MeshStandardMaterial({
    color: '#ff6b00', roughness: 0.3, emissive: '#ff9500', emissiveIntensity: 1.15,
  });
  const matConeOrange = new THREE.MeshStandardMaterial({ color: '#ff5400', roughness: 0.36, metalness: 0.06 });
  const matConeWhite = new THREE.MeshStandardMaterial({ color: '#fff8eb', roughness: 0.36, metalness: 0.06 });
  const matBarrelRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.36, metalness: 0.12 });
  const matBarrelGrey = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.36, metalness: 0.24 });
  const matBarrelYellow = new THREE.MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.36, metalness: 0.12 });
  const matSkullSign = new THREE.MeshStandardMaterial({
    map: skullSignTex, roughness: 0.38, emissive: '#ffffff', emissiveMap: skullSignTex, emissiveIntensity: 0.22,
  });
  const warnTriangleTex = tuneTex(makeWarnTriangleTex());
  const matWarnSign = new THREE.MeshStandardMaterial({
    map: warnTriangleTex, transparent: true, alphaTest: 0.15, side: THREE.DoubleSide,
    roughness: 0.34, emissive: '#ff2a4b', emissiveMap: warnTriangleTex, emissiveIntensity: 0.5,
  });
  const matBeaconRed = new THREE.MeshStandardMaterial({ color: '#ff2a4b', emissive: '#ff0033', emissiveIntensity: 1.45, roughness: 0.2 });
  const matBeaconBlue = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0077ff', emissiveIntensity: 1.45, roughness: 0.2 });
  const matBoost = new THREE.MeshStandardMaterial({
    color: '#ffbe0b', roughness: 0.36, metalness: 0.08,
    emissive: '#ff9500', emissiveIntensity: 0.68,
  });
  const matChevron = new THREE.MeshStandardMaterial({
    color: '#fff3b0', roughness: 0.28,
    emissive: '#ffd100', emissiveIntensity: 0.85,
  });
  const matBoosterWheel = new THREE.MeshStandardMaterial({
    color: '#ffd100', roughness: 0.36, metalness: 0.08,
    emissive: '#ffaa00', emissiveIntensity: 0.24,
  });
  const matBoosterHub = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.36, metalness: 0.08,
  });
  const matPillar = new THREE.MeshStandardMaterial({ color: '#c8c0b4', roughness: 0.65, metalness: 0.08 });
  const matPillarGlow = new THREE.MeshStandardMaterial({
    color: '#38bdf8', roughness: 0.26, metalness: 0.24,
    emissive: '#00b4d8', emissiveIntensity: 1.25,
  });
  const matSideStreet = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.85, metalness: 0.02 });
  const matSideWalk = new THREE.MeshStandardMaterial({ color: '#d8d0c4', roughness: 0.78 });
  const matStreetLine = new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.65 });
  const matRailColors = [
    new THREE.MeshStandardMaterial({ color: P.trackOrange, roughness: 0.36, metalness: 0.08 }),
    new THREE.MeshStandardMaterial({ color: '#ff7b1a', roughness: 0.36, metalness: 0.08 }),
  ];
  const matRailGlow = new THREE.MeshStandardMaterial({
    color: '#ffbe0b', roughness: 0.36, metalness: 0.08,
    emissive: '#ff8800', emissiveIntensity: 0.58,
  });
  const loopArrowTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0, 180, 255, 0.25)';
    g.beginPath(); g.roundRect(14, 14, 228, 228, 28); g.fill();
    g.strokeStyle = '#38bdf8'; g.lineWidth = 10; g.stroke();
    g.fillStyle = '#ffbe0b';
    g.beginPath();
    g.moveTo(128, 34); g.lineTo(206, 118); g.lineTo(160, 118);
    g.lineTo(160, 214); g.lineTo(96, 214); g.lineTo(96, 118); g.lineTo(50, 118);
    g.closePath(); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tuneTex(tex);
  })();
  const matLoopArrow = new THREE.MeshBasicMaterial({
    map: loopArrowTex, transparent: true, opacity: 0.94, depthWrite: false,
  });
  const loopSignTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112;
    const g = c.getContext('2d');
    g.fillStyle = '#18181b';
    g.beginPath(); g.roundRect(4, 4, 504, 104, 18); g.fill();
    g.strokeStyle = '#38bdf8'; g.lineWidth = 6; g.stroke();
    g.font = '700 28px Fredoka, "Plus Jakarta Sans", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffbe0b'; g.fillText('⬅️ LOOP 360° + BONUS', 142, 56);
    g.fillStyle = '#6ee7b7'; g.fillText('JALUR AMAN ➡️', 392, 56);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return tuneTex(tex);
  })();
  const matLoopSign = new THREE.MeshStandardMaterial({
    map: loopSignTex, roughness: 0.4, emissive: '#ffffff', emissiveMap: loopSignTex, emissiveIntensity: 0.3,
  });

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

  const plantShadowTex = tuneTex(makePlantShadowTex());
  const matPlantShadow = new THREE.MeshBasicMaterial({
    map: plantShadowTex, transparent: true, depthWrite: false, opacity: 0.58,
  });

  const matLampPole = new THREE.MeshStandardMaterial({ color: P.tire, roughness: 0.52 });
  const matLampCollar = new THREE.MeshStandardMaterial({ color: P.toyRed, roughness: 0.42 });
  const matLampHead = new THREE.MeshStandardMaterial({ color: P.headlight, roughness: 0.3, emissive: P.headlight, emissiveIntensity: 1.5 });

  /* Material lantai diorama & blok ABC & gerbang */
  const floorTextures = [0, 1, 2].map((k) => tuneTex(makePlayroomTex(k)));
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
  const blockTextures = blockSpecs.map(([ch, bg, fg]) => tuneTex(makeBlockTex(ch, bg, fg)));
  const blockMats = blockTextures.map((tex) => new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.52, metalness: 0.04,
  }));

  const archBannerTex = tuneTex(makeArchBannerTex());
  const matArchBanner = new THREE.MeshStandardMaterial({
    map: archBannerTex, roughness: 0.45, emissive: '#ffffff', emissiveMap: archBannerTex, emissiveIntensity: 0.22,
  });
  const milestone500Tex = tuneTex(makeArchBannerTex('⚡ CHECKPOINT 500 METER ⚡', '#0077ff', '#ff6b00', '#ffbe0b', false));
  const milestone1000Tex = tuneTex(makeArchBannerTex('🔥 1000 METER • SISA 500M! 🔥', '#d90429', '#ff5400', '#ffe066', false));
  const finishBannerTex = tuneTex(makeArchBannerTex('🏁 FINISH LINE • 1500M 🏁', '#18181b', '#d90429', '#ffbe0b', true));
  const checkeredStripeTex = tuneTex(makeCheckeredStripeTex());
  const matCheckeredStripe = new THREE.MeshStandardMaterial({
    map: checkeredStripeTex, roughness: 0.36, metalness: 0.06,
  });
  const matArchBlue = new THREE.MeshStandardMaterial({ color: P.toyBlue, roughness: 0.36, metalness: 0.08 });
  const matArchGold = new THREE.MeshStandardMaterial({ color: P.coinGold, roughness: 0.24, metalness: 0.6 });
  const matFenceRed = new THREE.MeshStandardMaterial({ color: P.toyRed, roughness: 0.42 });
  const matFenceWhite = new THREE.MeshStandardMaterial({ color: P.warmWhite, roughness: 0.42 });

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
  const glowRingTex = tuneTex(makeGlowRingTex());
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
  const geoBoost = new RoundedBoxGeometry(BOOST_W, 0.14, BOOST_LEN, 3, 0.06);
  const geoChevron = new THREE.BoxGeometry(3.2, 0.06, 0.38);
  const geoBoosterHousing = new RoundedBoxGeometry(1.35, 1.32, BOOST_LEN + 1.1, 3, 0.2);
  const geoBoosterWheel = new THREE.CylinderGeometry(1.02, 1.02, 0.46, 16);
  geoBoosterWheel.rotateZ(Math.PI / 2);
  const geoBoosterHub = new THREE.CylinderGeometry(0.46, 0.46, 0.52, 8);
  geoBoosterHub.rotateZ(Math.PI / 2);
  const geoBoosterRing = new THREE.TorusGeometry(1.12, 0.08, 8, 22);
  geoBoosterRing.rotateY(Math.PI / 2);
  const geoConnectorBar = new RoundedBoxGeometry(W + 1.45, 0.36, 1.2, 2, 0.08);
  const geoConnectorEar = new RoundedBoxGeometry(0.58, 0.98, 1.5, 2, 0.1);
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
  const geoPillar = new THREE.CylinderGeometry(0.62, 0.82, 1, 12);
  const geoPillarCollar = new THREE.CylinderGeometry(0.86, 0.86, 0.42, 14);
  const geoPillarBase = new THREE.CylinderGeometry(1.15, 1.3, 0.5, 12);
  const geoGuardPost = new RoundedBoxGeometry(0.26, 1.02, 0.3, 2, 0.05);
  const geoGuardBeam = new RoundedBoxGeometry(0.32, 0.44, 4.18, 2, 0.08);
  const geoGuardUpperBeam = new RoundedBoxGeometry(0.24, 0.22, 4.18, 2, 0.06);

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

  const geoFloor = new THREE.PlaneGeometry(240, L);
  geoFloor.rotateX(-Math.PI / 2);
  const geoSideStreet = new THREE.PlaneGeometry(5.2, L);
  geoSideStreet.rotateX(-Math.PI / 2);
  const geoSideWalk = new THREE.BoxGeometry(1.3, 0.14, L);
  const geoStreetDash = new THREE.BoxGeometry(0.18, 0.02, 2.4);
  const geoBlock = new RoundedBoxGeometry(4.6, 4.6, 4.6, 3, 0.32);
  const geoFencePost = new RoundedBoxGeometry(0.24, 1.15, 0.24, 2, 0.04);
  const geoFenceRail = new THREE.BoxGeometry(0.12, 0.16, 4.0);
  const geoArchPillar = new RoundedBoxGeometry(1.35, 13.6, 1.35, 3, 0.16);
  const geoArchLightBar = new THREE.BoxGeometry(0.22, 9.6, 0.22);
  const geoArchBeam = new RoundedBoxGeometry(W + 4.4, 1.75, 1.45, 3, 0.22);
  const geoArchSign = new THREE.PlaneGeometry(W + 2.4, 2.5);
  const geoArchBulb = new THREE.SphereGeometry(0.26, 10, 8);
  const geoBunting = new THREE.ConeGeometry(0.32, 0.65, 3);
  const geoFinishStripe = new THREE.PlaneGeometry(W - 0.6, 3.2);
  geoFinishStripe.rotateX(-Math.PI / 2);
  const geoFinishFlagPole = new THREE.CylinderGeometry(0.11, 0.14, 3.4, 8);
  const geoFinishFlagCloth = new THREE.PlaneGeometry(2.6, 1.45);
  const geoWarnPost = new THREE.CylinderGeometry(0.08, 0.11, 2.2, 8);
  const geoWarnBoard = new THREE.PlaneGeometry(2.15, 2.15);
  const geoLoopArrow = new THREE.PlaneGeometry(4.4, 5.2);
  geoLoopArrow.rotateX(-Math.PI / 2);
  const geoLoopSignBoard = new THREE.PlaneGeometry(8.8, 1.5);

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

  function cacheBaseX(mesh) {
    const pos = mesh.geometry.attributes.position;
    const bx = new Float32Array(pos.count);
    const by = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      bx[v] = pos.getX(v);
      by[v] = pos.getY(v);
    }
    mesh.userData.baseX = bx;
    mesh.userData.baseY = by;
    return mesh;
  }

  function applyBeveledProfile(g, width) {
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const hw = width * 0.5;
    const bevelW = Math.min(0.38, hw * 0.14);
    const xs = [-hw, -hw + bevelW, 0, hw - bevelW, hw];
    const ys = [-0.14, 0, 0, 0, -0.14];
    for (let v = 0; v < pos.count; v++) {
      const col = v % 5;
      pos.setX(v, xs[col]);
      pos.setY(v, ys[col]);
      if (uv) uv.setX(v, (xs[col] + hw) / width);
    }
    pos.needsUpdate = true;
    if (uv) uv.needsUpdate = true;
    g.computeVertexNormals();
  }

  function makeRoadGeo(width, beveled = true) {
    const g = new THREE.PlaneGeometry(width, L, beveled ? 4 : 1, 14);
    g.rotateX(-Math.PI / 2);
    if (beveled) applyBeveledProfile(g, width);
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

  function makeBeveledRibbonGeo(steps) {
    const pos = new Float32Array((steps + 1) * 4 * 3);
    const uv = new Float32Array((steps + 1) * 4 * 2);
    const idx = [];
    for (let s = 0; s <= steps; s++) {
      const v = (s / steps) * 2;
      const baseUv = s * 8;
      uv[baseUv] = 0; uv[baseUv + 1] = v;
      uv[baseUv + 2] = 0.06; uv[baseUv + 3] = v;
      uv[baseUv + 4] = 0.94; uv[baseUv + 5] = v;
      uv[baseUv + 6] = 1; uv[baseUv + 7] = v;
    }
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < 3; k++) {
        const a = s * 4 + k, b = a + 1, c = a + 4, d = a + 5;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function makeGapRoadGeo(zStartLocal, zEndLocal, width = W, steps = 6) {
    const len = zStartLocal - zEndLocal;
    const g = new THREE.PlaneGeometry(width, len, 4, steps);
    g.rotateX(-Math.PI / 2);
    applyBeveledProfile(g, width);
    g.translate(0, 0, (zStartLocal + zEndLocal) * 0.5);
    return g;
  }

  const matForkLeft = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    color: '#ff9068',
    roughness: 0.36,
    metalness: 0.08,
  });
  const matLoopSurface = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.36,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const matGapCap = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.36, metalness: 0.08,
    emissive: '#0044aa', emissiveIntensity: 0.18,
  });
  const geoGapCap = new RoundedBoxGeometry(W * 0.5 + 0.35, 0.42, 0.52, 2, 0.08);
  const geoLoopStrut = new THREE.CylinderGeometry(0.32, 0.45, 1, 10);
  const geoForkSignPost = new THREE.CylinderGeometry(0.16, 0.2, 4.4, 8);
  const geoForkSignBoard = new THREE.PlaneGeometry(7.6, 1.4);
  const forkSignTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112;
    const g = c.getContext('2d');
    g.fillStyle = '#1b1b22';
    g.beginPath(); g.roundRect(4, 4, 504, 104, 18); g.fill();
    g.strokeStyle = '#ffbe0b'; g.lineWidth = 6; g.stroke();
    g.font = '700 28px Fredoka, "Plus Jakarta Sans", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ff6b8b'; g.fillText('⬆️ ATAS: BUAH & API', 140, 56);
    g.fillStyle = '#38bdf8'; g.fillText('⬇️ BAWAH: KOIN AMAN', 376, 56);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return tuneTex(tex);
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
      /* Piramida 3 tong abu-abu & strip kuning yang bisa ditabrak hancur */
      const stackCoords = [[-0.45, 0.46], [0.45, 0.46], [0, 1.34]];
      for (const [bx, by] of stackCoords) {
        const sub = new THREE.Group();
        const body = new THREE.Mesh(geoBarrelBody, matBarrelGrey);
        body.castShadow = true;
        const band1 = new THREE.Mesh(geoBarrelBand, matBarrelYellow);
        band1.position.y = -0.26;
        const band2 = new THREE.Mesh(geoBarrelBand, matBarrelYellow);
        band2.position.y = 0.26;
        sub.add(body, band1, band2);
        sub.scale.setScalar(0.74);
        sub.position.set(bx, by, 0);
        g.add(sub);
      }
    }
    return g;
  }

  function buildWarningSignMesh() {
    const g = new THREE.Group();
    const post = new THREE.Mesh(geoWarnPost, matLampPole);
    post.position.y = 1.1;
    post.castShadow = true;
    const board = new THREE.Mesh(geoWarnBoard, matWarnSign);
    board.position.y = 2.65;
    g.add(post, board);
    g.userData = { board };
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
      road: null, rampRoads: [], rampSafeRoad: null, rampCaps: [],
      shoulders: [], skirts: [], edges: [], dashes: [],
      guardPosts: [], guardBeams: [], guardUpperBeams: [], connector: null,
      narrowRoad: null, narrowGroup: null,
      forkGroup: null, forkLeftRoad: null, forkRightRoad: null,
      forkLeftRailL: null, forkLeftRailR: null, forkRightRailL: null, forkRightRailR: null,
      forkStruts: [], forkSign: null,
      loopGroup: null, loopDeck: null, loopRailL: null, loopRailR: null,
      loopBypassRoad: null, loopBypassRailL: null, loopBypassRailR: null,
      loopEntryArrow: null, loopSign: null, loopStruts: [],
      ramp: null, boost: null, boosterWheels: [], bridge: null, piers: [], pierCollars: [],
      floor: null, blocks: [], fences: [], arch: null,
      milestoneArch: null, milestoneMat: null, finishStripe: null, finishFlags: [],
      skyLoop: null, mascot0: null, mascot1: null,
      smashProps: [], hazard: null, warnSign: null,
      decor: [], grassInst: null, flowerInst: null,
      collectibles: [],
    };

    /* Lantai diorama kota Salatiga (di bawah jalan layang) + Jalan Raya Miniatur menerus */
    seg.floor = new THREE.Mesh(geoFloor, floorMats[0]);
    seg.floor.position.y = FLOOR_Y;
    seg.floor.receiveShadow = true;
    group.add(seg.floor);

    for (const side of [-1, 1]) {
      const street = new THREE.Mesh(geoSideStreet, matSideStreet);
      street.position.set(side * 19.0, FLOOR_Y + 0.03, 0);
      street.receiveShadow = true;
      group.add(street);

      const walkOuter = new THREE.Mesh(geoSideWalk, matSideWalk);
      walkOuter.position.set(side * 22.25, FLOOR_Y + 0.07, 0);
      walkOuter.receiveShadow = true;
      group.add(walkOuter);

      const walkInner = new THREE.Mesh(geoSideWalk, matSideWalk);
      walkInner.position.set(side * 15.85, FLOOR_Y + 0.07, 0);
      walkInner.receiveShadow = true;
      group.add(walkInner);

      for (let d = 0; d < 4; d++) {
        const dash = new THREE.Mesh(geoStreetDash, matStreetLine);
        dash.position.set(side * 19.0, FLOOR_Y + 0.045, -L / 2 + 3 + d * 6);
        group.add(dash);
      }
    }

    /* Balok kayu ABC pastel di taman pinggir luar */
    for (let b = 0; b < 4; b++) {
      const m = new THREE.Mesh(geoBlock, blockMats[b % blockMats.length]);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      seg.blocks.push(m);
    }

    /* Pagar pembatas median antara pilar jalan layang & jalan kota bawah */
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
      fg.position.set(side * 15.2, FLOOR_Y, 0);
      group.add(fg);
      seg.fences.push(fg);
    }

    /* Jalan plastik oranye + potongan chasm satu sisi & jalur aman di sebelahnya */
    seg.road = cacheBaseX(new THREE.Mesh(makeRoadGeo(W), matAsphalt));
    seg.road.receiveShadow = true;
    group.add(seg.road);

    const rampApproach = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(L / 2, RAMP_GAP_START, W, 8), matAsphalt));
    rampApproach.receiveShadow = true; rampApproach.visible = false;
    const rampExit = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(RAMP_GAP_END, -L / 2, W, 2), matAsphalt));
    rampExit.receiveShadow = true; rampExit.visible = false;
    const rampSafeRoad = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(RAMP_GAP_START, RAMP_GAP_END, RAMP_SAFE_W, 4), matAsphalt));
    rampSafeRoad.receiveShadow = true; rampSafeRoad.visible = false;
    group.add(rampApproach, rampExit, rampSafeRoad);
    seg.rampRoads.push({ mesh: rampApproach, z0: L / 2, z1: RAMP_GAP_START }, { mesh: rampExit, z0: RAMP_GAP_END, z1: -L / 2 });
    seg.rampSafeRoad = rampSafeRoad;
    for (const cz of [RAMP_GAP_START, RAMP_GAP_END]) {
      const cap = new THREE.Mesh(geoGapCap, matHazardStripe);
      cap.visible = false;
      group.add(cap);
      seg.rampCaps.push({ mesh: cap, lz: cz });
    }

    /* Narrowing Beam Bridge (half normal width, guardrails terbuka!) */
    const narrowGroup = new THREE.Group();
    const narrowRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matAsphalt);
    narrowRoad.receiveShadow = true;
    narrowGroup.add(narrowRoad);
    narrowGroup.visible = false;
    group.add(narrowGroup);
    seg.narrowGroup = narrowGroup;
    seg.narrowRoad = narrowRoad;

    /* Over-Under Split Fork Paths (Kiri Atas: bertingkat penuh buah & api | Kanan Bawah: koin aman) */
    const forkGroup = new THREE.Group();
    const forkLeftRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matForkLeft);
    forkLeftRoad.receiveShadow = true;
    const forkRightRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matAsphalt);
    forkRightRoad.receiveShadow = true;
    const forkLeftRailL = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matRailGlow);
    const forkLeftRailR = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matRailGlow);
    const forkRightRailL = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matRailGlow);
    const forkRightRailR = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matRailGlow);
    const forkSign = new THREE.Group();
    const fPost = new THREE.Mesh(geoForkSignPost, matConnectorBlue);
    fPost.position.set(0, 2.2, 0); fPost.castShadow = true;
    const fBoard = new THREE.Mesh(geoForkSignBoard, matForkSign);
    fBoard.position.set(0, 4.15, 0);
    forkSign.add(fPost, fBoard);
    forkGroup.add(
      forkLeftRoad, forkRightRoad,
      forkLeftRailL, forkLeftRailR, forkRightRailL, forkRightRailR,
      forkSign
    );
    for (const lz of [2.5, -2.5]) {
      const st = new THREE.Mesh(geoLoopStrut, matConnectorBlue);
      st.castShadow = true;
      forkGroup.add(st);
      seg.forkStruts.push({ mesh: st, lz });
    }
    forkGroup.visible = false;
    group.add(forkGroup);
    seg.forkGroup = forkGroup;
    seg.forkLeftRoad = forkLeftRoad;
    seg.forkRightRoad = forkRightRoad;
    seg.forkLeftRailL = forkLeftRailL;
    seg.forkLeftRailR = forkLeftRailR;
    seg.forkRightRailL = forkRightRailL;
    seg.forkRightRailR = forkRightRailR;
    seg.forkSign = forkSign;

    /* 360° Hot Wheels Dual-Choice Loop (Kiri: Loop 360° | Kanan: Jalur Aman Lurus) */
    const loopGroup = new THREE.Group();
    const loopDeck = new THREE.Mesh(makeBeveledRibbonGeo(LOOP_STEPS), matLoopSurface);
    loopDeck.receiveShadow = true;
    const loopRailL = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matCurb);
    const loopRailR = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matCurb);
    const loopBypassRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matAsphalt);
    loopBypassRoad.receiveShadow = true;
    const loopBypassRailL = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matRailGlow);
    const loopBypassRailR = new THREE.Mesh(makeRibbonGridGeo(RIBBON_STEPS), matRailGlow);
    const loopEntryArrow = new THREE.Mesh(geoLoopArrow, matLoopArrow);
    loopEntryArrow.renderOrder = 2;
    const loopSign = new THREE.Group();
    const lPostL = new THREE.Mesh(geoForkSignPost, matConnectorBlue);
    lPostL.position.set(-4.2, 2.2, 0); lPostL.castShadow = true;
    const lPostR = new THREE.Mesh(geoForkSignPost, matConnectorBlue);
    lPostR.position.set(4.2, 2.2, 0); lPostR.castShadow = true;
    const lBoard = new THREE.Mesh(geoLoopSignBoard, matLoopSign);
    lBoard.position.set(0, 4.4, 0);
    loopSign.add(lPostL, lPostR, lBoard);
    loopGroup.add(
      loopDeck, loopRailL, loopRailR,
      loopBypassRoad, loopBypassRailL, loopBypassRailR,
      loopEntryArrow, loopSign
    );
    for (const [sx, sz] of [[LOOP_CENTER_X - LOOP_HALF_W - 0.55, -2.5], [LOOP_CENTER_X + LOOP_HALF_W + 0.55, 2.5]]) {
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
    seg.loopBypassRoad = loopBypassRoad;
    seg.loopBypassRailL = loopBypassRailL;
    seg.loopBypassRailR = loopBypassRailR;
    seg.loopEntryArrow = loopEntryArrow;
    seg.loopSign = loopSign;

    for (const side of [-1, 1]) {
      const shGeo = makeShoulderBlendGeo(side);
      shGeo.translate(side * (W / 2 + 1.3), 0, 0);
      const sh = cacheBaseX(new THREE.Mesh(shGeo, matShoulderBlend));
      sh.receiveShadow = true;
      group.add(sh);
      seg.shoulders.push({ mesh: sh, side });
    }

    for (const sx of [-W / 2, W / 2]) {
      const skGeo = makeSkirtGeo();
      skGeo.translate(sx, 0, 0);
      const sk = cacheBaseX(new THREE.Mesh(skGeo, matDeckSide));
      sk.receiveShadow = true;
      group.add(sk);
      seg.skirts.push(sk);
    }

    for (const ex of [-W / 2 + 0.3, W / 2 - 0.3]) {
      const eGeo = makeRoadGeo(0.28, false);
      eGeo.translate(ex, 0, 0);
      const e = cacheBaseX(new THREE.Mesh(eGeo, matLine));
      e.receiveShadow = true;
      group.add(e); seg.edges.push(e);
    }
    for (let d = 0; d < 6; d++) {
      const m = new THREE.Mesh(geoDash, matLine);
      group.add(m); seg.dashes.push(m);
    }

    /* Guardrail sisi oranye lapis ganda bercahaya + Klip Konektor Biru (#0077FF) */
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

        const upperBeam = new THREE.Mesh(geoGuardUpperBeam, matRailGlow);
        upperBeam.castShadow = false;
        group.add(upperBeam);
        seg.guardUpperBeams.push({ mesh: upperBeam, side, k });
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

    /* Pilar penopang jalan layang bercahaya ke lantai kota */
    for (const px of [-W / 2 + 1.8, W / 2 - 1.8]) {
      const p = new THREE.Mesh(geoPillar, matPillar);
      p.castShadow = true;
      group.add(p);
      seg.piers.push({ mesh: p, x: px });

      const collar = new THREE.Mesh(geoPillarCollar, matPillarGlow);
      group.add(collar);
      const base = new THREE.Mesh(geoPillarBase, matConnectorBlue);
      group.add(base);
      seg.pierCollars.push({ collar, base, x: px });
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

    /* Boost Pad + Turbin Booster Raksasa Bercahaya di kedua sisi */
    const boost = new THREE.Group();
    const pad = new THREE.Mesh(geoBoost, matBoost);
    pad.receiveShadow = true;
    boost.add(pad);
    for (let c = 0; c < 3; c++) {
      const ch = new THREE.Mesh(geoChevron, matChevron);
      ch.position.set(0, 0.09, -1.0 + c * 1.0);
      ch.rotation.y = c % 2 ? 0.35 : -0.35;
      boost.add(ch);
    }
    for (const side of [-1, 1]) {
      const hx = side * (BOOST_W / 2 + 0.85);
      const housing = new THREE.Mesh(geoBoosterHousing, matConnectorBlue);
      housing.position.set(hx, 0.64, 0);
      housing.castShadow = true;
      boost.add(housing);

      for (const wz of [-1.05, 1.05]) {
        const ringGlow = new THREE.Mesh(geoBoosterRing, matPillarGlow);
        ringGlow.position.set(side * (BOOST_W / 2 + 0.28), 0.68, wz);
        boost.add(ringGlow);

        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(side * (BOOST_W / 2 + 0.32), 0.68, wz);
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

    /* Jembatan layang dengan cincin pylon bercahaya */
    const bridge = new THREE.Group();
    seg.pillars = [];
    for (const px of [-W / 2 + 1.4, W / 2 - 1.4]) for (const pz of [-L * 0.22, L * 0.22]) {
      const p = new THREE.Mesh(geoPillar, matPillar);
      p.castShadow = true; p.position.set(px, 0, pz);
      const collar = new THREE.Mesh(geoPillarCollar, matPillarGlow);
      collar.position.set(px, FLOOR_Y + 3.2, pz);
      bridge.add(p, collar);
      seg.pillars.push({ mesh: p, collar, px, pz });
    }
    bridge.visible = false;
    group.add(bridge); seg.bridge = bridge;

    /* Gerbang Emas Megah Jalan Layang (setiap archEvery segmen) */
    const arch = new THREE.Group();
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(geoArchPillar, matArchBlue);
      col.position.set(sx * (W / 2 + 1.4), 3.4, 0);
      col.castShadow = true;
      arch.add(col);
      const lightStrip = new THREE.Mesh(geoArchLightBar, matPillarGlow);
      lightStrip.position.set(sx * (W / 2 + 0.66), 4.2, 0);
      arch.add(lightStrip);
      const cap = new THREE.Mesh(geoArchBulb, matArchGold);
      cap.position.set(sx * (W / 2 + 1.4), 10.6, 0);
      cap.scale.setScalar(2.8);
      arch.add(cap);
    }
    const beam = new THREE.Mesh(geoArchBeam, matArchGold);
    beam.position.set(0, 8.2, 0);
    beam.castShadow = true;
    arch.add(beam);
    const signFront = new THREE.Mesh(geoArchSign, matArchBanner);
    signFront.position.set(0, 8.2, 0.76);
    arch.add(signFront);
    const signBack = new THREE.Mesh(geoArchSign, matArchBanner);
    signBack.position.set(0, 8.2, -0.76);
    signBack.rotation.y = Math.PI;
    arch.add(signBack);
    for (let b = 0; b < 9; b++) {
      const bx = -W / 2 + 0.8 + b * ((W - 1.6) / 8);
      const bulb = new THREE.Mesh(geoArchBulb, matLampHead);
      bulb.position.set(bx, 9.25, 0);
      arch.add(bulb);
      const flag = new THREE.Mesh(geoBunting, matRailColors[b % matRailColors.length]);
      flag.position.set(bx, 7.05, 0);
      flag.rotation.x = Math.PI;
      arch.add(flag);
    }
    arch.visible = false;
    group.add(arch);
    seg.arch = arch;

    /* Gerbang Milestone (500m / 1000m) & Gerbang FINISH 1500m Berkotak-kotak */
    const mArch = new THREE.Group();
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(geoArchPillar, matArchBlue);
      col.position.set(sx * (W / 2 + 1.4), 3.4, 0);
      col.castShadow = true;
      mArch.add(col);
      const cap = new THREE.Mesh(geoArchBulb, matArchGold);
      cap.position.set(sx * (W / 2 + 1.4), 10.5, 0);
      cap.scale.setScalar(2.6);
      mArch.add(cap);

      const fPole = new THREE.Mesh(geoFinishFlagPole, matLampPole);
      fPole.position.set(sx * (W / 2 + 1.4), 12.1, 0);
      const fCloth = new THREE.Mesh(geoFinishFlagCloth, matCheckeredStripe);
      fCloth.position.set(sx * (W / 2 + 1.4) + (sx < 0 ? 1.2 : -1.2), 13.0, 0);
      mArch.add(fPole, fCloth);
      seg.finishFlags.push(fPole, fCloth);
    }
    const mBeam = new THREE.Mesh(geoArchBeam, matArchGold);
    mBeam.position.set(0, 8.2, 0);
    mBeam.castShadow = true;
    mArch.add(mBeam);
    const milestoneMat = new THREE.MeshStandardMaterial({
      map: finishBannerTex, roughness: 0.4, emissive: '#ffffff', emissiveMap: finishBannerTex, emissiveIntensity: 0.28,
    });
    const mSignFront = new THREE.Mesh(geoArchSign, milestoneMat);
    mSignFront.position.set(0, 8.2, 0.76);
    const mSignBack = new THREE.Mesh(geoArchSign, milestoneMat);
    mSignBack.position.set(0, 8.2, -0.76);
    mSignBack.rotation.y = Math.PI;
    const finishStripe = new THREE.Mesh(geoFinishStripe, matCheckeredStripe);
    finishStripe.position.set(0, 0.04, 0);
    finishStripe.receiveShadow = true;
    mArch.add(mSignFront, mSignBack, finishStripe);
    mArch.visible = false;
    group.add(mArch);
    seg.milestoneArch = mArch;
    seg.milestoneMat = milestoneMat;
    seg.finishStripe = finishStripe;

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

    /* Smashable cones & 3-barrel grey/yellow pyramid stacks (2 tumpuk tong + 2 kerucut per segmen) */
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

    /* Penghalang bahaya tengkorak merah/biru + Papan Segitiga Merah "!" Mengambang */
    const hazMesh = buildSkullHazardMesh();
    hazMesh.visible = false;
    group.add(hazMesh);
    seg.hazard = {
      mesh: hazMesh, lx: 0, lz: 0, baseY: 0,
      active: false, hit: false, vx: 0, vy: 0, vz: 0, rvx: 0, rvz: 0,
    };

    const warnMesh = buildWarningSignMesh();
    warnMesh.visible = false;
    group.add(warnMesh);
    seg.warnSign = { mesh: warnMesh, active: false, baseY: 0, lz: 0, lx: 0, phase: 0 };

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

  function displace(mesh, centerZ, yOffset = 0, xShift = 0) {
    const pos = mesh.geometry.attributes.position;
    const bx = mesh.userData.baseX;
    const by = mesh.userData.baseY;
    for (let v = 0; v < pos.count; v++) {
      const wz = centerZ + pos.getZ(v);
      const lx = (bx ? bx[v] : pos.getX(v)) + xShift;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      pos.setX(v, cx + lx);
      pos.setY(v, getTrackHeight(wz) + lx * bank + yOffset + (by ? by[v] : 0));
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceShoulder(mesh, side, centerZ) {
    const pos = mesh.geometry.attributes.position;
    const bx = mesh.userData.baseX;
    const shoulderW = 2.6;
    const baseEdge = side * (W / 2 + 1.3);
    for (let v = 0; v < pos.count; v++) {
      const lxWorld = bx ? bx[v] : pos.getX(v);
      const lxRel = lxWorld - baseEdge;
      const t = side < 0 ? (shoulderW * 0.5 - lxRel) / shoulderW : (lxRel + shoulderW * 0.5) / shoulderW;
      const drop = t * 0.22;
      const wz = centerZ + pos.getZ(v);
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      pos.setX(v, cx + lxWorld);
      pos.setY(v, getTrackHeight(wz) + lxWorld * bank - 0.01 - drop);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceSkirt(mesh, centerZ) {
    const pos = mesh.geometry.attributes.position;
    const bx = mesh.userData.baseX;
    for (let v = 0; v < pos.count; v++) {
      const wz = centerZ + pos.getZ(v);
      const lx = bx ? bx[v] : pos.getX(v);
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const h = getTrackHeight(wz) + lx * bank;
      const isTop = v < pos.count / 2;
      pos.setX(v, cx + lx);
      pos.setY(v, isTop ? h + 0.01 : h - 1.25);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceRibbon(mesh, steps, evalFn) {
    const pos = mesh.geometry.attributes.position;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const { lx, rx, y, yL, yR, z } = evalFn(t);
      const i0 = s * 2, i1 = i0 + 1;
      pos.setXYZ(i0, lx, yL !== undefined ? yL : y, z);
      pos.setXYZ(i1, rx, yR !== undefined ? yR : y, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceBeveledRibbon(mesh, steps, evalFn) {
    const pos = mesh.geometry.attributes.position;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const { lx, rx, y, yL, yR, z } = evalFn(t);
      const yL0 = yL !== undefined ? yL : y;
      const yR0 = yR !== undefined ? yR : y;
      const span = Math.max(0.5, rx - lx);
      const bevel = Math.min(0.36, span * 0.07);
      const b = s * 4;
      pos.setXYZ(b, lx, yL0 - 0.13, z);
      pos.setXYZ(b + 1, lx + bevel, yL0, z);
      pos.setXYZ(b + 2, rx - bevel, yR0, z);
      pos.setXYZ(b + 3, rx, yR0 - 0.13, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  const _tmpLPos = new THREE.Vector3();
  const _tmpLInner = new THREE.Vector3();
  const _tmpRInner = new THREE.Vector3();
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
      evalLoopPose(centerZ + z0, centerZ + z1, y0, y1, u, -LOOP_HALF_W, _tmpLPos, null, _lpRight);
      evalLoopPose(centerZ + z0, centerZ + z1, y0, y1, u, -LOOP_HALF_W + 0.34, _tmpLInner, null, _lpRight);
      evalLoopPose(centerZ + z0, centerZ + z1, y0, y1, u, LOOP_HALF_W - 0.34, _tmpRInner, null, _lpRight);
      evalLoopPose(centerZ + z0, centerZ + z1, y0, y1, u, LOOP_HALF_W, _tmpRPos, null, _lpRight);
      const b = s * 4;
      pos.setXYZ(b, _tmpLPos.x - _lpUp.x * 0.12, _tmpLPos.y - _lpUp.y * 0.12, _tmpLPos.z - centerZ - _lpUp.z * 0.12);
      pos.setXYZ(b + 1, _tmpLInner.x, _tmpLInner.y, _tmpLInner.z - centerZ);
      pos.setXYZ(b + 2, _tmpRInner.x, _tmpRInner.y, _tmpRInner.z - centerZ);
      pos.setXYZ(b + 3, _tmpRPos.x - _lpUp.x * 0.12, _tmpRPos.y - _lpUp.y * 0.12, _tmpRPos.z - centerZ - _lpUp.z * 0.12);

      const i0 = s * 2, i1 = i0 + 1;
      evalLoopPose(centerZ + z0, centerZ + z1, y0, y1, u, -LOOP_HALF_W - 0.15, _tmpLPos, null, _lpRight);
      posRL.setXYZ(i0, _tmpLPos.x, _tmpLPos.y, _tmpLPos.z - centerZ);
      posRL.setXYZ(i1, _tmpLPos.x + _lpUp.x * 0.68, _tmpLPos.y + _lpUp.y * 0.68, _tmpLPos.z - centerZ + _lpUp.z * 0.68);

      evalLoopPose(centerZ + z0, centerZ + z1, y0, y1, u, LOOP_HALF_W + 0.15, _tmpRPos, null, _lpRight);
      posRR.setXYZ(i0, _tmpRPos.x, _tmpRPos.y, _tmpRPos.z - centerZ);
      posRR.setXYZ(i1, _tmpRPos.x + _lpUp.x * 0.68, _tmpRPos.y + _lpUp.y * 0.68, _tmpRPos.z - centerZ + _lpUp.z * 0.68);
    }
    pos.needsUpdate = true; seg.loopDeck.geometry.computeVertexNormals();
    posRL.needsUpdate = true; seg.loopRailL.geometry.computeVertexNormals();
    posRR.needsUpdate = true; seg.loopRailR.geometry.computeVertexNormals();

    /* Jalur Bypass Lurus Aman di sisi kanan (BYPASS_CENTER_X) */
    displaceBeveledRibbon(seg.loopBypassRoad, RIBBON_STEPS, (t) => {
      const lz = L / 2 - t * L;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const h = getTrackHeight(wz);
      const lx = BYPASS_CENTER_X - BYPASS_HALF_W;
      const rx = BYPASS_CENTER_X + BYPASS_HALF_W;
      return { lx: cx + lx, rx: cx + rx, yL: h + lx * bank, yR: h + rx * bank, z: lz };
    });
    displaceRibbon(seg.loopBypassRailL, RIBBON_STEPS, (t) => {
      const lz = L / 2 - t * L;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const y = getTrackHeight(wz) + (BYPASS_CENTER_X - BYPASS_HALF_W) * bank;
      return { lx: cx + BYPASS_CENTER_X - BYPASS_HALF_W - 0.14, rx: cx + BYPASS_CENTER_X - BYPASS_HALF_W + 0.12, y: y + 0.42, z: lz };
    });
    displaceRibbon(seg.loopBypassRailR, RIBBON_STEPS, (t) => {
      const lz = L / 2 - t * L;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const y = getTrackHeight(wz) + (BYPASS_CENTER_X + BYPASS_HALF_W) * bank;
      return { lx: cx + BYPASS_CENTER_X + BYPASS_HALF_W - 0.12, rx: cx + BYPASS_CENTER_X + BYPASS_HALF_W + 0.14, y: y + 0.42, z: lz };
    });

    const entryZ = L / 2 - 2.6;
    const entryCx = getTrackCenterX(centerZ + entryZ);
    seg.loopEntryArrow.position.set(entryCx + LOOP_CENTER_X, getTrackHeight(centerZ + entryZ) + 0.14, entryZ);
    seg.loopEntryArrow.rotation.x = -Math.PI / 2 - Math.atan(-getTrackSlope(centerZ + entryZ));
    seg.loopEntryArrow.rotation.z = getTrackYaw(centerZ + entryZ);
    const signWz = centerZ + L * 0.44;
    seg.loopSign.position.set(getTrackCenterX(signWz), getTrackHeight(signWz), L * 0.44);
    seg.loopSign.rotation.y = getTrackYaw(signWz);

    const midY = (y0 + y1) * 0.5 + LOOP_RADIUS * 1.4;
    const h = Math.max(4, midY - FLOOR_Y);
    for (const st of seg.loopStruts) {
      st.mesh.scale.y = h;
      st.mesh.position.set(getTrackCenterX(centerZ + st.z) + st.x, FLOOR_Y + h * 0.5, st.z);
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
    const placeItem = (kind, localOffsetX, lz, yOff, absY = null, absX = null) => {
      if (cursor >= MAX_COLLECTIBLES) return;
      const slot = seg.collectibles[cursor++];
      slot.kind = kind;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const wx = absX !== null ? absX : (cx + localOffsetX);
      slot.lx = wx;
      slot.lz = lz;
      const trackY = absY !== null ? absY : (getTrackHeight(wz) + localOffsetX * bank);
      slot.baseY = absY !== null ? absY : (trackY + yOff);
      slot.phase = (i * 0.9 + cursor * 0.65);
      slot.active = true;
      slot.collected = false;
      slot.coinMesh.visible = kind === 'coin';
      slot.gemMesh.visible = kind === 'gem';
      slot.fruitMesh.visible = kind === 'fruit';
      slot.fireRingMesh.visible = kind === 'ring';
      slot.obj.position.set(wx, slot.baseY, lz);
      slot.obj.rotation.y = getTrackYaw(wz);
      slot.obj.visible = true;

      if (absY === null && (kind === 'fruit' || kind === 'gem')) {
        slot.groundRing.material = ringMats[kind === 'gem' ? 'gem' : slot.fruitType];
        slot.groundRing.position.set(wx, trackY + 0.06, lz);
        slot.groundRing.rotation.set(-Math.PI / 2 - getTrackSlope(wz), 0, 0);
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
      const z0 = centerZ + L / 2, z1 = centerZ - L / 2;
      const y0 = getTrackHeight(z0);
      const y1 = getTrackHeight(z1);
      const lp = new THREE.Vector3();
      const loopUs = [0.18, 0.34, 0.5, 0.66, 0.82];
      loopUs.forEach((u, idx) => {
        evalLoopPose(z0, z1, y0, y1, u, 0, lp, null, _lpRight);
        const kind = idx === 2 ? 'ring' : idx === 1 || idx === 3 ? 'gem' : 'fruit';
        placeItem(kind, 0, lp.z - centerZ, 0, lp.y + (u > 0.25 && u < 0.75 ? -1.1 : 1.1), lp.x);
      });
      for (let k = 0; k < 5; k++) {
        placeItem('coin', BYPASS_CENTER_X, 8.0 - k * 4.0, 0.95);
      }
      return;
    }

    if (seg.type === 'fork') {
      const ts = [0.22, 0.38, 0.54, 0.70, 0.82];
      ts.forEach((t, idx) => {
        const fp = getForkProfile(t);
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const kindL = idx === 2 ? 'ring' : idx === 3 ? 'gem' : 'fruit';
        const baseY = getTrackHeight(wz);
        placeItem(kindL, fp.cxL, lz, 0, baseY + fp.yOffL + (kindL === 'ring' ? 1.85 : 1.25));
        placeItem('coin', fp.cxR, lz, 0, baseY + 0.95);
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
      const rx = getRampSide(i) * RAMP_OFFSET;
      const sx = -rx;
      placeItem('coin', rx, 5.5, 0.95);
      placeItem('coin', rx, 2.2, 1.2);
      const arcSteps = [-0.8, -3.2, -5.6, -8.0, -10.4];
      arcSteps.forEach((lz, idx) => {
        const u = (idx + 1) / arcSteps.length;
        const yOff = 1.65 + Math.sin(u * Math.PI * 0.58) * 3.2;
        const kind = idx === 2 ? 'ring' : idx === 3 ? 'gem' : 'coin';
        placeItem(kind, rx, lz, yOff);
      });
      placeItem('coin', sx, -4.5, 0.95);
      placeItem('coin', sx, -8.5, 0.95);
      return;
    }

    if (prevType === 'ramp') {
      const rx = getRampSide(i - 1) * RAMP_OFFSET;
      const descSteps = [10.4, 8.0, 5.6, 3.2, 0.8];
      descSteps.forEach((lz, idx) => {
        const u = idx / (descSteps.length - 1);
        const yOff = 4.4 - u * 3.35;
        placeItem(idx === 4 ? 'fruit' : 'coin', rx, lz, yOff);
      });
      placeItem('coin', -rx * 0.6, -4.5, 0.95);
      placeItem('coin', -rx * 0.9, -8.5, 0.95);
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
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const lx = onShoulder
        ? cx + side * (W / 2 + 0.9 + hash(i * 71 + k) * 1.65)
        : side * (13.6 + hash(i * 79 + k) * 1.8);
      const ly = onShoulder ? getTrackHeight(wz) + (lx - cx) * getTrackBank(wz) - 0.14 : FLOOR_Y;
      _dummy.position.set(lx, ly, lz);
      _dummy.rotation.set(0, hash(i * 43 + k) * Math.PI * 2, 0);
      _dummy.scale.setScalar(onShoulder ? (0.8 + hash(i * 83 + k) * 0.55) : (1.1 + hash(i * 89 + k) * 0.65));
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
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const lx = onShoulder
        ? cx + side * (W / 2 + 1.05 + hash(i * 101 + k) * 1.45)
        : side * (13.8 + hash(i * 103 + k) * 1.6);
      const ly = onShoulder ? getTrackHeight(wz) + (lx - cx) * getTrackBank(wz) - 0.14 : FLOOR_Y;
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
    const midCx = getTrackCenterX(centerZ);
    const midYaw = getTrackYaw(centerZ);
    const midBank = getTrackBank(centerZ);

    const floorKind = Math.abs(Math.floor(i / 4)) % floorMats.length;
    seg.floor.material = floorMats[floorKind];

    seg.blocks.forEach((m, b) => {
      const side = b % 2 === 0 ? -1 : 1;
      const bx = side * (39 + hash(i * 31 + b) * 16);
      const bz = -L * 0.35 + (b % 2) * L * 0.55 + (hash(i * 41 + b) - 0.5) * 6;
      const sc = 0.8 + hash(i * 53 + b) * 0.5;
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
    const rampSide = getRampSide(i);
    for (const rr of seg.rampRoads) {
      rr.mesh.visible = showRampDeck;
      if (showRampDeck) displace(rr.mesh, centerZ);
    }
    seg.rampSafeRoad.visible = showRampDeck;
    if (showRampDeck) {
      displace(seg.rampSafeRoad, centerZ, 0, -rampSide * RAMP_OFFSET);
    }
    for (const rc of seg.rampCaps) {
      rc.mesh.visible = showRampDeck;
      if (showRampDeck) {
        const wz = centerZ + rc.lz;
        const gapCx = rampSide * RAMP_OFFSET;
        rc.mesh.position.set(getTrackCenterX(wz) + gapCx, getTrackHeight(wz) + gapCx * getTrackBank(wz) - 0.16, rc.lz);
        rc.mesh.rotation.order = 'YXZ';
        rc.mesh.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
      }
    }

    seg.narrowGroup.visible = seg.type === 'narrow';
    if (seg.narrowGroup.visible) {
      displaceBeveledRibbon(seg.narrowRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const bank = getTrackBank(wz);
        const h = getTrackHeight(wz);
        const hw = getNarrowHalfWidth(t);
        return { lx: cx - hw, rx: cx + hw, yL: h - hw * bank, yR: h + hw * bank, z: lz };
      });
    }

    seg.forkGroup.visible = seg.type === 'fork';
    if (seg.forkGroup.visible) {
      displaceBeveledRibbon(seg.forkLeftRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        return { lx: cx + fp.cxL - fp.hwL, rx: cx + fp.cxL + fp.hwL, y: getTrackHeight(wz) + fp.yOffL, z: lz };
      });
      displaceBeveledRibbon(seg.forkRightRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        return { lx: cx + fp.cxR - fp.hwR, rx: cx + fp.cxR + fp.hwR, y: getTrackHeight(wz) + fp.yOffR, z: lz };
      });
      displaceRibbon(seg.forkLeftRailL, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffL + 0.42;
        return { lx: cx + fp.cxL - fp.hwL - 0.14, rx: cx + fp.cxL - fp.hwL + 0.12, y, z: lz };
      });
      displaceRibbon(seg.forkLeftRailR, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffL + 0.42;
        return { lx: cx + fp.cxL + fp.hwL - 0.12, rx: cx + fp.cxL + fp.hwL + 0.14, y, z: lz };
      });
      displaceRibbon(seg.forkRightRailL, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffR + 0.42;
        return { lx: cx + fp.cxR - fp.hwR - 0.14, rx: cx + fp.cxR - fp.hwR + 0.12, y, z: lz };
      });
      displaceRibbon(seg.forkRightRailR, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffR + 0.42;
        return { lx: cx + fp.cxR + fp.hwR - 0.12, rx: cx + fp.cxR + fp.hwR + 0.14, y, z: lz };
      });
      for (const st of seg.forkStruts) {
        const wz = centerZ + st.lz;
        const ft = Math.min(1, Math.max(0, (L / 2 - st.lz) / L));
        const fp = getForkProfile(ft);
        const topY = getTrackHeight(wz) + fp.yOffL - 0.12;
        const sh = Math.max(2, topY - FLOOR_Y);
        st.mesh.scale.y = sh;
        st.mesh.position.set(getTrackCenterX(wz) + fp.cxL, FLOOR_Y + sh * 0.5, st.lz);
      }
      const signWz = centerZ + L * 0.34;
      seg.forkSign.position.set(getTrackCenterX(signWz), getTrackHeight(signWz), L * 0.34);
      seg.forkSign.rotation.y = getTrackYaw(signWz);
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
        const wz = centerZ + lz;
        d.position.set(getTrackCenterX(wz), getTrackHeight(wz) + 0.03, lz);
        d.rotation.order = 'YXZ';
        d.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
      }
    });

    const showGuards = isPlainDeck || showRampDeck;
    for (const gp of seg.guardPosts) {
      const lz = -L / 2 + 2 + gp.k * 4;
      const inGapHere = showRampDeck && gp.side === rampSide && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5;
      gp.mesh.visible = showGuards && !inGapHere;
      if (gp.mesh.visible) {
        const wz = centerZ + lz;
        const lx = gp.side * (W / 2 + 0.32);
        const y = getTrackHeight(wz) + lx * getTrackBank(wz);
        gp.mesh.position.set(getTrackCenterX(wz) + lx, y + 0.44, lz);
        gp.mesh.rotation.y = getTrackYaw(wz);
      }
    }
    for (const gb of seg.guardBeams) {
      const lz = -L / 2 + 2 + gb.k * 4;
      const inGapHere = showRampDeck && gb.side === rampSide && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5;
      gb.mesh.visible = showGuards && !inGapHere;
      if (gb.mesh.visible) {
        const wz = centerZ + lz;
        const lx = gb.side * (W / 2 + 0.14);
        const y = getTrackHeight(wz) + lx * getTrackBank(wz);
        gb.mesh.position.set(getTrackCenterX(wz) + lx, y + 0.28, lz);
        gb.mesh.rotation.order = 'YXZ';
        gb.mesh.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
      }
    }
    for (const ub of seg.guardUpperBeams) {
      const lz = -L / 2 + 2 + ub.k * 4;
      const inGapHere = showRampDeck && ub.side === rampSide && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5;
      ub.mesh.visible = showGuards && !inGapHere;
      if (ub.mesh.visible) {
        const wz = centerZ + lz;
        const lx = ub.side * (W / 2 + 0.16);
        const y = getTrackHeight(wz) + lx * getTrackBank(wz);
        ub.mesh.position.set(getTrackCenterX(wz) + lx, y + 0.72, lz);
        ub.mesh.rotation.order = 'YXZ';
        ub.mesh.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
      }
    }
    if (seg.connector) {
      const seamZ = L / 2;
      const wz = centerZ + seamZ;
      seg.connector.position.set(getTrackCenterX(wz), getTrackHeight(wz), seamZ);
      seg.connector.rotation.order = 'YXZ';
      seg.connector.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
    }

    const roadMidY = getTrackHeight(centerZ);
    const pierH = Math.max(2, roadMidY - FLOOR_Y);
    const showPiers = seg.type !== 'loop' && seg.type !== 'fork';
    for (let pi = 0; pi < seg.piers.length; pi++) {
      const p = seg.piers[pi];
      const pc = seg.pierCollars[pi];
      p.mesh.visible = showPiers;
      pc.collar.visible = showPiers;
      pc.base.visible = showPiers;
      if (showPiers) {
        const px = midCx + (seg.type === 'narrow' ? p.x * 0.32 : p.x);
        p.mesh.scale.y = pierH;
        p.mesh.position.set(px, FLOOR_Y + pierH / 2, 0);
        pc.collar.position.set(px, FLOOR_Y + Math.min(pierH - 0.5, 2.2), 0);
        pc.base.position.set(px, FLOOR_Y + 0.24, 0);
      }
    }

    seg.ramp.visible = showRampDeck;
    if (seg.ramp.visible) {
      const rx = rampSide * RAMP_OFFSET;
      seg.ramp.position.set(midCx + rx, roadMidY + rx * midBank + RAMP_RISE * 0.5, 0);
      seg.ramp.rotation.order = 'YXZ';
      seg.ramp.rotation.set(Math.atan(-getTrackSlope(centerZ)), midYaw, midBank);
    }

    seg.boost.visible = seg.type === 'boost' || seg.type === 'loop';
    if (seg.boost.visible) {
      const bz = seg.type === 'loop' ? (L / 2 - 2.2) : 0;
      const wz = centerZ + bz;
      const bx = getTrackCenterX(wz) + (seg.type === 'loop' ? LOOP_CENTER_X : 0);
      seg.boost.position.set(bx, getTrackHeight(wz) + 0.07, bz);
      seg.boost.rotation.order = 'YXZ';
      seg.boost.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
    }

    seg.bridge.visible = seg.type === 'bridge';
    if (seg.bridge.visible) {
      const h = Math.max(2, roadMidY - FLOOR_Y);
      for (const p of seg.pillars) {
        p.mesh.scale.y = h;
        p.mesh.position.set(getTrackCenterX(centerZ + p.pz) + p.px, FLOOR_Y + h / 2, p.pz);
        p.collar.position.set(getTrackCenterX(centerZ + p.pz) + p.px, FLOOR_Y + h * 0.58, p.pz);
      }
    }

    /* Milestone 500m / 1000m & Checkered FINISH ARCH 1500m */
    let milestoneDist = 0;
    if (i >= 0) {
      const kMin = Math.floor((i * L) / 500);
      const kMax = Math.floor(((i + 1) * L - 0.001) / 500);
      for (let k = Math.max(1, kMin); k <= kMax; k++) {
        const m = k * 500;
        if (m >= i * L && m < (i + 1) * L) { milestoneDist = m; break; }
      }
    }
    const lapDist = TRACK.lapDistance || 1500;
    const isFinishHere = milestoneDist > 0 && (milestoneDist % lapDist === 0);
    seg.milestoneArch.visible = milestoneDist > 0;
    if (seg.milestoneArch.visible) {
      const wz = -milestoneDist;
      const lz = wz - centerZ;
      seg.milestoneArch.position.set(getTrackCenterX(wz), getTrackHeight(wz), lz);
      seg.milestoneArch.rotation.order = 'YXZ';
      seg.milestoneArch.rotation.set(0, getTrackYaw(wz), getTrackBank(wz));
      const tex = isFinishHere ? finishBannerTex : (milestoneDist % 1000 === 0 ? milestone1000Tex : milestone500Tex);
      seg.milestoneMat.map = tex;
      seg.milestoneMat.emissiveMap = tex;
      seg.milestoneMat.needsUpdate = true;
      seg.finishStripe.visible = isFinishHere;
      seg.finishStripe.rotation.x = -Math.PI / 2 - Math.atan(-getTrackSlope(wz));
      for (const fl of seg.finishFlags) fl.visible = isFinishHere;
    }

    seg.arch.visible = !seg.milestoneArch.visible && i >= 4 && i % (TRACK.archEvery || 8) === 0 && seg.type !== 'loop';
    if (seg.arch.visible) {
      seg.arch.position.set(midCx, roadMidY, 0);
      seg.arch.rotation.set(0, midYaw, midBank);
    }

    /* Sky Loops di cakrawala atas Salatiga + Maskot / Monster Truck raksasa di taman luar */
    seg.skyLoop.visible = i >= 1 && i % 3 === 0;
    if (seg.skyLoop.visible) {
      const side = i % 2 === 0 ? -1 : 1;
      seg.skyLoop.position.set(side * 46, FLOOR_Y, 0);
      seg.skyLoop.rotation.y = side * -0.52;
    }
    const showMascot = i >= 2 && i % 4 === 0 && seg.type !== 'loop';
    const useMonster = (Math.floor(i / 4) % 2) === 1;
    seg.mascot0.visible = showMascot && !useMonster;
    seg.mascot1.visible = showMascot && useMonster;
    if (showMascot) {
      const side = i % 8 === 0 ? -1 : 1;
      const mObj = useMonster ? seg.mascot1 : seg.mascot0;
      mObj.position.set(side * 37.5, FLOOR_Y, -3.5);
      mObj.rotation.y = side < 0 ? 0.55 : -0.55;
    }

    /* Smashable props (kerucut & tumpukan 3 barel abu-abu/kuning) + Penghalang tengkorak + Tanda Segitiga "!" */
    const LANE_W = W / TRACK.lanes;
    const propLaneIdx = Math.floor(hash(i * 37 + 11) * 3) % 3;
    const propLaneOff = (propLaneIdx - 1) * LANE_W;
    const showProps = (seg.type === 'plain' || seg.type === 'boost') && i >= 2;
    seg.smashProps.forEach((p, idx) => {
      p.hit = false;
      p.vx = 0; p.vy = 0; p.vz = 0; p.rvx = 0; p.rvz = 0;
      p.mesh.rotation.set(0, 0, 0);
      p.active = showProps;
      p.mesh.visible = showProps;
      if (showProps) {
        const ox = idx < 2 ? (idx === 0 ? -1.1 : 1.1) : (idx === 2 ? -0.7 : 0.7);
        const oz = 3.5 - Math.floor(idx / 2) * 3.8;
        const wz = centerZ + oz;
        const off = propLaneOff + ox;
        const wx = getTrackCenterX(wz) + off;
        p.lx = wx;
        p.lz = oz;
        p.baseY = getTrackHeight(wz) + off * getTrackBank(wz);
        p.mesh.position.set(wx, p.baseY, oz);
        p.mesh.rotation.y = getTrackYaw(wz);
      }
    });

    const haz = seg.hazard;
    const showHazard = seg.type === 'plain' && i >= 5 && (i % 3 === 1 || i % 7 === 2);
    haz.hit = false;
    haz.vx = 0; haz.vy = 0; haz.vz = 0; haz.rvx = 0; haz.rvz = 0;
    haz.mesh.rotation.set(0, 0, 0);
    haz.active = showHazard;
    haz.mesh.visible = showHazard;
    let hazLaneOff = 0;
    if (showHazard) {
      const hazLaneIdx = (propLaneIdx + 1 + (i % 2)) % 3;
      hazLaneOff = (hazLaneIdx - 1) * LANE_W;
      haz.lz = -4.5;
      const wz = centerZ + haz.lz;
      const wx = getTrackCenterX(wz) + hazLaneOff;
      haz.lx = wx;
      haz.baseY = getTrackHeight(wz) + hazLaneOff * getTrackBank(wz);
      haz.mesh.position.set(wx, haz.baseY, haz.lz);
      haz.mesh.rotation.y = getTrackYaw(wz);
    }

    /* Papan Segitiga Merah "!" Mengambang di tepi trek, ~14 unit di depan rintangan pada sisi lajur terblokir */
    const ws = seg.warnSign;
    const showWarn = showHazard || showProps;
    ws.active = showWarn;
    ws.mesh.visible = showWarn;
    if (showWarn) {
      const targetOff = showHazard ? hazLaneOff : propLaneOff;
      const edgeSide = targetOff === 0 ? (i % 2 === 0 ? -1 : 1) : (targetOff < 0 ? -1 : 1);
      const warnLz = showHazard ? 9.5 : 11.0;
      const wz = centerZ + warnLz;
      const offX = edgeSide * (W / 2 + 0.95);
      ws.lx = getTrackCenterX(wz) + offX;
      ws.lz = warnLz;
      ws.baseY = getTrackHeight(wz) + offX * getTrackBank(wz);
      ws.phase = i * 1.3;
      ws.mesh.position.set(ws.lx, ws.baseY, warnLz);
      ws.mesh.rotation.y = getTrackYaw(wz);
    }

    seg.decor.forEach((d, k) => {
      if (d.kind === 'lamp') {
        const side = d.sideIdx === 0 ? -1 : 1;
        const lz = d.sideIdx === 0 ? -L * 0.25 : L * 0.25;
        const wz = centerZ + lz;
        const off = side * (W / 2 + 0.72);
        const y = getTrackHeight(wz) + off * getTrackBank(wz);
        d.obj.position.set(getTrackCenterX(wz) + off, y, lz);
        d.obj.rotation.y = getTrackYaw(wz) + (side < 0 ? 0 : Math.PI);
      } else if (d.kind === 'bush') {
        const side = hash(i * 17 + k) > 0.5 ? 1 : -1;
        const lz = -L / 2 + 2.5 + hash(i * 23 + k) * (L - 5);
        const wz = centerZ + lz;
        const off = side * (W / 2 + 1.45 + hash(i * 29 + k) * 1.1);
        const y = getTrackHeight(wz) + off * getTrackBank(wz);
        d.obj.position.set(getTrackCenterX(wz) + off, y - 0.14, lz);
        d.obj.scale.setScalar(0.85 + hash(i * 31 + k) * 0.4);
      } else {
        const side = hash(i * 7 + k) > 0.5 ? 1 : -1;
        const lz = -L / 2 + 3 + hash(i * 13 + k) * (L - 6);
        const wz = centerZ + lz;
        const off = side * (W / 2 + 1.9 + hash(i * 17 + k) * 1.3);
        const y = getTrackHeight(wz) + off * getTrackBank(wz);
        d.obj.position.set(getTrackCenterX(wz) + off, y - 0.14, lz);
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

      if (seg.warnSign?.active) {
        seg.warnSign.mesh.position.y = seg.warnSign.baseY + Math.sin(t * 5.2 + seg.warnSign.phase) * 0.18;
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
      seg.rampSafeRoad.geometry.dispose();
      seg.narrowRoad.geometry.dispose();
      seg.forkLeftRoad.geometry.dispose();
      seg.forkRightRoad.geometry.dispose();
      seg.forkLeftRailL.geometry.dispose();
      seg.forkLeftRailR.geometry.dispose();
      seg.forkRightRailL.geometry.dispose();
      seg.forkRightRailR.geometry.dispose();
      seg.loopDeck.geometry.dispose();
      seg.loopRailL.geometry.dispose();
      seg.loopRailR.geometry.dispose();
      seg.loopBypassRoad.geometry.dispose();
      seg.loopBypassRailL.geometry.dispose();
      seg.loopBypassRailR.geometry.dispose();
      seg.milestoneMat.dispose();
      for (const sh of seg.shoulders) sh.mesh.geometry.dispose();
      for (const sk of seg.skirts) sk.geometry.dispose();
      for (const e of seg.edges) e.geometry.dispose();
      seg.grassInst.dispose();
      seg.flowerInst.dispose();
      for (const item of seg.collectibles) item.gemMesh.userData.gemMat.dispose();
    }
    [
      geoDash, geoRamp, geoRampRail, geoRampStripe, geoRampLipHazard, geoBoost, geoChevron,
      geoBoosterHousing, geoBoosterWheel, geoBoosterHub, geoBoosterRing, geoConnectorBar, geoConnectorEar,
      geoFireRingTorus, geoFireFlame, geoSkyLoop, geoConeBody, geoConeBase, geoConeCollar,
      geoBarrelBody, geoBarrelBand, geoHazardBody, geoHazardSign, geoHazardBeacon,
      geoMascotPlinth, geoMascotHead, geoMascotBody, geoMascotArm, geoMonsterWheel, geoMonsterCabin,
      geoGapCap, geoLoopStrut, geoForkSignPost, geoForkSignBoard, geoLoopArrow, geoLoopSignBoard,
      geoPillar, geoPillarCollar, geoPillarBase, geoGuardPost, geoGuardBeam, geoGuardUpperBeam,
      geoTrunk, geoCanopy, geoBushLobe, geoBerry,
      geoPlantShadow, geoGrassTuft, geoFlower, geoLampBase, geoLampPole,
      geoLampArm, geoLampHead, geoFloor, geoSideStreet, geoSideWalk, geoStreetDash,
      geoBlock, geoFencePost, geoFenceRail,
      geoArchPillar, geoArchLightBar, geoArchBeam, geoArchSign, geoArchBulb, geoBunting,
      geoFinishStripe, geoFinishFlagPole, geoFinishFlagCloth, geoWarnPost, geoWarnBoard,
      geoCoinBody, geoCoinRim, geoCoinCore, geoGemStar, geoGemRing, geoGlowRing,
    ].forEach((g) => g.dispose());
    [
      matAsphalt, matForkLeft, matLoopSurface, matGapCap, matForkSign, matHazardStripe,
      matFireRing, matFireFlame, matConeOrange, matConeWhite, matBarrelRed, matBarrelGrey, matBarrelYellow,
      matSkullSign, matWarnSign, matBeaconRed, matBeaconBlue,
      matShoulderBlend, matDeckSide, matCurb, matLine, matConnectorBlue,
      matRamp, matRampStripe, matBoost, matChevron, matBoosterWheel, matBoosterHub,
      matPillar, matPillarGlow, matSideStreet, matSideWalk, matStreetLine,
      ...matRailColors, matRailGlow, matLoopArrow, matLoopSign,
      matTrunk, matLeaf1, matLeaf2, matLeaf3, matBushEmerald, matBushPurple,
      matBerry, matGrassTuft, matFlower, matPlantShadow, matLampPole,
      matLampCollar, matLampHead, ...floorMats, ...blockMats, matArchBanner, matCheckeredStripe,
      matArchBlue, matArchGold, matFenceRed, matFenceWhite, matCoinGold,
      matCoinRim, matGemHalo, ...Object.values(ringMats),
    ].forEach((m) => m.dispose());
    [
      roadTex.map, roadTex.normalMap, plantShadowTex, glowRingTex, forkSignTex,
      loopArrowTex, loopSignTex, hazardStripeTex, skullSignTex, warnTriangleTex, rampChevronTex,
      ...floorTextures, ...blockTextures, archBannerTex, milestone500Tex, milestone1000Tex, finishBannerTex, checkeredStripeTex,
    ].forEach((t) => t.dispose());
    pool.length = 0;
  }

  return {
    updateTrack, collectNearby, checkPropSmash, checkHazardCollision, getUpcomingHazards,
    getCollectibleTargets, resetCollectibles, dispose,
    getTrackHeight, getTrackSlope, getTrackCenterX, getTrackYaw, getTrackBank, getRampSide,
    getTrackSurfaceAt, evalLoopPose, checkRampCollision, checkBoostCollision, getSegmentType,
    get segmentCount() { return pool.length; },
  };
}
