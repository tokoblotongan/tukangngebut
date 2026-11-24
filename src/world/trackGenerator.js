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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK, TRACK_PROFILE, PHYSICS, PALETTE as P } from '../config/gameConfig.js';
import { FRUIT_TYPES, buildToyFruit } from '../entities/assetFactory.js';
import {
  createCleanOrangeTrackMaterial,
  createWarningSignTexture,
  whenFontsReady,
} from './trackMaterial.js';

const L = TRACK.segmentLength;
const W = TRACK.width;
const HILL_OFFSET = TRACK_PROFILE.salatigaHillOffset ?? 2.5;
const BRIDGE_H = TRACK_PROFILE.salatigaBridgeHeight ?? 0.5;
const BRIDGE_SPAN = TRACK_PROFILE.salatigaBridgeSpan ?? 27;
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
const RIBBON_STEPS_HD = 16;
const RIBBON_STEPS_ECO = 6;
const MAX_COLLECTIBLES_HD = 10;
const MAX_COLLECTIBLES_ECO = 6;
const GRASS_PER_SEG = 12;
const FLOWERS_PER_SEG = 6;

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

function isFlatSegmentType(st) {
  return st === 'loop' || st === 'ramp' || st === 'fork' || st === 'narrow';
}
function isFlatSegmentIdx(k) {
  return k >= 0 && isFlatSegmentType(getSegmentType(k));
}
function rawHillHeight(dist) {
  const { amp1, freq1, amp2, freq2 } = TRACK.hill;
  return HILL_OFFSET + amp1 * Math.sin(-dist * freq1) + amp2 * Math.sin(-dist * freq2 + 1.7);
}
function getFlatCluster(k) {
  let k0 = k;
  let k1 = k;
  while (isFlatSegmentIdx(k0 - 1)) k0--;
  while (isFlatSegmentIdx(k1 + 1)) k1++;
  const a = k0 * L;
  const b = (k1 + 1) * L;
  // Jika diapit/bersebelahan dengan jembatan (m=4), pakai elevasi pusat jembatan agar lereng gabungan <= 0.12
  if (k0 === k1 && k0 >= 1 && getSegmentType(k0 - 1) === 'bridge') {
    const prevA = (k0 - 2) * L;
    return { a, b, h: rawHillHeight((prevA + b) * 0.5) };
  }
  if (k0 === k1 && getSegmentType(k1 + 1) === 'bridge') {
    const nextB = (k1 + 3) * L;
    return { a, b, h: rawHillHeight((a + nextB) * 0.5) };
  }
  return { a, b, h: rawHillHeight((a + b) * 0.5) };
}

export function getTrackHeight(z) {
  const dist = Math.max(0, -z);
  const kCenter = Math.floor(dist / L);
  let h;

  if (isFlatSegmentIdx(kCenter)) {
    h = getFlatCluster(kCenter).h;
  } else {
    let prevCluster = null;
    for (let k = kCenter - 1; k >= Math.max(0, kCenter - 2); k--) {
      if (isFlatSegmentIdx(k)) { prevCluster = getFlatCluster(k); break; }
    }
    let nextCluster = null;
    for (let k = kCenter + 1; k <= kCenter + 2; k++) {
      if (isFlatSegmentIdx(k)) { nextCluster = getFlatCluster(k); break; }
    }

    const pad = 0.5;
    if (prevCluster && nextCluster && (nextCluster.a - prevCluster.b) <= 30) {
      // Celah 1 segmen (24 m): pakai rentang penuh antar pad (23 m) agar maxSlope <= 0.12
      const t0 = prevCluster.b + pad;
      const t1 = nextCluster.a - pad;
      const w = smoothstep(t0, t1, dist);
      h = prevCluster.h + (nextCluster.h - prevCluster.h) * w;
    } else if (prevCluster && dist <= prevCluster.b + pad) {
      h = prevCluster.h;
    } else if (nextCluster && dist >= nextCluster.a - pad) {
      h = nextCluster.h;
    } else {
      h = rawHillHeight(dist);
      if (prevCluster && dist < prevCluster.b + pad + 20) {
        const w = 1 - smoothstep(prevCluster.b + pad, prevCluster.b + pad + 20, dist);
        h = h + (prevCluster.h - h) * w;
      } else if (nextCluster && dist > nextCluster.a - pad - 20) {
        const w = smoothstep(nextCluster.a - pad - 20, nextCluster.a - pad, dist);
        h = h + (nextCluster.h - h) * w;
      }
    }
  }

  for (let k = kCenter - 1; k <= kCenter + 1; k++) {
    if (k < 0 || getSegmentType(k) !== 'bridge') continue;
    const bStart = k * L + 1.0;
    const bEnd = (k + 1) * L - 1.0;
    if (dist > bStart && dist < bEnd) {
      const u = (dist - bStart) / (bEnd - bStart);
      const s = Math.sin(Math.PI * u);
      h += BRIDGE_H * s * s;
    }
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

function makeBlockTex(letter, bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const draw = () => {
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
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  whenFontsReady(() => { draw(); tex.needsUpdate = true; });
  return tex;
}

function makeArchBannerTex(text = 'JURAGAN NGEBUT • SALATIGA', c0 = '#d90429', c1 = '#ff6b00', border = '#ffd100', checkered = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  const draw = () => {
    g.clearRect(0, 0, 1024, 192);
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
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  whenFontsReady(() => { draw(); tex.needsUpdate = true; });
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
export function createTrackGenerator(scene, { maxAnisotropy = 8, eco = false } = {}) {
  let isEco = !!eco;
  const tuneTex = (tex) => {
    if (!tex) return tex;
    tex.anisotropy = maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };

  const matAsphalt = createCleanOrangeTrackMaterial({ maxAnisotropy, repeatX: 1, repeatY: 2 });

  /* Material bahu jalan dengan transisi vertex color oranye/stone → rumput */
  const matShoulderBlend = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  const matDeckSide = new THREE.MeshStandardMaterial({ color: P.trackOrangeDark, roughness: 0.42, metalness: 0.06 });
  const matCurb = new THREE.MeshStandardMaterial({ color: P.trackOrange, roughness: 0.4, metalness: 0.06 });
  const matLine = new THREE.MeshStandardMaterial({ color: '#ffe599', roughness: 0.36, metalness: 0.04, emissive: '#ffbe0b', emissiveIntensity: 0.2 });
  const matConnectorBlue = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.38, metalness: 0.08,
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
  const warnBarrierTex = tuneTex(createWarningSignTexture());
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
  const matStarRing = new THREE.MeshPhysicalMaterial({
    color: '#ffbe0b', roughness: 0.16, metalness: 0.65, clearcoat: 1.0,
    emissive: '#ff9f1c', emissiveIntensity: 0.72,
  });
  const matConeOrange = new THREE.MeshStandardMaterial({ color: '#ff5400', roughness: 0.38, metalness: 0.06 });
  const matConeWhite = new THREE.MeshStandardMaterial({ color: '#fff8eb', roughness: 0.38, metalness: 0.06 });
  const matBarrelRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.38, metalness: 0.12 });
  const matBarrelGrey = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.38, metalness: 0.24 });
  const matBarrelYellow = new THREE.MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.38, metalness: 0.12 });
  const matHazardBarrierSign = new THREE.MeshStandardMaterial({
    map: warnBarrierTex, roughness: 0.38, emissive: '#ffffff', emissiveMap: warnBarrierTex, emissiveIntensity: 0.22,
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
  const matRailOrange = new THREE.MeshStandardMaterial({ color: P.trackOrange, roughness: 0.4, metalness: 0.06 });
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
    const draw = () => {
      g.clearRect(0, 0, 512, 112);
      g.fillStyle = '#18181b';
      g.beginPath(); g.roundRect(4, 4, 504, 104, 18); g.fill();
      g.strokeStyle = '#38bdf8'; g.lineWidth = 6; g.stroke();
      g.font = '700 28px Fredoka, "Plus Jakarta Sans", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffbe0b'; g.fillText('KIRI: LOOP 360° + BONUS', 142, 56);
      g.fillStyle = '#6ee7b7'; g.fillText('KANAN: JALUR AMAN', 392, 56);
    };
    draw();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    whenFontsReady(() => { draw(); tex.needsUpdate = true; });
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

  /* Material lantai hijau polos lembut, blok ABC & gerbang */
  const matFloor = new THREE.MeshStandardMaterial({
    color: '#6bbd8c', roughness: 0.9, metalness: 0.02,
  });

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
  const startBannerTex = tuneTex(makeArchBannerTex('START • SIRKUIT SALATIGA', '#0055cc', '#ff6b00', '#ffbe0b', true));
  const milestone500Tex = tuneTex(makeArchBannerTex('CHECKPOINT 500 METER', '#0077ff', '#ff6b00', '#ffbe0b', false));
  const milestone1000Tex = tuneTex(makeArchBannerTex('1000 METER • SISA 500M!', '#d90429', '#ff5400', '#ffe066', false));
  const finishBannerTex = tuneTex(makeArchBannerTex('GARIS FINISH • 1500M', '#18181b', '#d90429', '#ffbe0b', true));
  const matMilestoneStart = new THREE.MeshStandardMaterial({
    map: startBannerTex, roughness: 0.4, emissive: '#ffffff', emissiveMap: startBannerTex, emissiveIntensity: 0.28,
  });
  const matMilestone500 = new THREE.MeshStandardMaterial({
    map: milestone500Tex, roughness: 0.4, emissive: '#ffffff', emissiveMap: milestone500Tex, emissiveIntensity: 0.28,
  });
  const matMilestone1000 = new THREE.MeshStandardMaterial({
    map: milestone1000Tex, roughness: 0.4, emissive: '#ffffff', emissiveMap: milestone1000Tex, emissiveIntensity: 0.28,
  });
  const matMilestoneFinish = new THREE.MeshStandardMaterial({
    map: finishBannerTex, roughness: 0.4, emissive: '#ffffff', emissiveMap: finishBannerTex, emissiveIntensity: 0.28,
  });
  const checkeredStripeTex = tuneTex(makeCheckeredStripeTex());
  const matCheckeredStripe = new THREE.MeshStandardMaterial({
    map: checkeredStripeTex, roughness: 0.36, metalness: 0.06,
  });
  const matArchBlue = new THREE.MeshStandardMaterial({ color: P.toyBlue, roughness: 0.36, metalness: 0.08 });
  const matArchGold = new THREE.MeshStandardMaterial({ color: P.coinGold, roughness: 0.24, metalness: 0.6 });

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
  const matCoinMerged = new THREE.MeshPhysicalMaterial({
    vertexColors: true, metalness: 0.87, roughness: 0.17,
    clearcoat: 0.85, clearcoatRoughness: 0.1,
    emissive: '#fb8500', emissiveIntensity: 0.22,
  });
  const matDecorVertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
  const matPropsVertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.14 });
  const matGemShared = new THREE.MeshPhysicalMaterial({
    color: '#ff6b6b', emissive: '#ff6b6b', emissiveIntensity: 0.65,
    roughness: 0.08, metalness: 0.25, clearcoat: 1.0,
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
  const geoConnectorBar = new RoundedBoxGeometry(W + 1.45, 0.36, 1.2, 1, 0.08);
  const geoConnectorEar = new RoundedBoxGeometry(0.58, 0.98, 1.5, 1, 0.1);
  const geoStarRingTorus = new THREE.TorusGeometry(1.82, 0.19, 8, 22);
  const geoStarPoint = new THREE.OctahedronGeometry(0.24, 0);
  const geoConeBody = new THREE.ConeGeometry(0.42, 1.05, 10);
  const geoConeBase = new THREE.BoxGeometry(0.95, 0.14, 0.95);
  const geoConeCollar = new THREE.CylinderGeometry(0.21, 0.28, 0.26, 10);
  const geoBarrelBody = new THREE.CylinderGeometry(0.54, 0.54, 1.25, 10);
  const geoBarrelBand = new THREE.CylinderGeometry(0.56, 0.56, 0.32, 10);
  const geoHazardBody = new RoundedBoxGeometry(3.4, 1.65, 0.62, 1, 0.12);
  const geoHazardSign = new THREE.PlaneGeometry(3.0, 1.4);
  const geoHazardBeacon = new THREE.SphereGeometry(0.26, 8, 6);
  const geoPillar = new THREE.CylinderGeometry(0.62, 0.82, 1, 10);
  const geoGuardPost = new RoundedBoxGeometry(0.26, 1.02, 0.3, 1, 0.05);
  const geoGuardBeam = new RoundedBoxGeometry(0.32, 0.44, 4.18, 1, 0.08);

  const geoTrunk = new THREE.CylinderGeometry(0.14, 0.26, 1.25, 8);
  const geoCanopy = new THREE.SphereGeometry(0.86, 8, 6);
  const geoBushLobe = new THREE.SphereGeometry(0.56, 8, 6);
  const geoBerry = new THREE.SphereGeometry(0.1, 6, 5);
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

  const geoLampBase = new THREE.CylinderGeometry(0.18, 0.24, 0.35, 8);
  const geoLampPole = new THREE.CylinderGeometry(0.07, 0.09, 3.1, 6);
  const geoLampArm = new THREE.BoxGeometry(0.95, 0.08, 0.08);
  const geoLampHead = new THREE.SphereGeometry(0.22, 8, 6);

  const geoFloor = new THREE.PlaneGeometry(460, 460);
  geoFloor.rotateX(-Math.PI / 2);
  const geoBlock = new RoundedBoxGeometry(4.6, 4.6, 4.6, 1, 0.32);
  const geoArchPillar = new RoundedBoxGeometry(1.35, 13.6, 1.35, 1, 0.16);
  const geoArchLightBar = new THREE.BoxGeometry(0.22, 9.6, 0.22);
  const geoArchBeam = new RoundedBoxGeometry(W + 4.4, 1.75, 1.45, 1, 0.22);
  const geoArchSign = new THREE.PlaneGeometry(W + 2.4, 2.5);
  const geoArchBulb = new THREE.SphereGeometry(0.26, 8, 6);
  const geoBunting = new THREE.ConeGeometry(0.32, 0.65, 3);
  const geoFinishStripe = new THREE.PlaneGeometry(W - 0.6, 3.2);
  geoFinishStripe.rotateX(-Math.PI / 2);
  const geoFinishFlagPole = new THREE.CylinderGeometry(0.11, 0.14, 3.4, 6);
  const geoFinishFlagCloth = new THREE.PlaneGeometry(2.6, 1.45);
  const geoWarnPost = new THREE.CylinderGeometry(0.08, 0.11, 2.2, 6);
  const geoWarnBoard = new THREE.PlaneGeometry(2.15, 2.15);
  const geoLoopArrow = new THREE.PlaneGeometry(4.4, 5.2);
  geoLoopArrow.rotateX(-Math.PI / 2);
  const geoLoopSignBoard = new THREE.PlaneGeometry(8.8, 1.5);

  /* Geometri koin, permata & cincin lantai */
  const geoCoinBody = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 16);
  geoCoinBody.rotateX(Math.PI / 2);
  const geoCoinRim = new THREE.TorusGeometry(0.55, 0.09, 6, 16);
  const geoCoinCore = new THREE.CylinderGeometry(0.30, 0.30, 0.21, 6);
  geoCoinCore.rotateX(Math.PI / 2);

  function bakePart(src, hex, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    g.deleteAttribute('uv');
    if (rx !== 0 || ry !== 0 || rz !== 0) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
    if (tx !== 0 || ty !== 0 || tz !== 0) g.translate(tx, ty, tz);
    const n = g.attributes.position.count;
    const c = new THREE.Color(hex);
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  }

  function mergeTransformed(items) {
    const m4 = new THREE.Matrix4();
    const eu = new THREE.Euler();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const parts = items.map(({ geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 }) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      eu.set(rx, ry, rz);
      q.setFromEuler(eu);
      pos.set(x, y, z);
      scl.set(sx, sy, sz);
      m4.compose(pos, q, scl);
      g.applyMatrix4(m4);
      return g;
    });
    const m = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return m;
  }

  const geoCoinMerged = (() => {
    const p = [bakePart(geoCoinBody, P.coinGold), bakePart(geoCoinRim, P.coinGoldRim), bakePart(geoCoinCore, P.coinGoldRim)];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();

  const geoConnectorMerged = (() => {
    const gBar = geoConnectorBar.clone(); gBar.translate(0, -0.14, 0);
    const gEarL = geoConnectorEar.clone(); gEarL.translate(-(W / 2 + 0.38), 0.34, 0);
    const gEarR = geoConnectorEar.clone(); gEarR.translate(W / 2 + 0.38, 0.34, 0);
    const m = mergeGeometries([gBar, gEarL, gEarR], false);
    gBar.dispose(); gEarL.dispose(); gEarR.dispose();
    return m;
  })();

  const geoTreeMerged = (() => {
    const p = [
      bakePart(geoTrunk, P.woodDark, 0, 0.62, 0),
      bakePart(geoCanopy, '#38b000', 0, 1.75, 0, 1.12, 0.92, 1.12),
      bakePart(geoCanopy, '#4d7c0f', -0.48, 1.48, 0.28, 0.74, 0.74, 0.74),
      bakePart(geoCanopy, '#52b788', 0.46, 1.56, -0.22, 0.7, 0.7, 0.7),
    ];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();

  const geoBushMerged = (() => {
    const p = [
      bakePart(geoBushLobe, '#ffffff', 0, 0.42, 0, 1.15, 0.85, 1.15),
      bakePart(geoBushLobe, '#ffffff', -0.42, 0.34, 0.14, 0.76, 0.76, 0.76),
    ];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();

  const geoLampPoleMerged = (() => {
    const p = [
      bakePart(geoLampBase, P.toyRed, 0, 0.17, 0),
      bakePart(geoLampPole, P.tire, 0, 1.72, 0),
      bakePart(geoLampArm, P.tire, 0.42, 3.22, 0),
    ];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();

  const geoConeMerged = (() => {
    const p = [
      bakePart(geoConeBase, '#ff5400', 0, 0.07, 0),
      bakePart(geoConeBody, '#ff5400', 0, 0.58, 0),
      bakePart(geoConeCollar, '#fff8eb', 0, 0.68, 0),
    ];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();

  const geoBarrelStackMerged = (() => {
    const parts = [];
    for (const [bx, by] of [[-0.45, 0.46], [0.45, 0.46], [0, 1.34]]) {
      parts.push(bakePart(geoBarrelBody, '#64748b', bx, by, 0, 0.74, 0.74, 0.74));
      parts.push(bakePart(geoBarrelBand, '#ffbe0b', bx, by - 0.26 * 0.74, 0, 0.74, 0.74, 0.74));
      parts.push(bakePart(geoBarrelBand, '#ffbe0b', bx, by + 0.26 * 0.74, 0, 0.74, 0.74, 0.74));
    }
    const m = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return m;
  })();

  const geoGemStar = new THREE.OctahedronGeometry(0.68, 0);
  const geoGemStarMerged = (() => {
    const a = geoGemStar.index ? geoGemStar.toNonIndexed() : geoGemStar.clone();
    const b = a.clone();
    b.rotateX(Math.PI / 4);
    b.rotateY(Math.PI / 4);
    const m = mergeGeometries([a, b], false);
    a.dispose(); b.dispose();
    return m;
  })();
  const geoStarRingMerged = (() => {
    const parts = [geoStarRingTorus.index ? geoStarRingTorus.toNonIndexed() : geoStarRingTorus.clone()];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
      const st = geoStarPoint.index ? geoStarPoint.toNonIndexed() : geoStarPoint.clone();
      st.translate(Math.cos(a) * 2.08, Math.sin(a) * 2.08, 0);
      parts.push(st);
    }
    const m = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return m;
  })();
  const geoHazardFrameMerged = (() => {
    const p = [
      bakePart(geoGuardPost, P.connectorBlue, -1.35, 0.42, 0),
      bakePart(geoGuardPost, P.connectorBlue, 1.35, 0.42, 0),
      bakePart(geoHazardBody, '#e63946', 0, 1.12, 0),
    ];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();
  const geoGemRing = new THREE.TorusGeometry(0.92, 0.055, 8, 24);
  const geoGlowRing = new THREE.PlaneGeometry(2.35, 2.35);

  const geoRampRailsMerged = mergeTransformed([-1, 1].map((side) => ({
    geo: geoRampRail, x: side * (RAMP_W / 2 + 0.14), y: 0.14, z: 0, rx: Math.atan2(RAMP_RISE, RAMP_LEN),
  })));
  const geoRampStripesMerged = mergeTransformed([0, 1, 2, 3].map((s) => {
    const lz = 1.65 - s * 1.1;
    const u = (s + 0.5) / 4;
    return {
      geo: geoRampStripe,
      x: 0, y: -RAMP_RISE * 0.45 + u * RAMP_RISE + 0.06, z: lz,
      rx: Math.atan2(RAMP_RISE, RAMP_LEN),
    };
  }));
  const geoBoostChevronsMerged = mergeTransformed([0, 1, 2].map((c) => ({
    geo: geoChevron, x: 0, y: 0.09, z: -1.0 + c * 1.0, ry: c % 2 ? 0.35 : -0.35,
  })));
  const geoBoostHousingsMerged = mergeTransformed([-1, 1].map((side) => ({
    geo: geoBoosterHousing, x: side * (BOOST_W / 2 + 0.85), y: 0.64, z: 0,
  })));
  const geoBoostRingsMerged = mergeTransformed([-1, 1].flatMap((side) => (
    [-1.05, 1.05].map((wz) => ({
      geo: geoBoosterRing, x: side * (BOOST_W / 2 + 0.28), y: 0.68, z: wz,
    }))
  )));
  const geoBoosterWheelMerged = (() => {
    const p = [
      bakePart(geoBoosterWheel, '#ffd100'),
      bakePart(geoBoosterHub, P.connectorBlue),
    ];
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();
  const geoArchFrameMerged = (() => {
    const p = [];
    for (const sx of [-1, 1]) {
      p.push(bakePart(geoArchPillar, P.toyBlue, sx * (W / 2 + 1.4), 3.4, 0));
      p.push(bakePart(geoArchBulb, P.coinGold, sx * (W / 2 + 1.4), 10.6, 0, 2.8, 2.8, 2.8));
    }
    p.push(bakePart(geoArchBeam, P.coinGold, 0, 8.2, 0));
    for (let b = 0; b < 9; b++) {
      const bx = -W / 2 + 0.8 + b * ((W - 1.6) / 8);
      p.push(bakePart(geoBunting, P.trackOrange, bx, 7.05, 0, 1, 1, 1, Math.PI, 0, 0));
    }
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();
  const geoArchLightBarsMerged = mergeTransformed([-1, 1].map((sx) => ({
    geo: geoArchLightBar, x: sx * (W / 2 + 0.66), y: 4.2, z: 0,
  })));
  const geoArchBulbsMerged = mergeTransformed(Array.from({ length: 9 }, (_, b) => ({
    geo: geoArchBulb, x: -W / 2 + 0.8 + b * ((W - 1.6) / 8), y: 9.25, z: 0,
  })));
  const geoArchSignsMerged = mergeTransformed([
    { geo: geoArchSign, x: 0, y: 8.2, z: 0.76 },
    { geo: geoArchSign, x: 0, y: 8.2, z: -0.76, ry: Math.PI },
  ]);
  const geoMilestoneFrameMerged = (() => {
    const p = [];
    for (const sx of [-1, 1]) {
      p.push(bakePart(geoArchPillar, P.toyBlue, sx * (W / 2 + 1.4), 3.4, 0));
      p.push(bakePart(geoArchBulb, P.coinGold, sx * (W / 2 + 1.4), 10.5, 0, 2.6, 2.6, 2.6));
    }
    p.push(bakePart(geoArchBeam, P.coinGold, 0, 8.2, 0));
    const m = mergeGeometries(p, false);
    p.forEach((g) => g.dispose());
    return m;
  })();
  const geoFinishFlagPolesMerged = mergeTransformed([-1, 1].map((sx) => ({
    geo: geoFinishFlagPole, x: sx * (W / 2 + 1.4), y: 12.1, z: 0,
  })));
  const geoFinishFlagClothsMerged = mergeTransformed([-1, 1].map((sx) => ({
    geo: geoFinishFlagCloth, x: sx * (W / 2 + 1.4) + (sx < 0 ? 1.2 : -1.2), y: 13.0, z: 0,
  })));
  const geoHazardSignsMerged = mergeTransformed([
    { geo: geoHazardSign, x: 0, y: 1.12, z: 0.33 },
    { geo: geoHazardSign, x: 0, y: 1.12, z: -0.33, ry: Math.PI },
  ]);

  const pool = [];
  const POOL_SIZE = TRACK.segmentsAhead + TRACK.segmentsBehind + 2;
  let ribbonSteps = isEco ? RIBBON_STEPS_ECO : RIBBON_STEPS_HD;
  let roadRows = isEco ? 6 : 14;

  const floorMesh = new THREE.Mesh(geoFloor, matFloor);
  floorMesh.position.set(0, FLOOR_Y, -110);
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  const MAX_GUARDS = POOL_SIZE * 12;
  const guardPostInst = new THREE.InstancedMesh(geoGuardPost, matCurb, MAX_GUARDS);
  guardPostInst.frustumCulled = false;
  guardPostInst.castShadow = !isEco;
  guardPostInst.count = 0;
  scene.add(guardPostInst);

  const guardBeamInst = new THREE.InstancedMesh(geoGuardBeam, matRailOrange, MAX_GUARDS);
  guardBeamInst.frustumCulled = false;
  guardBeamInst.castShadow = !isEco;
  guardBeamInst.receiveShadow = true;
  guardBeamInst.count = 0;
  scene.add(guardBeamInst);

  const dashInst = new THREE.InstancedMesh(geoDash, matLine, POOL_SIZE * 6);
  dashInst.frustumCulled = false;
  dashInst.count = 0;
  scene.add(dashInst);

  const connectorInst = new THREE.InstancedMesh(geoConnectorMerged, matConnectorBlue, POOL_SIZE);
  connectorInst.frustumCulled = false;
  connectorInst.count = 0;
  scene.add(connectorInst);

  const pierInst = new THREE.InstancedMesh(geoPillar, matPillar, POOL_SIZE * 2);
  pierInst.frustumCulled = false;
  pierInst.count = 0;
  scene.add(pierInst);

  const treeInst = new THREE.InstancedMesh(geoTreeMerged, matDecorVertex, POOL_SIZE);
  treeInst.frustumCulled = false;
  treeInst.count = 0;
  treeInst.visible = !isEco;
  scene.add(treeInst);

  const bushInst = new THREE.InstancedMesh(geoBushMerged, matDecorVertex, POOL_SIZE);
  bushInst.frustumCulled = false;
  bushInst.count = 0;
  bushInst.visible = !isEco;
  scene.add(bushInst);

  const lampInst = new THREE.InstancedMesh(geoLampPoleMerged, matDecorVertex, POOL_SIZE);
  lampInst.frustumCulled = false;
  lampInst.count = 0;
  lampInst.visible = !isEco;
  scene.add(lampInst);

  const lampHeadInst = new THREE.InstancedMesh(geoLampHead, matLampHead, POOL_SIZE);
  lampHeadInst.frustumCulled = false;
  lampHeadInst.count = 0;
  lampHeadInst.visible = !isEco;
  scene.add(lampHeadInst);

  const grassGlobalInst = new THREE.InstancedMesh(geoGrassTuft, matGrassTuft, POOL_SIZE * GRASS_PER_SEG);
  grassGlobalInst.frustumCulled = false;
  grassGlobalInst.count = 0;
  grassGlobalInst.visible = !isEco;
  scene.add(grassGlobalInst);

  const flowerGlobalInst = new THREE.InstancedMesh(geoFlower, matFlower, POOL_SIZE * FLOWERS_PER_SEG);
  flowerGlobalInst.frustumCulled = false;
  flowerGlobalInst.count = 0;
  flowerGlobalInst.visible = !isEco;
  scene.add(flowerGlobalInst);

  const _gDummy = new THREE.Object3D();
  const _bushCol = new THREE.Color('#2ec4b6');
  function syncGuardrails() {
    let postCount = 0;
    let beamCount = 0;
    let dashCount = 0;
    let connCount = 0;
    let pierCount = 0;
    let treeCount = 0;
    let bushCount = 0;
    let lampCount = 0;
    let grassCount = 0;
    let flowerCount = 0;
    for (const seg of pool) {
      if (seg.index === null || !seg.guardLayout) continue;
      const cz = seg.group.position.z;
      for (const p of seg.guardLayout.posts) {
        if (postCount >= MAX_GUARDS) break;
        _gDummy.position.set(p.x, p.y, cz + p.lz);
        _gDummy.rotation.set(0, p.yaw, 0);
        _gDummy.scale.set(1, 1, 1);
        _gDummy.updateMatrix();
        guardPostInst.setMatrixAt(postCount++, _gDummy.matrix);
      }
      for (const b of seg.guardLayout.beams) {
        if (beamCount >= MAX_GUARDS) break;
        _gDummy.position.set(b.x, b.y, cz + b.lz);
        _gDummy.rotation.order = 'YXZ';
        _gDummy.rotation.set(b.pitch, b.yaw, b.bank);
        _gDummy.scale.set(1, 1, b.scaleZ);
        _gDummy.updateMatrix();
        guardBeamInst.setMatrixAt(beamCount++, _gDummy.matrix);
      }
      const dl = seg.decorLayout;
      if (dl) {
        for (const d of dl.dashes) {
          _gDummy.position.set(d.x, d.y, cz + d.lz);
          _gDummy.rotation.order = 'YXZ';
          _gDummy.rotation.set(d.pitch, d.yaw, d.bank);
          _gDummy.scale.set(1, 1, 1);
          _gDummy.updateMatrix();
          dashInst.setMatrixAt(dashCount++, _gDummy.matrix);
        }
        if (dl.conn) {
          _gDummy.position.set(dl.conn.x, dl.conn.y, cz + dl.conn.lz);
          _gDummy.rotation.order = 'YXZ';
          _gDummy.rotation.set(dl.conn.pitch, dl.conn.yaw, dl.conn.bank);
          _gDummy.scale.set(1, 1, 1);
          _gDummy.updateMatrix();
          connectorInst.setMatrixAt(connCount++, _gDummy.matrix);
        }
        for (const pr of dl.piers) {
          _gDummy.position.set(pr.x, pr.y, cz);
          _gDummy.rotation.set(0, 0, 0);
          _gDummy.scale.set(1, pr.h, 1);
          _gDummy.updateMatrix();
          pierInst.setMatrixAt(pierCount++, _gDummy.matrix);
        }
        if (dl.tree) {
          _gDummy.position.set(dl.tree.x, dl.tree.y, cz + dl.tree.lz);
          _gDummy.rotation.set(0, dl.tree.ry, 0);
          _gDummy.scale.setScalar(dl.tree.sc);
          _gDummy.updateMatrix();
          treeInst.setMatrixAt(treeCount++, _gDummy.matrix);
        }
        if (dl.bush) {
          _gDummy.position.set(dl.bush.x, dl.bush.y, cz + dl.bush.lz);
          _gDummy.rotation.set(0, dl.bush.ry, 0);
          _gDummy.scale.setScalar(dl.bush.sc);
          _gDummy.updateMatrix();
          bushInst.setMatrixAt(bushCount, _gDummy.matrix);
          _bushCol.set(seg.index % 2 === 0 ? '#2ec4b6' : '#8338ec');
          bushInst.setColorAt(bushCount, _bushCol);
          bushCount++;
        }
        if (dl.lamp) {
          _gDummy.position.set(dl.lamp.x, dl.lamp.y, cz + dl.lamp.lz);
          _gDummy.rotation.set(0, dl.lamp.ry, 0);
          _gDummy.scale.set(1, 1, 1);
          _gDummy.updateMatrix();
          lampInst.setMatrixAt(lampCount, _gDummy.matrix);
          const hx = dl.lamp.x + Math.cos(dl.lamp.ry) * 0.84;
          const hz = cz + dl.lamp.lz - Math.sin(dl.lamp.ry) * 0.84;
          _gDummy.position.set(hx, dl.lamp.y + 3.06, hz);
          _gDummy.rotation.set(0, 0, 0);
          _gDummy.updateMatrix();
          lampHeadInst.setMatrixAt(lampCount, _gDummy.matrix);
          lampCount++;
        }
      }
      if (!isEco && seg.foliageLayout) {
        for (const gr of seg.foliageLayout.grass) {
          _gDummy.position.set(gr.x, gr.y, cz + gr.lz);
          _gDummy.rotation.set(0, gr.ry, 0);
          _gDummy.scale.setScalar(gr.sc);
          _gDummy.updateMatrix();
          grassGlobalInst.setMatrixAt(grassCount, _gDummy.matrix);
          _col.set(gr.col);
          grassGlobalInst.setColorAt(grassCount, _col);
          grassCount++;
        }
        for (const fl of seg.foliageLayout.flowers) {
          _gDummy.position.set(fl.x, fl.y, cz + fl.lz);
          _gDummy.rotation.set(0, fl.ry, 0);
          _gDummy.scale.setScalar(fl.sc);
          _gDummy.updateMatrix();
          flowerGlobalInst.setMatrixAt(flowerCount, _gDummy.matrix);
          _col.set(fl.col);
          flowerGlobalInst.setColorAt(flowerCount, _col);
          flowerCount++;
        }
      }
    }
    guardPostInst.count = postCount;
    guardPostInst.instanceMatrix.needsUpdate = true;
    guardBeamInst.count = beamCount;
    guardBeamInst.instanceMatrix.needsUpdate = true;
    dashInst.count = dashCount;
    dashInst.instanceMatrix.needsUpdate = true;
    connectorInst.count = connCount;
    connectorInst.instanceMatrix.needsUpdate = true;
    pierInst.count = pierCount;
    pierInst.instanceMatrix.needsUpdate = true;
    treeInst.count = treeCount;
    treeInst.instanceMatrix.needsUpdate = true;
    bushInst.count = bushCount;
    bushInst.instanceMatrix.needsUpdate = true;
    if (bushInst.instanceColor) bushInst.instanceColor.needsUpdate = true;
    lampInst.count = lampCount;
    lampInst.instanceMatrix.needsUpdate = true;
    lampHeadInst.count = lampCount;
    lampHeadInst.instanceMatrix.needsUpdate = true;
    grassGlobalInst.visible = !isEco;
    grassGlobalInst.count = grassCount;
    grassGlobalInst.instanceMatrix.needsUpdate = true;
    if (grassGlobalInst.instanceColor) grassGlobalInst.instanceColor.needsUpdate = true;
    flowerGlobalInst.visible = !isEco;
    flowerGlobalInst.count = flowerCount;
    flowerGlobalInst.instanceMatrix.needsUpdate = true;
    if (flowerGlobalInst.instanceColor) flowerGlobalInst.instanceColor.needsUpdate = true;
  }

  function ensureCollectibleMesh(slot, kind) {
    if (kind === 'coin' && !slot.coinMesh) {
      slot.coinMesh = buildCoinMesh();
      slot.obj.add(slot.coinMesh);
    } else if (kind === 'gem' && !slot.gemMesh) {
      slot.gemMesh = buildGemMesh();
      slot.obj.add(slot.gemMesh);
    } else if (kind === 'fruit' && !slot.fruitMesh) {
      slot.fruitMesh = buildToyFruit(slot.fruitType);
      slot.obj.add(slot.fruitMesh);
    } else if (kind === 'ring' && !slot.starRingMesh) {
      slot.starRingMesh = buildStarRingMesh();
      slot.obj.add(slot.starRingMesh);
    }
  }

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

  function makeRoadGeo(width, beveled = true, rows = 14) {
    const g = new THREE.PlaneGeometry(width, L, beveled ? 4 : 1, rows);
    g.rotateX(-Math.PI / 2);
    if (beveled) applyBeveledProfile(g, width);
    return g;
  }

  /** Bahu rumput-ke-trotoar di sisi kiri/kanan jalan dengan transisi vertex color halus */
  function makeShoulderBlendGeo(side, rows = 14) {
    const shoulderW = 2.6;
    const g = new THREE.PlaneGeometry(shoulderW, L, 2, rows);
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

  function makeShoulderBlendPairGeo(rows = 14) {
    const shL = makeShoulderBlendGeo(-1, rows);
    shL.translate(-(W / 2 + 1.3), 0, 0);
    const shR = makeShoulderBlendGeo(1, rows);
    shR.translate(W / 2 + 1.3, 0, 0);
    const m = mergeGeometries([shL, shR], false);
    shL.dispose(); shR.dispose();
    return m;
  }

  function makeSkirtGeo(rows = 14) {
    const g = new THREE.PlaneGeometry(L, 1.25, rows, 1);
    g.rotateY(Math.PI / 2);
    return g;
  }

  function makeSkirtPairGeo(rows = 14) {
    const skL = makeSkirtGeo(rows);
    skL.translate(-W / 2, 0, 0);
    const skR = makeSkirtGeo(rows);
    skR.translate(W / 2, 0, 0);
    const m = mergeGeometries([skL, skR], false);
    skL.dispose(); skR.dispose();
    return m;
  }

  function makeEdgesPairGeo(rows = 14) {
    const eL = makeRoadGeo(0.28, false, rows);
    eL.translate(-W / 2 + 0.3, 0, 0);
    const eR = makeRoadGeo(0.28, false, rows);
    eR.translate(W / 2 - 0.3, 0, 0);
    const m = mergeGeometries([eL, eR], false);
    eL.dispose(); eR.dispose();
    return m;
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

  const matForkLeft = createCleanOrangeTrackMaterial({ maxAnisotropy, repeatX: 1, repeatY: 2 });
  matForkLeft.color.set('#ff9068');
  const matLoopSurface = createCleanOrangeTrackMaterial({ maxAnisotropy, side: THREE.DoubleSide, repeatX: 1, repeatY: 2 });
  const matGapCap = new THREE.MeshStandardMaterial({
    color: P.connectorBlue, roughness: 0.36, metalness: 0.08,
    emissive: '#0044aa', emissiveIntensity: 0.18,
  });
  const geoGapCap = new RoundedBoxGeometry(W * 0.5 + 0.35, 0.42, 0.52, 1, 0.08);
  const geoLoopStrut = new THREE.CylinderGeometry(0.32, 0.45, 1, 8);
  const geoForkSignPost = new THREE.CylinderGeometry(0.16, 0.2, 4.4, 8);
  const geoLoopSignPostsMerged = mergeTransformed([-4.2, 4.2].map((px) => ({
    geo: geoForkSignPost, x: px, y: 2.2, z: 0,
  })));
  const geoForkSignBoard = new THREE.PlaneGeometry(7.6, 1.4);
  const forkSignTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112;
    const g = c.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, 512, 112);
      g.fillStyle = '#1b1b22';
      g.beginPath(); g.roundRect(4, 4, 504, 104, 18); g.fill();
      g.strokeStyle = '#ffbe0b'; g.lineWidth = 6; g.stroke();
      g.font = '700 28px Fredoka, "Plus Jakarta Sans", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ff6b8b'; g.fillText('ATAS: BUAH & BINTANG', 142, 56);
      g.fillStyle = '#38bdf8'; g.fillText('BAWAH: KOIN AMAN', 382, 56);
    };
    draw();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    whenFontsReady(() => { draw(); tex.needsUpdate = true; });
    return tuneTex(tex);
  })();
  const matForkSign = new THREE.MeshStandardMaterial({
    map: forkSignTex, roughness: 0.45, emissive: '#ffffff', emissiveMap: forkSignTex, emissiveIntensity: 0.25,
  });

  function buildCoinMesh() {
    const m = new THREE.Mesh(geoCoinMerged, matCoinMerged);
    m.castShadow = true;
    return m;
  }

  function buildGemMesh() {
    const g = new THREE.Group();
    const s1 = new THREE.Mesh(geoGemStarMerged, matGemShared);
    const ring = new THREE.Mesh(geoGemRing, matGemHalo);
    ring.rotation.x = Math.PI / 3;
    s1.castShadow = true;
    g.add(s1, ring);
    g.userData.gemMat = matGemShared;
    g.userData.ring = ring;
    return g;
  }

  function buildStarRingMesh() {
    const m = new THREE.Mesh(geoStarRingMerged, matStarRing);
    m.castShadow = false;
    return m;
  }

  function buildPropMesh(kind) {
    const m = new THREE.Mesh(kind === 'cone' ? geoConeMerged : geoBarrelStackMerged, matPropsVertex);
    m.castShadow = true;
    return m;
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

  function buildHazardBarrierMesh() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(geoHazardFrameMerged, matPropsVertex);
    frame.castShadow = true;
    const signs = new THREE.Mesh(geoHazardSignsMerged, matHazardBarrierSign);
    const beaconL = new THREE.Mesh(geoHazardBeacon, matBeaconRed);
    beaconL.position.set(-1.35, 2.08, 0);
    const beaconR = new THREE.Mesh(geoHazardBeacon, matBeaconBlue);
    beaconR.position.set(1.35, 2.08, 0);
    g.add(frame, signs, beaconL, beaconR);
    g.userData = { beaconL, beaconR };
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
      shoulder: null, skirt: null, edges: null,
      guardLayout: { posts: [], beams: [] },
      decorLayout: { dashes: [], conn: null, piers: [], tree: null, bush: null, lamp: null },
      narrowRoad: null, narrowGroup: null,
      forkGroup: null, forkLeftRoad: null, forkRightRoad: null,
      forkLeftRailL: null, forkLeftRailR: null, forkRightRailL: null, forkRightRailR: null,
      forkStruts: [], forkSign: null,
      loopGroup: null, loopDeck: null, loopRailL: null, loopRailR: null,
      loopBypassRoad: null, loopBypassRailL: null, loopBypassRailR: null,
      loopEntryArrow: null, loopSign: null, loopStruts: [],
      ramp: null, boost: null, boosterWheels: [],
      blocks: [], arch: null,
      milestoneArch: null, mSignFront: null, mSignBack: null, finishStripe: null, finishFlags: [],
      smashProps: [], hazard: null, warnSign: null,
      grassInst: null, flowerInst: null,
      collectibles: [],
    };

    /* 1 balok kayu ABC pastel di area luar jauh (>=40m) */
    const blk = new THREE.Mesh(geoBlock, blockMats[0]);
    blk.castShadow = !isEco;
    blk.receiveShadow = true;
    group.add(blk);
    seg.blocks.push(blk);

    /* Jalan plastik oranye + potongan chasm satu sisi & jalur aman di sebelahnya */
    seg.road = cacheBaseX(new THREE.Mesh(makeRoadGeo(W, true, roadRows), matAsphalt));
    seg.road.receiveShadow = true;
    group.add(seg.road);

    const rampApproach = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(L / 2, RAMP_GAP_START, W, 6), matAsphalt));
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

    /* Narrowing Beam Bridge */
    const narrowGroup = new THREE.Group();
    const narrowRoad = new THREE.Mesh(makeBeveledRibbonGeo(ribbonSteps), matAsphalt);
    narrowRoad.receiveShadow = true;
    narrowGroup.add(narrowRoad);
    narrowGroup.visible = false;
    group.add(narrowGroup);
    seg.narrowGroup = narrowGroup;
    seg.narrowRoad = narrowRoad;

    /* Over-Under Split Fork Paths (Kiri Atas: bertingkat penuh buah & bintang | Kanan Bawah: koin aman) */
    const forkGroup = new THREE.Group();
    const forkLeftRoad = new THREE.Mesh(makeBeveledRibbonGeo(ribbonSteps), matForkLeft);
    forkLeftRoad.receiveShadow = true;
    const forkRightRoad = new THREE.Mesh(makeBeveledRibbonGeo(ribbonSteps), matAsphalt);
    forkRightRoad.receiveShadow = true;
    const forkLeftRailL = new THREE.Mesh(makeRibbonGridGeo(ribbonSteps), matRailGlow);
    const forkLeftRailR = new THREE.Mesh(makeRibbonGridGeo(ribbonSteps), matRailGlow);
    const forkRightRailL = new THREE.Mesh(makeRibbonGridGeo(ribbonSteps), matRailGlow);
    const forkRightRailR = new THREE.Mesh(makeRibbonGridGeo(ribbonSteps), matRailGlow);
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

    /* 360° Dual-Choice Loop (Kiri: Loop 360° | Kanan: Jalur Aman Lurus) */
    const loopGroup = new THREE.Group();
    const loopDeck = new THREE.Mesh(makeBeveledRibbonGeo(LOOP_STEPS), matLoopSurface);
    loopDeck.receiveShadow = true;
    const loopRailL = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matCurb);
    const loopRailR = new THREE.Mesh(makeRibbonGridGeo(LOOP_STEPS), matCurb);
    const loopBypassRoad = new THREE.Mesh(makeBeveledRibbonGeo(ribbonSteps), matAsphalt);
    loopBypassRoad.receiveShadow = true;
    const loopBypassRailL = new THREE.Mesh(makeRibbonGridGeo(ribbonSteps), matRailGlow);
    const loopBypassRailR = new THREE.Mesh(makeRibbonGridGeo(ribbonSteps), matRailGlow);
    const loopEntryArrow = new THREE.Mesh(geoLoopArrow, matLoopArrow);
    loopEntryArrow.renderOrder = 2;
    const loopSign = new THREE.Group();
    const lPosts = new THREE.Mesh(geoLoopSignPostsMerged, matConnectorBlue);
    lPosts.castShadow = true;
    const lBoard = new THREE.Mesh(geoLoopSignBoard, matLoopSign);
    lBoard.position.set(0, 4.4, 0);
    loopSign.add(lPosts, lBoard);
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

    const sh = cacheBaseX(new THREE.Mesh(makeShoulderBlendPairGeo(roadRows), matShoulderBlend));
    sh.receiveShadow = true;
    group.add(sh);
    seg.shoulder = sh;

    const sk = cacheBaseX(new THREE.Mesh(makeSkirtPairGeo(roadRows), matDeckSide));
    sk.receiveShadow = true;
    group.add(sk);
    seg.skirt = sk;

    const ed = cacheBaseX(new THREE.Mesh(makeEdgesPairGeo(roadRows), matLine));
    ed.receiveShadow = true;
    group.add(ed);
    seg.edges = ed;

    /* Steep Triangular Launch Ramp with Yellow-Black Hazard Edge */
    const ramp = new THREE.Group();
    const slab = new THREE.Mesh(geoRamp, matRamp);
    slab.castShadow = true; slab.receiveShadow = true;
    const rampRails = new THREE.Mesh(geoRampRailsMerged, matConnectorBlue);
    rampRails.castShadow = true;
    const rampStripes = new THREE.Mesh(geoRampStripesMerged, matRampStripe);
    const hazardLip = new THREE.Mesh(geoRampLipHazard, matHazardStripe);
    hazardLip.position.set(0, RAMP_RISE * 0.46, -RAMP_LEN * 0.47);
    ramp.add(slab, rampRails, rampStripes, hazardLip);
    ramp.visible = false;
    group.add(ramp); seg.ramp = ramp;

    /* Boost Pad + Turbin Booster */
    const boost = new THREE.Group();
    const pad = new THREE.Mesh(geoBoost, matBoost);
    pad.receiveShadow = true;
    const chevrons = new THREE.Mesh(geoBoostChevronsMerged, matChevron);
    const housings = new THREE.Mesh(geoBoostHousingsMerged, matConnectorBlue);
    housings.castShadow = true;
    const boostRings = new THREE.Mesh(geoBoostRingsMerged, matPillarGlow);
    boost.add(pad, chevrons, housings, boostRings);
    for (const side of [-1, 1]) {
      for (const wz of [-1.05, 1.05]) {
        const wheelMesh = new THREE.Mesh(geoBoosterWheelMerged, matPropsVertex);
        wheelMesh.position.set(side * (BOOST_W / 2 + 0.32), 0.68, wz);
        wheelMesh.castShadow = true;
        boost.add(wheelMesh);
        seg.boosterWheels.push({ mesh: wheelMesh, side });
      }
    }
    boost.visible = false;
    group.add(boost); seg.boost = boost;

    /* Gerbang Emas Megah Jalan Layang */
    const arch = new THREE.Group();
    const archFrame = new THREE.Mesh(geoArchFrameMerged, matPropsVertex);
    archFrame.castShadow = true;
    const archLightBars = new THREE.Mesh(geoArchLightBarsMerged, matPillarGlow);
    const archBulbs = new THREE.Mesh(geoArchBulbsMerged, matLampHead);
    const archSigns = new THREE.Mesh(geoArchSignsMerged, matArchBanner);
    arch.add(archFrame, archLightBars, archBulbs, archSigns);
    arch.visible = false;
    group.add(arch);
    seg.arch = arch;

    /* Gerbang Milestone (500m / 1000m) & Gerbang FINISH 1500m Berkotak-kotak */
    const mArch = new THREE.Group();
    const mFrame = new THREE.Mesh(geoMilestoneFrameMerged, matPropsVertex);
    mFrame.castShadow = true;
    const fPoles = new THREE.Mesh(geoFinishFlagPolesMerged, matLampPole);
    const fCloths = new THREE.Mesh(geoFinishFlagClothsMerged, matCheckeredStripe);
    seg.finishFlags.push(fPoles, fCloths);
    const mSigns = new THREE.Mesh(geoArchSignsMerged, matMilestoneFinish);
    const finishStripe = new THREE.Mesh(geoFinishStripe, matCheckeredStripe);
    finishStripe.position.set(0, 0.04, 0);
    finishStripe.receiveShadow = true;
    mArch.add(mFrame, fPoles, fCloths, mSigns, finishStripe);
    mArch.visible = false;
    group.add(mArch);
    seg.milestoneArch = mArch;
    seg.mSignFront = mSigns;
    seg.mSignBack = mSigns;
    seg.finishStripe = finishStripe;

    /* Foliage pinggir jauh, rumput, bunga & lampu jalan di-render via global InstancedMesh */
    seg.foliageLayout = { grass: [], flowers: [] };

    /* Smashable props (2 tumpuk barel + 2 kerucut per segmen) */
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

    /* Penghalang bahaya merah/biru dengan simbol "!" (tanpa tengkorak) */
    const hazMesh = buildHazardBarrierMesh();
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

    /* Pool kolektibel lazy per segmen */
    for (let c = 0; c < MAX_COLLECTIBLES_HD; c++) {
      const wrapper = new THREE.Group();
      const fruitType = FRUIT_TYPES[c % FRUIT_TYPES.length];
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
        coinMesh: null,
        gemMesh: null,
        fruitMesh: null,
        starRingMesh: null,
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

  function displace(mesh, centerZ, yOffset = 0, xShift = 0, recomputeNormals = true) {
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
    if (recomputeNormals) mesh.geometry.computeVertexNormals();
  }

  function displaceShoulder(mesh, centerZ) {
    const pos = mesh.geometry.attributes.position;
    const bx = mesh.userData.baseX;
    const shoulderW = 2.6;
    for (let v = 0; v < pos.count; v++) {
      const lxWorld = bx ? bx[v] : pos.getX(v);
      const side = lxWorld < 0 ? -1 : 1;
      const baseEdge = side * (W / 2 + 1.3);
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
    const by = mesh.userData.baseY;
    for (let v = 0; v < pos.count; v++) {
      const wz = centerZ + pos.getZ(v);
      const lx = bx ? bx[v] : pos.getX(v);
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const h = getTrackHeight(wz) + lx * bank;
      const isTop = by ? by[v] > 0 : false;
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
    displaceBeveledRibbon(seg.loopBypassRoad, ribbonSteps, (t) => {
      const lz = L / 2 - t * L;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const h = getTrackHeight(wz);
      const lx = BYPASS_CENTER_X - BYPASS_HALF_W;
      const rx = BYPASS_CENTER_X + BYPASS_HALF_W;
      return { lx: cx + lx, rx: cx + rx, yL: h + lx * bank, yR: h + rx * bank, z: lz };
    });
    displaceRibbon(seg.loopBypassRailL, ribbonSteps, (t) => {
      const lz = L / 2 - t * L;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      const y = getTrackHeight(wz) + (BYPASS_CENTER_X - BYPASS_HALF_W) * bank;
      return { lx: cx + BYPASS_CENTER_X - BYPASS_HALF_W - 0.14, rx: cx + BYPASS_CENTER_X - BYPASS_HALF_W + 0.12, y: y + 0.42, z: lz };
    });
    displaceRibbon(seg.loopBypassRailR, ribbonSteps, (t) => {
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

    const maxCol = isEco ? MAX_COLLECTIBLES_ECO : MAX_COLLECTIBLES_HD;
    let cursor = 0;
    const placeItem = (kind, localOffsetX, lz, yOff, absY = null, absX = null) => {
      if (cursor >= maxCol) return;
      const slot = seg.collectibles[cursor++];
      ensureCollectibleMesh(slot, kind);
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
      if (slot.coinMesh) slot.coinMesh.visible = kind === 'coin';
      if (slot.gemMesh) slot.gemMesh.visible = kind === 'gem';
      if (slot.fruitMesh) slot.fruitMesh.visible = kind === 'fruit';
      if (slot.starRingMesh) slot.starRingMesh.visible = kind === 'ring';
      slot.obj.position.set(wx, slot.baseY, lz);
      slot.obj.rotation.y = getTrackYaw(wz);
      slot.obj.visible = true;

      if (absY === null && !isEco && (kind === 'fruit' || kind === 'gem')) {
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
      const bypassCount = isEco ? 1 : 5;
      for (let k = 0; k < bypassCount; k++) {
        placeItem('coin', BYPASS_CENTER_X, 8.0 - k * 4.0, 0.95);
      }
      return;
    }

    if (seg.type === 'fork') {
      const ts = isEco ? [0.22, 0.54, 0.82] : [0.22, 0.38, 0.54, 0.70, 0.82];
      ts.forEach((t, idx) => {
        const fp = getForkProfile(t);
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const kindL = idx === Math.floor(ts.length / 2) ? 'ring' : idx === ts.length - 1 ? 'gem' : 'fruit';
        const baseY = getTrackHeight(wz);
        placeItem(kindL, fp.cxL, lz, 0, baseY + fp.yOffL + (kindL === 'ring' ? 1.85 : 1.25));
        placeItem('coin', fp.cxR, lz, 0, baseY + 0.95);
      });
      return;
    }

    if (seg.type === 'narrow') {
      const nCount = isEco ? 4 : 6;
      for (let k = 0; k < nCount; k++) {
        const lz = 9.0 - k * (18.0 / Math.max(1, nCount - 1));
        const kind = k === 1 || k === nCount - 1 ? 'fruit' : 'coin';
        placeItem(kind, Math.sin(k * 0.9) * 0.85, lz, kind === 'fruit' ? 1.25 : 0.95);
      }
      return;
    }

    if (seg.type === 'ramp') {
      const rx = getRampSide(i) * RAMP_OFFSET;
      const sx = -rx;
      placeItem('coin', rx, 5.5, 0.95);
      const arcSteps = isEco ? [-0.8, -5.6, -10.4] : [-0.8, -3.2, -5.6, -8.0, -10.4];
      arcSteps.forEach((lz, idx) => {
        const u = (idx + 1) / arcSteps.length;
        const yOff = 1.65 + Math.sin(u * Math.PI * 0.58) * 3.2;
        const kind = idx === Math.floor(arcSteps.length / 2) ? 'ring' : idx === arcSteps.length - 1 ? 'gem' : 'coin';
        placeItem(kind, rx, lz, yOff);
      });
      placeItem('coin', sx, -4.5, 0.95);
      return;
    }

    if (prevType === 'ramp') {
      const rx = getRampSide(i - 1) * RAMP_OFFSET;
      const descSteps = isEco ? [10.4, 5.6, 0.8] : [10.4, 8.0, 5.6, 3.2, 0.8];
      descSteps.forEach((lz, idx) => {
        const u = idx / Math.max(1, descSteps.length - 1);
        const yOff = 4.4 - u * 3.35;
        placeItem(idx === descSteps.length - 1 ? 'fruit' : 'coin', rx, lz, yOff);
      });
      placeItem('coin', -rx * 0.6, -4.5, 0.95);
      return;
    }

    if (seg.type === 'boost') {
      const leadSide = hash(i * 19) > 0.5 ? 1 : -1;
      const bCount = isEco ? 3 : 5;
      for (let k = 0; k < bCount; k++) {
        const u = k / Math.max(1, bCount - 1);
        const lz = 10.2 - u * 8.2;
        const lx = leadSide * LANE_W * (1 - u);
        placeItem('coin', lx, lz, 0.95);
      }
      placeItem(i % 2 === 0 ? 'ring' : 'fruit', 0, -4.8, i % 2 === 0 ? 1.9 : 1.25);
      placeItem('coin', 0, -9.2, 0.95);
      return;
    }

    const dir = i % 2 === 0 ? 1 : -1;
    const count = isEco ? 4 : 6;
    for (let k = 0; k < count; k++) {
      const u = k / Math.max(1, count - 1);
      const lz = 9.8 - u * 19.6;
      const lx = Math.sin(u * Math.PI * 1.5) * dir * LANE_W * 0.95;
      const isGem = (i % 4 === 1) && k === Math.min(3, count - 1);
      const isFruit = !isGem && (k === 1 || k === count - 1);
      placeItem(isGem ? 'gem' : isFruit ? 'fruit' : 'coin', lx, lz, isGem || isFruit ? 1.25 : 0.95);
    }
  }

  function assignFoliageInstances(seg, i, centerZ) {
    seg.foliageLayout.grass.length = 0;
    seg.foliageLayout.flowers.length = 0;
    if (isEco) return;
    for (let k = 0; k < GRASS_PER_SEG; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const lz = -L / 2 + 1 + hash(i * 61 + k * 3) * (L - 2);
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const lx = cx + side * (W / 2 + 0.95 + hash(i * 71 + k) * 1.55);
      const ly = getTrackHeight(wz) + (lx - cx) * getTrackBank(wz) - 0.14;
      seg.foliageLayout.grass.push({
        x: lx, y: ly, lz,
        ry: hash(i * 43 + k) * Math.PI * 2,
        sc: 0.8 + hash(i * 83 + k) * 0.5,
        col: GRASS_SHADES[(i + k) % GRASS_SHADES.length],
      });
    }
    for (let k = 0; k < FLOWERS_PER_SEG; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const lz = -L / 2 + 1.5 + hash(i * 97 + k * 5) * (L - 3);
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const lx = cx + side * (W / 2 + 1.05 + hash(i * 101 + k) * 1.4);
      const ly = getTrackHeight(wz) + (lx - cx) * getTrackBank(wz) - 0.14;
      seg.foliageLayout.flowers.push({
        x: lx, y: ly, lz,
        ry: hash(i * 59 + k) * Math.PI * 2,
        sc: 0.85 + hash(i * 67 + k) * 0.45,
        col: FLOWER_SHADES[(i * 3 + k) % FLOWER_SHADES.length],
      });
    }
  }

  function assign(seg, i) {
    seg.index = i;
    seg.type = getSegmentType(i);
    const centerZ = -(i + 0.5) * L;
    seg.group.position.set(0, 0, centerZ);
    const midCx = getTrackCenterX(centerZ);
    const midYaw = getTrackYaw(centerZ);
    const midBank = getTrackBank(centerZ);

    seg.blocks.forEach((m, b) => {
      m.visible = !isEco;
      if (!m.visible) return;
      const side = (i + b) % 2 === 0 ? -1 : 1;
      const bx = side * (40 + hash(i * 31 + b) * 14);
      const bz = -L * 0.25 + (hash(i * 41 + b) - 0.5) * 8;
      const sc = 0.85 + hash(i * 53 + b) * 0.45;
      m.material = blockMats[Math.abs(i * 3 + b) % blockMats.length];
      m.scale.setScalar(sc);
      m.position.set(bx, FLOOR_Y + 2.3 * sc, bz);
      m.rotation.y = hash(i * 29 + b) * Math.PI * 0.5;
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
      displaceBeveledRibbon(seg.narrowRoad, ribbonSteps, (t) => {
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
      displaceBeveledRibbon(seg.forkLeftRoad, ribbonSteps, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        return { lx: cx + fp.cxL - fp.hwL, rx: cx + fp.cxL + fp.hwL, y: getTrackHeight(wz) + fp.yOffL, z: lz };
      });
      displaceBeveledRibbon(seg.forkRightRoad, ribbonSteps, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        return { lx: cx + fp.cxR - fp.hwR, rx: cx + fp.cxR + fp.hwR, y: getTrackHeight(wz) + fp.yOffR, z: lz };
      });
      displaceRibbon(seg.forkLeftRailL, ribbonSteps, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffL + 0.42;
        return { lx: cx + fp.cxL - fp.hwL - 0.14, rx: cx + fp.cxL - fp.hwL + 0.12, y, z: lz };
      });
      displaceRibbon(seg.forkLeftRailR, ribbonSteps, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffL + 0.42;
        return { lx: cx + fp.cxL + fp.hwL - 0.12, rx: cx + fp.cxL + fp.hwL + 0.14, y, z: lz };
      });
      displaceRibbon(seg.forkRightRailL, ribbonSteps, (t) => {
        const lz = L / 2 - t * L;
        const wz = centerZ + lz;
        const cx = getTrackCenterX(wz);
        const fp = getForkProfile(t);
        const y = getTrackHeight(wz) + fp.yOffR + 0.42;
        return { lx: cx + fp.cxR - fp.hwR - 0.14, rx: cx + fp.cxR - fp.hwR + 0.12, y, z: lz };
      });
      displaceRibbon(seg.forkRightRailR, ribbonSteps, (t) => {
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

    seg.shoulder.visible = isPlainDeck;
    if (isPlainDeck) displaceShoulder(seg.shoulder, centerZ);
    seg.skirt.visible = isPlainDeck;
    if (isPlainDeck) displaceSkirt(seg.skirt, centerZ);
    seg.edges.visible = isPlainDeck;
    if (isPlainDeck) displace(seg.edges, centerZ, 0.02, 0, false);

    const dl = seg.decorLayout;
    dl.dashes.length = 0;
    for (let k = 0; k < 6; k++) {
      const lz = -L / 2 + 2 + k * 4;
      if (isPlainDeck || (showRampDeck && (lz > RAMP_GAP_START || lz < RAMP_GAP_END))) {
        const wz = centerZ + lz;
        dl.dashes.push({
          x: getTrackCenterX(wz), y: getTrackHeight(wz) + 0.03, lz,
          pitch: Math.atan(-getTrackSlope(wz)), yaw: getTrackYaw(wz), bank: getTrackBank(wz),
        });
      }
    }

    /* Guardrail terinstansiasi (6/sisi di Normal, 3/sisi dengan scaleZ=2 di ECO) */
    seg.guardLayout.posts.length = 0;
    seg.guardLayout.beams.length = 0;
    const showGuards = isPlainDeck || showRampDeck;
    if (showGuards) {
      const guardCount = isEco ? 3 : 6;
      const guardStep = L / guardCount;
      const scaleZ = isEco ? 2 : 1;
      for (const side of [-1, 1]) {
        for (let k = 0; k < guardCount; k++) {
          const lz = -L / 2 + guardStep * 0.5 + k * guardStep;
          const inGapHere = showRampDeck && side === rampSide && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5;
          if (inGapHere) continue;
          const wz = centerZ + lz;
          const cx = getTrackCenterX(wz);
          const h = getTrackHeight(wz);
          const yaw = getTrackYaw(wz);
          const bank = getTrackBank(wz);
          const pitch = Math.atan(-getTrackSlope(wz));
          const px = side * (W / 2 + 0.32);
          seg.guardLayout.posts.push({ x: cx + px, y: h + px * bank + 0.44, lz, yaw });
          const bx = side * (W / 2 + 0.14);
          seg.guardLayout.beams.push({ x: cx + bx, y: h + bx * bank + 0.36, lz, pitch, yaw, bank, scaleZ });
        }
      }
    }

    {
      const seamZ = L / 2;
      const wz = centerZ + seamZ;
      dl.conn = {
        x: getTrackCenterX(wz), y: getTrackHeight(wz), lz: seamZ,
        pitch: Math.atan(-getTrackSlope(wz)), yaw: getTrackYaw(wz), bank: getTrackBank(wz),
      };
    }

    const roadMidY = getTrackHeight(centerZ);
    const pierH = Math.max(2, roadMidY - FLOOR_Y);
    dl.piers.length = 0;
    const showPiers = seg.type !== 'loop' && seg.type !== 'fork';
    if (showPiers) {
      for (const basePx of [-W / 2 + 1.8, W / 2 - 1.8]) {
        const px = midCx + (seg.type === 'narrow' ? basePx * 0.32 : basePx);
        dl.piers.push({ x: px, y: FLOOR_Y + pierH / 2, h: pierH });
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

    /* Rambu Start (i=0), Milestone 500m / 1000m (Normal) & Checkered FINISH ARCH 1500m */
    const isStartHere = i === 0;
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
    const showMilestone = isStartHere || isFinishHere || (!isEco && milestoneDist > 0);
    seg.milestoneArch.visible = showMilestone;
    if (showMilestone) {
      const wz = isStartHere ? -2.0 : -milestoneDist;
      const lz = wz - centerZ;
      seg.milestoneArch.position.set(getTrackCenterX(wz), getTrackHeight(wz), lz);
      seg.milestoneArch.rotation.order = 'YXZ';
      seg.milestoneArch.rotation.set(0, getTrackYaw(wz), getTrackBank(wz));
      const mMat = isStartHere
        ? matMilestoneStart
        : isFinishHere ? matMilestoneFinish : (milestoneDist % 1000 === 0 ? matMilestone1000 : matMilestone500);
      seg.mSignFront.material = mMat;
      seg.mSignBack.material = mMat;
      const showCheck = isStartHere || isFinishHere;
      seg.finishStripe.visible = showCheck;
      seg.finishStripe.rotation.x = -Math.PI / 2 - Math.atan(-getTrackSlope(wz));
      for (const fl of seg.finishFlags) fl.visible = showCheck;
    }

    seg.arch.visible = !isEco && !seg.milestoneArch.visible && i >= 4 && i % (TRACK.archEvery || 8) === 0 && seg.type !== 'loop';
    if (seg.arch.visible) {
      seg.arch.position.set(midCx, roadMidY, 0);
      seg.arch.rotation.set(0, midYaw, midBank);
    }

    /* Smashable props (kerucut & tumpukan barel) + Penghalang bahaya + Tanda Segitiga "!" */
    const LANE_W = W / TRACK.lanes;
    const propLaneIdx = Math.floor(hash(i * 37 + 11) * 3) % 3;
    const propLaneOff = (propLaneIdx - 1) * LANE_W;
    const showProps = (seg.type === 'plain' || seg.type === 'boost') && i >= 2 && (!isEco || i % 2 === 0);
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

    /* Papan Segitiga Merah "!" Mengambang */
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

    if (!isEco) {
      const side = i % 2 === 0 ? -1 : 1;
      const lz = side < 0 ? -L * 0.25 : L * 0.25;
      const wz = centerZ + lz;
      const off = side * (W / 2 + 0.72);
      dl.lamp = {
        x: getTrackCenterX(wz) + off,
        y: getTrackHeight(wz) + off * getTrackBank(wz),
        lz,
        ry: getTrackYaw(wz) + (side < 0 ? 0 : Math.PI),
      };
    } else {
      dl.lamp = null;
    }
    if (!isEco) {
      const side = hash(i * 17 + 1) > 0.5 ? 1 : -1;
      const lz = -L / 2 + 3 + hash(i * 23 + 1) * (L - 6);
      const off = side * (W / 2 + 19 + hash(i * 29 + 1) * 6);
      dl.bush = { x: midCx + off, y: FLOOR_Y, lz, ry: hash(i * 41) * Math.PI, sc: 0.95 + hash(i * 31 + 1) * 0.45 };
    } else {
      dl.bush = null;
    }
    if (!isEco) {
      const side = hash(i * 7) > 0.5 ? 1 : -1;
      const lz = -L / 2 + 4 + hash(i * 13) * (L - 8);
      const off = side * (W / 2 + 21 + hash(i * 17) * 8);
      dl.tree = { x: midCx + off, y: FLOOR_Y, lz, ry: hash(i * 19) * Math.PI, sc: 1.05 + hash(i * 23) * 0.55 };
    } else {
      dl.tree = null;
    }

    assignFoliageInstances(seg, i, centerZ);
    assignCollectibles(seg, i, centerZ);
  }

  for (let s = 0; s < POOL_SIZE; s++) pool.push(buildSegment());

  let prevTrackT = null;
  let lastCur = -999999;

  function rebuildSegmentGeometries() {
    for (const seg of pool) {
      const replaceGeo = (mesh, newGeo, storeBase = false) => {
        mesh.geometry.dispose();
        mesh.geometry = newGeo;
        if (storeBase) cacheBaseX(mesh);
      };
      replaceGeo(seg.road, makeRoadGeo(W, true, roadRows), true);
      replaceGeo(seg.shoulder, makeShoulderBlendPairGeo(roadRows), true);
      replaceGeo(seg.skirt, makeSkirtPairGeo(roadRows), true);
      replaceGeo(seg.edges, makeEdgesPairGeo(roadRows), true);
      replaceGeo(seg.narrowRoad, makeBeveledRibbonGeo(ribbonSteps));
      replaceGeo(seg.forkLeftRoad, makeBeveledRibbonGeo(ribbonSteps));
      replaceGeo(seg.forkRightRoad, makeBeveledRibbonGeo(ribbonSteps));
      replaceGeo(seg.forkLeftRailL, makeRibbonGridGeo(ribbonSteps));
      replaceGeo(seg.forkLeftRailR, makeRibbonGridGeo(ribbonSteps));
      replaceGeo(seg.forkRightRailL, makeRibbonGridGeo(ribbonSteps));
      replaceGeo(seg.forkRightRailR, makeRibbonGridGeo(ribbonSteps));
      replaceGeo(seg.loopBypassRoad, makeBeveledRibbonGeo(ribbonSteps));
      replaceGeo(seg.loopBypassRailL, makeRibbonGridGeo(ribbonSteps));
      replaceGeo(seg.loopBypassRailR, makeRibbonGridGeo(ribbonSteps));
    }
  }

  function setQuality(high) {
    const nextEco = !high;
    if (nextEco === isEco) return;
    isEco = nextEco;
    ribbonSteps = isEco ? RIBBON_STEPS_ECO : RIBBON_STEPS_HD;
    roadRows = isEco ? 6 : 14;
    guardPostInst.castShadow = !isEco;
    guardBeamInst.castShadow = !isEco;
    treeInst.visible = !isEco;
    bushInst.visible = !isEco;
    lampInst.visible = !isEco;
    lampHeadInst.visible = !isEco;
    grassGlobalInst.visible = !isEco;
    flowerGlobalInst.visible = !isEco;
    for (const seg of pool) {
      for (const blk of seg.blocks) blk.castShadow = !isEco;
    }
    rebuildSegmentGeometries();
    for (const seg of pool) {
      if (seg.index !== null) assign(seg, seg.index);
    }
    syncGuardrails();
  }

  /* ---------- Daur ulang segmen + animasi angin & kolektibel ---------- */
  function updateTrack(playerZ, t = 0) {
    windUniform.value = t;
    const dt = prevTrackT === null ? 0.016 : Math.min(0.05, Math.max(0, t - prevTrackT));
    prevTrackT = t;

    const cur = Math.floor(-playerZ / L);
    if (cur !== lastCur) {
      lastCur = cur;
      const min = cur - TRACK.segmentsBehind;
      const max = cur + TRACK.segmentsAhead;
      for (const seg of pool) {
        if (seg.index !== null && (seg.index < min || seg.index > max)) seg.index = null;
      }
      for (let i = min; i <= max; i++) {
        let already = false;
        for (const seg of pool) { if (seg.index === i) { already = true; break; } }
        if (already) continue;
        const free = pool.find((s) => s.index === null);
        if (free) assign(free, i);
      }
      syncGuardrails();
    }

    floorMesh.position.set(getTrackCenterX(playerZ), FLOOR_Y, playerZ - 110);

    const gemHue = (t * 0.55) % 1;
    matGemShared.color.setHSL(gemHue, 0.92, 0.62);
    matGemShared.emissive.setHSL(gemHue, 0.95, 0.52);

    const maxSegVis = cur + (isEco ? 5 : 8);
    const maxColVis = cur + (isEco ? 3 : 5);

    for (const seg of pool) {
      if (seg.index === null) { seg.group.visible = false; continue; }
      const segVis = seg.index >= cur - 1 && seg.index <= maxSegVis;
      seg.group.visible = segVis;
      if (!segVis) continue;
      const colVis = seg.index <= maxColVis;

      for (const p of seg.smashProps) {
        if (!p.active) continue;
        if (!p.hit) {
          p.mesh.visible = colVis;
          continue;
        }
        if (!p.mesh.visible) continue;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 28 * dt;
        p.mesh.rotation.x += p.rvx * dt;
        p.mesh.rotation.z += p.rvz * dt;
        if (p.mesh.position.y < FLOOR_Y - 6) p.mesh.visible = false;
      }

      if (seg.hazard.active) {
        const hz = seg.hazard;
        if (!hz.hit) {
          hz.mesh.visible = colVis;
        } else if (hz.mesh.visible) {
          hz.mesh.position.x += hz.vx * dt;
          hz.mesh.position.y += hz.vy * dt;
          hz.mesh.position.z += hz.vz * dt;
          hz.vy -= 30 * dt;
          hz.mesh.rotation.x += hz.rvx * dt;
          hz.mesh.rotation.z += hz.rvz * dt;
          if (hz.mesh.position.y < FLOOR_Y - 6) hz.mesh.visible = false;
        }
      }

      if (seg.warnSign?.active) {
        seg.warnSign.mesh.visible = colVis;
        if (colVis) seg.warnSign.mesh.position.y = seg.warnSign.baseY + Math.sin(t * 5.2 + seg.warnSign.phase) * 0.18;
      }

      if (seg.boost.visible) {
        for (const bw of seg.boosterWheels) {
          bw.mesh.rotation.x = -t * 22;
        }
      }

      for (const item of seg.collectibles) {
        if (!item.active || item.collected) {
          item.obj.visible = false;
          item.groundRing.visible = false;
          continue;
        }
        item.obj.visible = colVis;
        item.groundRing.visible = colVis && !isEco && (item.kind === 'fruit' || item.kind === 'gem');
        if (!colVis) continue;
        item.obj.position.y = item.baseY + Math.sin(t * 3.6 + item.phase) * 0.18;
        if (item.kind === 'coin' && item.coinMesh) {
          item.coinMesh.rotation.y = t * 3.4 + item.phase;
        } else if (item.kind === 'gem' && item.gemMesh) {
          item.gemMesh.rotation.y = t * 2.8 + item.phase;
          item.gemMesh.rotation.z = Math.sin(t * 2.2 + item.phase) * 0.22;
          if (!isEco) item.groundRing.scale.setScalar(0.92 + Math.sin(t * 4.5 + item.phase) * 0.14);
        } else if (item.kind === 'ring' && item.starRingMesh) {
          item.starRingMesh.rotation.z = t * 3.2 + item.phase;
          item.starRingMesh.rotation.y = Math.sin(t * 1.6 + item.phase) * 0.18;
        } else if (item.fruitMesh) {
          item.fruitMesh.rotation.y = t * 2.4 + item.phase;
          item.fruitMesh.rotation.z = Math.sin(t * 1.9 + item.phase) * 0.1;
          if (!isEco) item.groundRing.scale.setScalar(0.95 + Math.sin(t * 4.2 + item.phase) * 0.16);
        }
      }
    }

    matBoost.emissiveIntensity = 0.5 + Math.sin(t * 4) * 0.3;
    matChevron.emissiveIntensity = 0.35 + Math.sin(t * 4 + 1) * 0.2;
    matBeaconRed.emissiveIntensity = 1.0 + Math.sin(t * 12) * 0.7;
    matBeaconBlue.emissiveIntensity = 1.0 - Math.sin(t * 12) * 0.7;
  }

  /* ---------- Deteksi pengambilan koin, buah, permata & Star Ring (zero-GC) ---------- */
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
          item.groundRing.visible = !isEco && (item.kind === 'fruit' || item.kind === 'gem');
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
    [
      floorMesh, guardPostInst, guardBeamInst, dashInst, connectorInst,
      pierInst, treeInst, bushInst, lampInst, lampHeadInst,
      grassGlobalInst, flowerGlobalInst,
    ].forEach((m) => { scene.remove(m); if (m.dispose) m.dispose(); });
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
      seg.shoulder.geometry.dispose();
      seg.skirt.geometry.dispose();
      seg.edges.geometry.dispose();
    }
    [
      geoDash, geoRamp, geoRampRail, geoRampStripe, geoRampLipHazard, geoBoost, geoChevron,
      geoBoosterHousing, geoBoosterWheel, geoBoosterHub, geoBoosterRing, geoConnectorBar, geoConnectorEar,
      geoConnectorMerged, geoStarRingTorus, geoStarPoint, geoStarRingMerged, geoConeBody, geoConeBase, geoConeCollar, geoConeMerged,
      geoBarrelBody, geoBarrelBand, geoBarrelStackMerged, geoHazardBody, geoHazardSign, geoHazardBeacon, geoHazardFrameMerged,
      geoGapCap, geoLoopStrut, geoForkSignPost, geoForkSignBoard, geoLoopArrow, geoLoopSignBoard,
      geoPillar, geoGuardPost, geoGuardBeam,
      geoTrunk, geoCanopy, geoTreeMerged, geoBushLobe, geoBushMerged, geoBerry,
      geoPlantShadow, geoGrassTuft, geoFlower, geoLampBase, geoLampPole,
      geoLampArm, geoLampHead, geoLampPoleMerged, geoFloor, geoBlock,
      geoArchPillar, geoArchLightBar, geoArchBeam, geoArchSign, geoArchBulb, geoBunting,
      geoFinishStripe, geoFinishFlagPole, geoFinishFlagCloth, geoWarnPost, geoWarnBoard,
      geoCoinBody, geoCoinRim, geoCoinCore, geoCoinMerged, geoGemStar, geoGemStarMerged, geoGemRing, geoGlowRing,
      geoRampRailsMerged, geoRampStripesMerged, geoBoostChevronsMerged, geoBoostHousingsMerged,
      geoBoostRingsMerged, geoBoosterWheelMerged, geoArchFrameMerged, geoArchLightBarsMerged,
      geoArchBulbsMerged, geoArchSignsMerged, geoMilestoneFrameMerged, geoFinishFlagPolesMerged,
      geoFinishFlagClothsMerged, geoHazardSignsMerged, geoLoopSignPostsMerged,
    ].forEach((g) => g.dispose());
    [
      matAsphalt, matForkLeft, matLoopSurface, matGapCap, matForkSign, matHazardStripe,
      matStarRing, matConeOrange, matConeWhite, matBarrelRed, matBarrelGrey, matBarrelYellow,
      matHazardBarrierSign, matWarnSign, matBeaconRed, matBeaconBlue,
      matShoulderBlend, matDeckSide, matCurb, matLine, matConnectorBlue,
      matRamp, matRampStripe, matBoost, matChevron, matBoosterWheel, matBoosterHub,
      matPillar, matPillarGlow,
      matRailOrange, matRailGlow, matLoopArrow, matLoopSign,
      matTrunk, matLeaf1, matLeaf2, matLeaf3, matBushEmerald, matBushPurple,
      matBerry, matGrassTuft, matFlower, matPlantShadow, matLampPole,
      matLampCollar, matLampHead, matFloor, ...blockMats, matArchBanner,
      matMilestoneStart, matMilestone500, matMilestone1000, matMilestoneFinish, matCheckeredStripe,
      matArchBlue, matArchGold, matCoinGold,
      matCoinRim, matCoinMerged, matDecorVertex, matPropsVertex, matGemShared, matGemHalo, ...Object.values(ringMats),
    ].forEach((m) => m.dispose());
    [
      matAsphalt.map, plantShadowTex, glowRingTex, forkSignTex,
      loopArrowTex, loopSignTex, hazardStripeTex, warnBarrierTex, warnTriangleTex, rampChevronTex,
      ...blockTextures, startBannerTex, archBannerTex, milestone500Tex, milestone1000Tex, finishBannerTex, checkeredStripeTex,
    ].forEach((t) => t?.dispose());
    pool.length = 0;
  }

  return {
    updateTrack, collectNearby, checkPropSmash, checkHazardCollision, getUpcomingHazards,
    getCollectibleTargets, resetCollectibles, setQuality, dispose,
    getTrackHeight, getTrackSlope, getTrackCenterX, getTrackYaw, getTrackBank, getRampSide,
    getTrackSurfaceAt, evalLoopPose, checkRampCollision, checkBoostCollision, getSegmentType,
    get segmentCount() { return pool.length; },
  };
}
