/* =====================================================================
   fantasyTrack.js — Arena 2: Nusantara Skyway (Dunia Fantasi Bertingkat)
   Trek Hot Wheels multi-level di atas samudra biru & pulau tropis:
   - Start/Finish grid extra-lebar (W_START = 22) + gerbang obor api
   - Upper Level: Skyway oranye tinggi, tikungan miring kuning lemon,
     boost biru-hijau menyala, loop 360° + bypass, ramp lompat, &
     Terowongan Garuda/Naga Emas Mekanik berisi bola energi merah
   - Lower Level: Coastal Boulevard di bawah jembatan layang oranye-kuning
   - Optimasi WebGL: THREE.InstancedMesh untuk tiang rel, rambu panah,
     menara truss baja, pulau, dan pohon palem (60 FPS).
   ===================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TRACK, PHYSICS, PALETTE as P } from '../config/gameConfig.js';
import { FRUIT_TYPES, buildToyFruit } from '../entities/assetFactory.js';

const L = TRACK.segmentLength; // 24
const W = 17.0;
const W_START = 22.0;
const W_BANK = 20.0;
export const SKYWAY_FLOOR_Y = -14.0;
const START_Y = 5.5;
const UPPER_Y = 11.5;
const LOWER_Y = -0.8;

const RAMP_W = 7.4;
const RAMP_LEN = 5.2;
const RAMP_RISE = 1.75;
const RAMP_OFFSET = 4.2;
const RAMP_SAFE_W = 8.2;
const RAMP_GAP_START = -3.3;
const RAMP_GAP_END = -10.5;
const BOOST_W = 6.2;
const BOOST_LEN = 4.2;

export const LOOP_RADIUS = TRACK.loopRadius ?? 7.8;
export const LOOP_HALF_W = (TRACK.loopWidth ?? 6.2) * 0.5;
export const LOOP_CENTER_X = -4.2;
export const BYPASS_CENTER_X = 4.2;
export const BYPASS_HALF_W = 3.8;
const LOOP_HELIX = 1.35;
export const LOOP_ARC_LEN = Math.PI * 2 * LOOP_RADIUS + 14;
const LOOP_STEPS = 44;
const FORK_HALF_L = 3.6;
const FORK_HALF_R = 4.4;
const RIBBON_STEPS = 16;
const MAX_COLLECTIBLES = 14;

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ---------- Pola Segmen Nusantara Skyway ---------- */
export function getSegmentKind(i) {
  if (i <= 1) return 'start';
  if (i === 2) return 'climbStart';
  if (i === 61) return 'plain';
  if (i === 62 || i === 63) return 'finish';
  const m = (((i - 3) % 14) + 14) % 14;
  switch (m) {
    case 0: return 'ramp';
    case 1: return 'banked';
    case 2: return 'boost';
    case 3: return 'skullTunnel';
    case 4: return 'loop';
    case 5: return 'descent';
    case 6: return 'underpass';
    case 7: return 'boost';
    case 8: return 'underpass';
    case 9: return 'banked';
    case 10: return 'ascent';
    case 11: return 'fork';
    case 12: return 'ramp';
    default: return 'plain';
  }
}

export function getSegmentType(i) {
  const k = getSegmentKind(i);
  if (k === 'start' || k === 'climbStart' || k === 'finish' || k === 'descent' || k === 'ascent') return 'plain';
  return k;
}

export function getRampSide(i) {
  return (Math.abs(i) % 2 === 0) ? -1 : 1;
}

function getSegmentElevationSpan(i) {
  if (i <= 1) return [START_Y, START_Y, 'start'];
  if (i === 2) return [START_Y, UPPER_Y, 'trans'];
  if (i >= 61 && i <= 63) return [UPPER_Y, UPPER_Y, 'upper'];
  const m = (((i - 3) % 14) + 14) % 14;
  if (m === 5) return [UPPER_Y, LOWER_Y, 'trans'];
  if (m >= 6 && m <= 9) return [LOWER_Y, LOWER_Y, 'lower'];
  if (m === 10) return [LOWER_Y, UPPER_Y, 'trans'];
  return [UPPER_Y, UPPER_Y, 'upper'];
}

export function getTrackCenterX(z) {
  const dist = Math.max(0, -z);
  const startZ = 72;
  const rampZ = 144;
  if (dist <= startZ) return 0;
  return 6.4 * smoothstep(startZ, rampZ, dist) * Math.sin(dist * 0.0115);
}

export function getTrackSlopeX(z) {
  const e = 0.5;
  return (getTrackCenterX(z - e) - getTrackCenterX(z + e)) / (2 * e);
}

export function getTrackYaw(z) {
  return -Math.atan(getTrackSlopeX(z));
}

export function getTrackBank(z) {
  const dist = Math.max(0, -z);
  if (dist <= 72) return 0;
  const i = Math.floor(dist / L);
  const kind = getSegmentKind(i);
  const t = Math.min(1, Math.max(0, (dist - i * L) / L));
  let fade = 1;
  if (kind === 'fork' || kind === 'loop') {
    fade = 1 - smoothstep(0.0, 0.18, t) * (1 - smoothstep(0.82, 1.0, t));
  }
  const curve = Math.sin(dist * 0.0115);
  const bankGain = kind === 'banked'
    ? 0.045 + 0.085 * smoothstep(0.04, 0.28, t) * (1 - smoothstep(0.72, 0.96, t))
    : 0.042;
  return bankGain * fade * smoothstep(72, 144, dist) * curve;
}

export function getTrackHeight(z) {
  const dist = Math.max(0, -z);
  const i = Math.floor(dist / L);
  const t = Math.min(1, Math.max(0, (dist - i * L) / L));
  const [y0, y1] = getSegmentElevationSpan(i);
  const base = y0 + (y1 - y0) * smoothstep(0, 1, t);
  const wave = 0.42 * Math.sin(dist * 0.022) * smoothstep(48, 96, dist);
  return base + wave;
}

export function getTrackSlope(z) {
  const e = 0.45;
  return (getTrackHeight(z + e) - getTrackHeight(z - e)) / (2 * e);
}

export function getHalfWidthAt(i, t) {
  const kind = getSegmentKind(i);
  if (kind === 'start' || kind === 'finish') return W_START * 0.5;
  if (kind === 'climbStart') return THREE.MathUtils.lerp(W_START * 0.5, W * 0.5, smoothstep(0.05, 0.92, t));
  if (kind === 'banked') {
    const bell = smoothstep(0.04, 0.28, t) * (1 - smoothstep(0.72, 0.96, t));
    return THREE.MathUtils.lerp(W * 0.5, W_BANK * 0.5, bell);
  }
  return W * 0.5;
}

export function getForkProfile(t) {
  const split = smoothstep(0.05, 0.24, t) * (1 - smoothstep(0.76, 0.95, t));
  return {
    split,
    cxL: -6.2 * split,
    hwL: THREE.MathUtils.lerp(W * 0.5, FORK_HALF_L, split),
    yOffL: 4.6 * split,
    cxR: 3.4 * split,
    hwR: THREE.MathUtils.lerp(W * 0.5, FORK_HALF_R, split),
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
  const spanZ = zEnd - zStart;
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

export function getTrackSurfaceAt(x, z) {
  const dist = Math.max(0, -z);
  const i = Math.floor(dist / L);
  const kind = getSegmentKind(i);
  const type = getSegmentType(i);
  const z0 = -i * L;
  const t = Math.min(1, Math.max(0, (z0 - z) / L));
  const centerZ = -(i + 0.5) * L;
  const lz = z - centerZ;
  const cx = getTrackCenterX(z);
  const bank = getTrackBank(z);
  const lx = x - cx;
  const baseY = getTrackHeight(z);
  const slope = getTrackSlope(z);
  const hw = getHalfWidthAt(i, t);

  if (kind === 'fork') {
    const fp = getForkProfile(t);
    if (fp.split < 0.22) {
      const onTrack = Math.abs(lx) <= hw + 0.35;
      return { type, segIndex: i, t, onTrack, groundY: baseY + lx * bank, slope, bank, centerX: cx, safeCenterX: cx, safeHalfW: hw, inGap: !onTrack, hasGuardrails: false };
    }
    const onLeft = Math.abs(lx - fp.cxL) <= fp.hwL + 0.28;
    const onRight = Math.abs(lx - fp.cxR) <= fp.hwR + 0.28;
    const onTrack = onLeft || onRight;
    const nearLeft = Math.abs(lx - fp.cxL) <= Math.abs(lx - fp.cxR);
    return {
      type, segIndex: i, t, onTrack,
      groundY: baseY + (onLeft ? fp.yOffL : 0),
      slope, bank: 0, centerX: cx,
      safeCenterX: cx + (nearLeft ? fp.cxL : fp.cxR),
      safeHalfW: nearLeft ? fp.hwL : fp.hwR,
      inGap: !onTrack, hasGuardrails: false,
    };
  }

  if (kind === 'ramp') {
    const rampSide = getRampSide(i);
    const onGapSide = (lx * rampSide) > -0.15;
    const inChasm = onGapSide && lz <= RAMP_GAP_START && lz >= RAMP_GAP_END;
    const onTrack = !inChasm && Math.abs(lx) <= hw + 0.45;
    return {
      type, segIndex: i, t, onTrack,
      groundY: baseY + lx * bank,
      slope, bank, centerX: cx,
      safeCenterX: cx + (inChasm ? -rampSide * RAMP_OFFSET : 0),
      safeHalfW: inChasm ? RAMP_SAFE_W * 0.48 : hw,
      inGap: inChasm || !onTrack,
      hasGuardrails: !inChasm,
      rampSide,
    };
  }

  if (kind === 'loop') {
    const onEntryExit = t < 0.08 || t > 0.92;
    const onLoop = Math.abs(lx - LOOP_CENTER_X) <= LOOP_HALF_W + 0.45;
    const onBypass = Math.abs(lx - BYPASS_CENTER_X) <= BYPASS_HALF_W + 0.45;
    const onTrack = onEntryExit ? Math.abs(lx) <= hw + 0.5 : (onLoop || onBypass);
    const nearLoop = lx < 0;
    return {
      type, segIndex: i, t, onTrack,
      groundY: baseY + lx * bank,
      slope, bank, centerX: cx,
      safeCenterX: cx + (nearLoop ? LOOP_CENTER_X : BYPASS_CENTER_X),
      safeHalfW: nearLoop ? LOOP_HALF_W : BYPASS_HALF_W,
      inGap: !onTrack, hasGuardrails: true,
    };
  }

  return {
    type, segIndex: i, t,
    onTrack: Math.abs(lx) <= hw + 0.5,
    groundY: baseY + lx * bank,
    slope, bank, centerX: cx, safeCenterX: cx, safeHalfW: hw,
    inGap: false, hasGuardrails: true,
  };
}

export function checkRampCollision(x, z) {
  const i = Math.floor(-z / L);
  if (getSegmentKind(i) !== 'ramp') return null;
  const zc = -(i + 0.5) * L;
  const rx = getTrackCenterX(zc) + getRampSide(i) * RAMP_OFFSET;
  if (Math.abs(z - zc) < RAMP_LEN / 2 && Math.abs(x - rx) < RAMP_W / 2) {
    return { z: zc, x: rx, width: RAMP_W, launchVy: PHYSICS.ramp.launchVy, topY: getTrackHeight(zc) + RAMP_RISE };
  }
  return null;
}

export function checkBoostCollision(x, z) {
  const i = Math.floor(-z / L);
  const kind = getSegmentKind(i);
  if (kind === 'boost') {
    const zc = -(i + 0.5) * L;
    const bx = getTrackCenterX(zc);
    if (Math.abs(z - zc) < BOOST_LEN / 2 + 1.0 && Math.abs(x - bx) < BOOST_W / 2) {
      return { z: zc, x: bx, width: BOOST_W };
    }
  } else if (kind === 'loop') {
    const zEntry = -i * L - 2.2;
    const bx = getTrackCenterX(zEntry) + LOOP_CENTER_X;
    if (Math.abs(z - zEntry) < 2.2 && Math.abs(x - bx) < LOOP_HALF_W) {
      return { z: zEntry, x: bx, width: LOOP_HALF_W * 2 };
    }
  }
  return null;
}

/* ==================== Texture Helpers ==================== */
function makeOrangeTrackTex() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#d95300');
  grad.addColorStop(0.06, '#ff6b00');
  grad.addColorStop(0.5, '#ff8024');
  grad.addColorStop(0.94, '#ff6b00');
  grad.addColorStop(1, '#d95300');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);

  g.fillStyle = 'rgba(255,245,220,0.16)';
  g.fillRect(size * 0.48, 0, size * 0.04, size);
  for (const gx of [0.22, 0.44, 0.56, 0.78]) {
    g.fillStyle = 'rgba(155, 48, 0, 0.22)';
    g.fillRect(size * gx, 0, 4, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.anisotropy = 4;
  return tex;
}

function makeYellowBankTex() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#eab308');
  grad.addColorStop(0.08, '#ffd60a');
  grad.addColorStop(0.5, '#ffe44d');
  grad.addColorStop(0.92, '#ffd60a');
  grad.addColorStop(1, '#eab308');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);

  // Crisp bright orange edge stripes + subtle speed grooves
  g.fillStyle = '#ff6b00';
  g.fillRect(10, 0, 14, size);
  g.fillRect(size - 24, 0, 14, size);
  for (const gx of [0.22, 0.36, 0.64, 0.78]) {
    g.fillStyle = 'rgba(180, 110, 0, 0.2)';
    g.fillRect(size * gx, 0, 4, size);
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.38)';
  g.fillRect(size * 0.49, 0, 6, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.anisotropy = 4;
  return tex;
}

function makeBlueBoostTrackTex() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#0055cc');
  grad.addColorStop(0.14, '#0077ff');
  grad.addColorStop(0.5, '#38bdf8');
  grad.addColorStop(0.86, '#0077ff');
  grad.addColorStop(1, '#0055cc');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(34, 197, 94, 0.34)';
  g.fillRect(size * 0.25, 0, size * 0.5, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.anisotropy = 4;
  return tex;
}

function makeOceanTex() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#06b6d4');
  grad.addColorStop(0.5, '#22d3ee');
  grad.addColorStop(1, '#0ea5e9');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);

  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 4;
  for (let y = 24; y < size; y += 64) {
    g.beginPath();
    for (let x = 0; x <= size; x += 32) {
      const wy = y + Math.sin((x / size) * Math.PI * 4) * 7;
      if (x === 0) g.moveTo(x, wy);
      else g.lineTo(x, wy);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);
  tex.anisotropy = 4;
  return tex;
}

function makeBannerTex(text, c0, c1, border = '#ffd100', checkered = false) {
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
    for (let x = 22; x < 120; x += sq) {
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
  g.font = '700 50px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeChevronSignTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd100';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#18181b';
  g.lineWidth = 26;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(64, 48); g.lineTo(188, 128); g.lineTo(64, 208);
  g.stroke();
  g.strokeStyle = '#ff6b00';
  g.lineWidth = 12;
  g.strokeRect(8, 8, 240, 240);
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
  g.moveTo(128, 22); g.lineTo(234, 218); g.lineTo(22, 218);
  g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = '#b91c1c';
  g.beginPath();
  g.moveTo(128, 56); g.lineTo(198, 192); g.lineTo(58, 192);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '700 108px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', 128, 145);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
  return tex;
}

function makeRampChevronTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ff4d00';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 22; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let y = 52; y <= 212; y += 72) {
    g.beginPath();
    g.moveTo(48, y + 34); g.lineTo(128, y - 18); g.lineTo(208, y + 34);
    g.stroke();
  }
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
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHazardStripeTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffbe0b'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#18181b';
  for (let x = -64; x < 320; x += 36) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 18, 0); g.lineTo(x + 42, 64); g.lineTo(x + 24, 64);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

/* =====================================================================
   createFantasyTrack(scene)
   ===================================================================== */
export function createFantasyTrack(scene, { maxAnisotropy = 8 } = {}) {
  const tuneTex = (tex) => {
    if (!tex) return tex;
    tex.anisotropy = maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };

  const texOrange = tuneTex(makeOrangeTrackTex());
  const texYellow = tuneTex(makeYellowBankTex());
  const texBlue = tuneTex(makeBlueBoostTrackTex());
  const texOcean = tuneTex(makeOceanTex());
  const texStartBanner = tuneTex(makeBannerTex('🔥 NUSANTARA SKYWAY • GRAND PRIX 🔥', '#0055cc', '#ff6b00', '#ffd100', true));
  const texFinishBanner = tuneTex(makeBannerTex('🏁 FINISH LINE • 1500M SKYWAY 🏁', '#18181b', '#d90429', '#ffbe0b', true));
  const texChevronSign = tuneTex(makeChevronSignTex());
  const texWarn = tuneTex(makeWarnTriangleTex());
  const texCheckered = tuneTex(makeCheckeredStripeTex());
  const texRampChev = tuneTex(makeRampChevronTex());
  const texGlowRing = tuneTex(makeGlowRingTex());
  const texHazard = tuneTex(makeHazardStripeTex());

  const matSkyOrange = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texOrange, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matBankYellow = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texYellow, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matBoostBlue = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texBlue, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matDeckSide = new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.36, metalness: 0.08, side: THREE.DoubleSide });
  const matRailBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matRailOrange = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matConnectorBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.34, metalness: 0.08, emissive: '#0044aa', emissiveIntensity: 0.14 });
  const matOcean = new THREE.MeshStandardMaterial({ map: texOcean, roughness: 0.26, metalness: 0.16 });
  const matGreenBoost = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#16a34a', emissiveIntensity: 0.9, roughness: 0.26 });
  const matBoosterWheel = new THREE.MeshStandardMaterial({ color: '#ffd100', emissive: '#ffaa00', emissiveIntensity: 0.26, roughness: 0.36, metalness: 0.08 });
  const matRamp = new THREE.MeshStandardMaterial({ map: texRampChev, emissive: '#ff3b00', emissiveMap: texRampChev, emissiveIntensity: 0.22, roughness: 0.36, metalness: 0.08 });
  const matHazardStripe = new THREE.MeshStandardMaterial({ map: texHazard, roughness: 0.36, metalness: 0.08, emissive: '#ffbe0b', emissiveIntensity: 0.16 });
  const matStartBanner = new THREE.MeshStandardMaterial({ map: texStartBanner, emissive: '#ffffff', emissiveMap: texStartBanner, emissiveIntensity: 0.25, roughness: 0.4 });
  const matFinishBanner = new THREE.MeshStandardMaterial({ map: texFinishBanner, emissive: '#ffffff', emissiveMap: texFinishBanner, emissiveIntensity: 0.25, roughness: 0.4 });
  const matCheckered = new THREE.MeshStandardMaterial({ map: texCheckered, roughness: 0.36, metalness: 0.06 });
  const matArchBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.36, metalness: 0.08 });
  const matArchRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.36, metalness: 0.08 });
  const matArchOrange = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.36, metalness: 0.08 });
  const matFlameTorch = new THREE.MeshStandardMaterial({ color: '#ffbe0b', emissive: '#ff5400', emissiveIntensity: 1.4, roughness: 0.2 });

  // Golden Mechanical Garuda / Dragon Skull Tunnel Materials
  const matGarudaGold = new THREE.MeshStandardMaterial({
    color: '#fbbf24', metalness: 0.72, roughness: 0.24, emissive: '#b45309', emissiveIntensity: 0.16,
  });
  const matGarudaBronze = new THREE.MeshStandardMaterial({
    color: '#92400e', metalness: 0.65, roughness: 0.35,
  });
  const matGarudaEye = new THREE.MeshStandardMaterial({
    color: '#ff2a4b', emissive: '#ff0033', emissiveIntensity: 1.8, roughness: 0.18,
  });
  const matEnergyOrb = new THREE.MeshStandardMaterial({
    color: '#ff2a4b', emissive: '#ef4444', emissiveIntensity: 1.65, roughness: 0.15, metalness: 0.2,
  });
  const matEnergyRing = new THREE.MeshBasicMaterial({
    color: '#fca5a5', transparent: true, opacity: 0.85,
  });
  const matWarnSign = new THREE.MeshStandardMaterial({
    map: texWarn, transparent: true, alphaTest: 0.15, side: THREE.DoubleSide,
    emissive: '#ff2a4b', emissiveMap: texWarn, emissiveIntensity: 0.6, roughness: 0.28,
  });

  // Collectibles & Fire Rings
  const matCoinGold = new THREE.MeshPhysicalMaterial({ color: P.coinGold, metalness: 0.86, roughness: 0.16, clearcoat: 0.85, emissive: '#fb8500', emissiveIntensity: 0.24 });
  const matCoinRim = new THREE.MeshPhysicalMaterial({ color: P.coinGoldRim, metalness: 0.88, roughness: 0.2, clearcoat: 0.85, emissive: '#f77f00', emissiveIntensity: 0.18 });
  const matGemHalo = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.5, roughness: 0.2, emissive: '#ffbe0b', emissiveIntensity: 0.55 });
  const matFireRing = new THREE.MeshPhysicalMaterial({ color: '#ffbe0b', roughness: 0.14, metalness: 0.65, clearcoat: 1.0, emissive: '#ff5400', emissiveIntensity: 0.88 });
  const matFireFlame = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.3, emissive: '#ff9500', emissiveIntensity: 1.15 });
  const ringMats = {
    strawberry: new THREE.MeshBasicMaterial({ map: texGlowRing, color: '#ff4d6d', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    melon: new THREE.MeshBasicMaterial({ map: texGlowRing, color: '#2ec4b6', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    banana: new THREE.MeshBasicMaterial({ map: texGlowRing, color: '#ffe135', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    orange: new THREE.MeshBasicMaterial({ map: texGlowRing, color: '#fb5607', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    gem: new THREE.MeshBasicMaterial({ map: texGlowRing, color: '#ffbe0b', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };

  // InstancedMesh shared materials
  const matTrussSteel = new THREE.MeshStandardMaterial({ color: '#1d4ed8', metalness: 0.42, roughness: 0.34 });
  const matChevronSign = new THREE.MeshStandardMaterial({ map: texChevronSign, roughness: 0.28, emissive: '#ffd100', emissiveMap: texChevronSign, emissiveIntensity: 0.22 });
  const matIslandSand = new THREE.MeshStandardMaterial({ color: '#fde68a', roughness: 0.85 });
  const matIslandLush = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.72 });
  const matPalmTrunk = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.8 });
  const matPalmCrown = new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.65 });
  const matPostBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.36, metalness: 0.08 });
  const matPostOrange = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.36, metalness: 0.08 });
  const matPropBarrelRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.36, metalness: 0.08 });
  const matPropBarrelYellow = new THREE.MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.36, metalness: 0.08 });

  /* ---------- Geometries ---------- */
  const geoOcean = new THREE.PlaneGeometry(340, L); geoOcean.rotateX(-Math.PI / 2);
  const geoDash = new THREE.BoxGeometry(0.26, 0.03, 1.9);
  const geoConnectorBar = new RoundedBoxGeometry(W + 1.5, 0.38, 1.2, 2, 0.08);
  const geoRamp = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(-RAMP_LEN * 0.5, 0);
    shape.lineTo(RAMP_LEN * 0.5, 0);
    shape.lineTo(RAMP_LEN * 0.5, RAMP_RISE);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: RAMP_W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    g.center(); g.rotateY(Math.PI / 2);
    return g;
  })();
  const geoRampLip = new RoundedBoxGeometry(RAMP_W + 0.28, 0.34, 0.78, 2, 0.08);
  const geoBoostPad = new RoundedBoxGeometry(BOOST_W, 0.14, BOOST_LEN + 2.2, 3, 0.06);
  const geoGreenChev = new RoundedBoxGeometry(3.8, 0.09, 0.55, 2, 0.03);
  const geoBoosterHousing = new RoundedBoxGeometry(1.35, 1.32, BOOST_LEN + 1.6, 3, 0.2);
  const geoBoosterWheel = new THREE.CylinderGeometry(1.02, 1.02, 0.46, 14); geoBoosterWheel.rotateZ(Math.PI / 2);
  const geoOrb = new THREE.SphereGeometry(1.02, 16, 12);
  const geoOrbRing = new THREE.TorusGeometry(1.32, 0.11, 8, 24);
  const geoWarnPost = new THREE.CylinderGeometry(0.08, 0.11, 2.2, 8);
  const geoWarnBoard = new THREE.PlaneGeometry(2.15, 2.15);
  const geoBarrelBody = new THREE.CylinderGeometry(0.54, 0.54, 1.25, 12);
  const geoBarrelBand = new THREE.CylinderGeometry(0.56, 0.56, 0.32, 12);

  // Arch geometries
  const geoArchPillar = new RoundedBoxGeometry(1.5, 14.5, 1.5, 3, 0.18);
  const geoArchBeam = new RoundedBoxGeometry(W_START + 4.0, 1.9, 1.6, 3, 0.24);
  const geoArchBanner = new THREE.PlaneGeometry(W_START + 1.6, 2.6);
  const geoFlameJet = new THREE.ConeGeometry(0.62, 2.1, 8);
  const geoCheckStripe = new THREE.PlaneGeometry(W_START - 0.8, 3.2); geoCheckStripe.rotateX(-Math.PI / 2);

  // Overhead skyway bridge geometry (for underpass segments)
  const geoOverpassDeck = new RoundedBoxGeometry(58, 1.1, 7.6, 2, 0.18);
  const geoOverpassRail = new RoundedBoxGeometry(58, 0.65, 0.4, 2, 0.08);
  const geoOverpassPier = new THREE.BoxGeometry(1.6, 28, 1.6);

  // Collectibles geometries
  const geoCoinBody = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 18); geoCoinBody.rotateX(Math.PI / 2);
  const geoCoinRim = new THREE.TorusGeometry(0.55, 0.09, 10, 22);
  const geoGemStar = new THREE.OctahedronGeometry(0.68, 0);
  const geoGemRing = new THREE.TorusGeometry(0.92, 0.055, 8, 22);
  const geoGlowRing = new THREE.PlaneGeometry(2.35, 2.35);
  const geoFireRingTorus = new THREE.TorusGeometry(1.82, 0.19, 10, 24);
  const geoFireFlame = new THREE.ConeGeometry(0.22, 0.68, 5);

  // Garuda Tunnel Geometries (shared)
  const geoSkullCrown = new THREE.ConeGeometry(3.8, 5.2, 5);
  const geoSkullJaw = new RoundedBoxGeometry(W + 3.2, 3.4, 4.4, 2, 0.4);
  const geoSkullBeak = new THREE.ConeGeometry(2.2, 5.4, 4);
  const geoSkullHorn = new THREE.ConeGeometry(0.95, 5.2, 6);
  const geoSkullEye = new THREE.SphereGeometry(0.95, 10, 8);
  const geoSkullGear = new THREE.CylinderGeometry(1.85, 1.85, 0.6, 10); geoSkullGear.rotateZ(Math.PI / 2);
  const geoRibArch = new THREE.TorusGeometry(W * 0.5 + 1.6, 0.72, 8, 24, Math.PI);

  // Instanced Geometries
  const geoInstTruss = new THREE.CylinderGeometry(0.66, 0.90, 1.0, 8);
  const geoInstPost = new RoundedBoxGeometry(0.32, 0.95, 3.4, 2, 0.06);
  const geoInstChevron = new THREE.BoxGeometry(1.4, 1.4, 0.24);
  const geoInstIsland = new THREE.CylinderGeometry(5.5, 8.2, 2.6, 10);
  const geoInstIslandTop = new THREE.CylinderGeometry(5.2, 5.8, 0.7, 10);
  const geoInstPalmTrunk = new THREE.CylinderGeometry(0.28, 0.48, 5.2, 7);
  const geoInstPalmCrown = new THREE.ConeGeometry(2.6, 2.4, 7);

  /* ---------- Pool setup ---------- */
  const POOL_SIZE = TRACK.segmentsAhead + TRACK.segmentsBehind + 2;
  const pool = [];

  /* ---------- Global InstancedMesh Pools ---------- */
  const MAX_TRUSS = POOL_SIZE * 2;
  const MAX_POSTS = POOL_SIZE * 12;
  const MAX_CHEVS = POOL_SIZE * 8;
  const MAX_ISLANDS = POOL_SIZE * 2;
  const MAX_PALMS = POOL_SIZE * 6;

  const instTrusses = new THREE.InstancedMesh(geoInstTruss, matTrussSteel, MAX_TRUSS);
  const instPostsBlue = new THREE.InstancedMesh(geoInstPost, matPostBlue, MAX_POSTS);
  const instPostsOrange = new THREE.InstancedMesh(geoInstPost, matPostOrange, MAX_POSTS);
  const instChevrons = new THREE.InstancedMesh(geoInstChevron, matChevronSign, MAX_CHEVS);
  const instIslandBases = new THREE.InstancedMesh(geoInstIsland, matIslandSand, MAX_ISLANDS);
  const instIslandTops = new THREE.InstancedMesh(geoInstIslandTop, matIslandLush, MAX_ISLANDS);
  const instPalmTrunks = new THREE.InstancedMesh(geoInstPalmTrunk, matPalmTrunk, MAX_PALMS);
  const instPalmCrowns = new THREE.InstancedMesh(geoInstPalmCrown, matPalmCrown, MAX_PALMS);

  const allInstanced = [
    instTrusses, instPostsBlue, instPostsOrange, instChevrons,
    instIslandBases, instIslandTops, instPalmTrunks, instPalmCrowns,
  ];
  for (const im of allInstanced) {
    im.frustumCulled = false;
    im.count = 0;
    scene.add(im);
  }

  const _dummy = new THREE.Object3D();

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

  const DECK_THICK = 0.65;
  const WALL_W = 0.44;
  const WALL_H = 0.36;

  function makeUChannelGeo(width, len, segZ = 14, zCenter = 0) {
    const g = new THREE.BufferGeometry();
    const N = 8;
    const rows = segZ + 1;
    const pos = new Float32Array(rows * N * 3);
    const uv = new Float32Array(rows * N * 2);
    const idx = [];
    const hw = width * 0.5;
    const xs = [-hw - WALL_W, -hw, -hw + 0.14, hw - 0.14, hw, hw + WALL_W, hw + WALL_W, -hw - WALL_W];
    const ys = [WALL_H, WALL_H, 0, 0, WALL_H, WALL_H, -DECK_THICK, -DECK_THICK];
    const us = [0.02, 0.06, 0.10, 0.90, 0.94, 0.98, 0.98, 0.02];

    for (let r = 0; r <= segZ; r++) {
      const t = r / segZ;
      const lz = zCenter + len * (0.5 - t);
      const v = 1 - t;
      const b = r * N;
      for (let k = 0; k < N; k++) {
        const pOff = (b + k) * 3;
        pos[pOff] = xs[k];
        pos[pOff + 1] = ys[k];
        pos[pOff + 2] = lz;
        const uOff = (b + k) * 2;
        uv[uOff] = us[k];
        uv[uOff + 1] = v;
      }
      if (r < segZ) {
        for (let k = 0; k < N; k++) {
          const kNext = (k + 1) % N;
          const a = b + k, c = b + kNext, d = b + N + k, e = b + N + kNext;
          idx.push(a, c, d, c, e, d);
        }
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function makeRoadGeo(width, segZ = 14) {
    return makeUChannelGeo(width, L, segZ, 0);
  }

  function makeGapRoadGeo(zFrom, zTo, width, segZ) {
    const len = Math.abs(zFrom - zTo);
    return makeUChannelGeo(width, len, segZ, (zFrom + zTo) * 0.5);
  }

  function makeRibbonGeo(steps) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((steps + 1) * 2 * 3);
    const uv = new Float32Array((steps + 1) * 2 * 2);
    const idx = [];
    for (let s = 0; s <= steps; s++) {
      const v = s / steps;
      uv[s * 4] = 0; uv[s * 4 + 1] = v;
      uv[s * 4 + 2] = 1; uv[s * 4 + 3] = v;
      if (s < steps) {
        const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function makeBeveledRibbonGeo(steps) {
    const g = new THREE.BufferGeometry();
    const N = 8;
    const pos = new Float32Array((steps + 1) * N * 3);
    const uv = new Float32Array((steps + 1) * N * 2);
    const idx = [];
    const us = [0.02, 0.06, 0.10, 0.90, 0.94, 0.98, 0.98, 0.02];
    for (let s = 0; s <= steps; s++) {
      const v = (s / steps) * 2;
      const b = s * N;
      for (let k = 0; k < N; k++) {
        uv[(b + k) * 2] = us[k];
        uv[(b + k) * 2 + 1] = v;
      }
      if (s < steps) {
        for (let k = 0; k < N; k++) {
          const kNext = (k + 1) % N;
          const a = b + k, c = b + kNext, d = b + N + k, e = b + N + kNext;
          idx.push(a, c, d, c, e, d);
        }
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function displaceDeck(mesh, centerZ, i, yOff = 0) {
    const pos = mesh.geometry.attributes.position;
    const bx = mesh.userData.baseX;
    const by = mesh.userData.baseY;
    for (let v = 0; v < pos.count; v++) {
      const lz = pos.getZ(v);
      const wz = centerZ + lz;
      const t = Math.min(1, Math.max(0, (L * 0.5 - lz) / L));
      const hw = getHalfWidthAt(i, t);
      const lx = (bx[v] / (W * 0.5)) * hw;
      const cx = getTrackCenterX(wz);
      const bank = getTrackBank(wz);
      pos.setX(v, cx + lx);
      pos.setY(v, getTrackHeight(wz) + lx * bank + yOff + (by ? by[v] : 0));
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceSimple(mesh, centerZ, yOff = 0, xShift = 0) {
    const pos = mesh.geometry.attributes.position;
    const bx = mesh.userData.baseX;
    const by = mesh.userData.baseY;
    for (let v = 0; v < pos.count; v++) {
      const lz = pos.getZ(v);
      const wz = centerZ + lz;
      const lx = bx[v] + xShift;
      pos.setX(v, getTrackCenterX(wz) + lx);
      pos.setY(v, getTrackHeight(wz) + lx * getTrackBank(wz) + yOff + (by ? by[v] : 0));
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceRibbon(mesh, steps, evalFn) {
    const pos = mesh.geometry.attributes.position;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const pt = evalFn(t);
      const yL = pt.yL !== undefined ? pt.yL : pt.y;
      const yR = pt.yR !== undefined ? pt.yR : pt.y;
      pos.setXYZ(s * 2, pt.lx, yL, pt.z);
      pos.setXYZ(s * 2 + 1, pt.rx, yR, pt.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function displaceBeveledRibbon(mesh, steps, evalFn) {
    const pos = mesh.geometry.attributes.position;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const pt = evalFn(t);
      const yL = pt.yL !== undefined ? pt.yL : pt.y;
      const yR = pt.yR !== undefined ? pt.yR : pt.y;
      const b = s * 8;
      pos.setXYZ(b, pt.lx - WALL_W, yL + WALL_H, pt.z);
      pos.setXYZ(b + 1, pt.lx, yL + WALL_H, pt.z);
      pos.setXYZ(b + 2, pt.lx + 0.14, yL, pt.z);
      pos.setXYZ(b + 3, pt.rx - 0.14, yR, pt.z);
      pos.setXYZ(b + 4, pt.rx, yR + WALL_H, pt.z);
      pos.setXYZ(b + 5, pt.rx + WALL_W, yR + WALL_H, pt.z);
      pos.setXYZ(b + 6, pt.rx + WALL_W, yR - DECK_THICK, pt.z);
      pos.setXYZ(b + 7, pt.lx - WALL_W, yL - DECK_THICK, pt.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function buildGarudaSkullPortal() {
    const g = new THREE.Group();
    const pillarL = new THREE.Mesh(geoSkullJaw, matGarudaGold);
    pillarL.scale.set(0.24, 2.4, 1.0);
    pillarL.position.set(-(W * 0.5 + 1.8), 4.0, 0);
    const pillarR = pillarL.clone();
    pillarR.position.x = (W * 0.5 + 1.8);
    g.add(pillarL, pillarR);

    const brow = new THREE.Mesh(geoSkullJaw, matGarudaGold);
    brow.position.set(0, 8.2, 0);
    g.add(brow);

    const crest = new THREE.Mesh(geoSkullCrown, matGarudaGold);
    crest.position.set(0, 11.4, -0.2);
    g.add(crest);

    const beak = new THREE.Mesh(geoSkullBeak, matGarudaBronze);
    beak.rotation.x = Math.PI * 0.85;
    beak.position.set(0, 6.2, 2.2);
    g.add(beak);

    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(geoSkullHorn, matGarudaGold);
      horn.position.set(s * 6.4, 10.6, -0.5);
      horn.rotation.z = -s * 0.52;
      horn.rotation.x = -0.2;
      const eye = new THREE.Mesh(geoSkullEye, matGarudaEye);
      eye.position.set(s * 4.2, 7.8, 2.1);
      const gear = new THREE.Mesh(geoSkullGear, matGarudaBronze);
      gear.position.set(s * (W * 0.5 + 2.4), 5.6, 0);
      g.add(horn, eye, gear);
    }

    for (let r = 0; r < 3; r++) {
      const rib = new THREE.Mesh(geoRibArch, r % 2 === 0 ? matGarudaGold : matGarudaBronze);
      rib.position.set(0, 0.2, -5.0 - r * 6.0);
      g.add(rib);
    }
    return g;
  }

  function buildGateArch(bannerMat) {
    const g = new THREE.Group();
    const span = W_START + 2.8;
    const pL = new THREE.Mesh(geoArchPillar, matArchBlue);
    pL.position.set(-span * 0.5, 7.2, 0);
    const pR = new THREE.Mesh(geoArchPillar, matArchRed);
    pR.position.set(span * 0.5, 7.2, 0);
    const beam = new THREE.Mesh(geoArchBeam, matArchOrange);
    beam.position.set(0, 13.8, 0);
    const banner = new THREE.Mesh(geoArchBanner, bannerMat);
    banner.position.set(0, 13.8, 0.85);
    const bannerBack = new THREE.Mesh(geoArchBanner, bannerMat);
    bannerBack.position.set(0, 13.8, -0.85);
    bannerBack.rotation.y = Math.PI;
    const fL = new THREE.Mesh(geoFlameJet, matFlameTorch);
    fL.position.set(-span * 0.5, 15.6, 0);
    const fR = new THREE.Mesh(geoFlameJet, matFlameTorch);
    fR.position.set(span * 0.5, 15.6, 0);
    const stripe = new THREE.Mesh(geoCheckStripe, matCheckered);
    stripe.position.set(0, 0.05, 0);
    g.add(pL, pR, beam, banner, bannerBack, fL, fR, stripe);
    g.userData.flames = [fL, fR];
    return g;
  }

  function buildSegment() {
    const group = new THREE.Group();
    scene.add(group);

    const ocean = new THREE.Mesh(geoOcean, matOcean);
    ocean.position.y = SKYWAY_FLOOR_Y;
    ocean.receiveShadow = true;
    group.add(ocean);

    const road = cacheBaseX(new THREE.Mesh(makeRoadGeo(W), matSkyOrange));
    road.receiveShadow = true;
    group.add(road);

    const rampApproach = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(L / 2, RAMP_GAP_START, W, 8), matSkyOrange));
    rampApproach.receiveShadow = true; rampApproach.visible = false;
    const rampExit = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(RAMP_GAP_END, -L / 2, W, 2), matSkyOrange));
    rampExit.receiveShadow = true; rampExit.visible = false;
    const rampSafeRoad = cacheBaseX(new THREE.Mesh(makeGapRoadGeo(RAMP_GAP_START, RAMP_GAP_END, RAMP_SAFE_W, 4), matSkyOrange));
    rampSafeRoad.receiveShadow = true; rampSafeRoad.visible = false;
    group.add(rampApproach, rampExit, rampSafeRoad);

    const rampCaps = [];
    for (const cz of [RAMP_GAP_START, RAMP_GAP_END]) {
      const m = new THREE.Mesh(geoRampLip, matHazardStripe);
      m.visible = false;
      group.add(m);
      rampCaps.push({ mesh: m, lz: cz });
    }

    const rampGroup = new THREE.Group();
    const rampMesh = new THREE.Mesh(geoRamp, matRamp);
    rampMesh.castShadow = true;
    rampGroup.add(rampMesh);
    rampGroup.visible = false;
    group.add(rampGroup);

    const boostGroup = new THREE.Group();
    const boostPad = new THREE.Mesh(geoBoostPad, matBoostBlue);
    boostGroup.add(boostPad);
    for (let k = -1; k <= 1; k++) {
      const ch = new THREE.Mesh(geoGreenChev, matGreenBoost);
      ch.position.set(0, 0.1, k * 1.45);
      boostGroup.add(ch);
    }
    const boosterWheels = [];
    for (const side of [-1, 1]) {
      const house = new THREE.Mesh(geoBoosterHousing, matRailBlue);
      house.position.set(side * (BOOST_W * 0.5 + 0.72), 0.62, 0);
      boostGroup.add(house);
      for (const wz of [-1.2, 1.2]) {
        const w = new THREE.Mesh(geoBoosterWheel, matBoosterWheel);
        w.position.set(side * (BOOST_W * 0.5 + 0.5), 0.92, wz);
        boostGroup.add(w);
        boosterWheels.push(w);
      }
    }
    boostGroup.visible = false;
    group.add(boostGroup);

    // Fork Group
    const forkGroup = new THREE.Group();
    const forkLeftRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matSkyOrange);
    const forkRightRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matBankYellow);
    const forkLeftRailL = new THREE.Mesh(makeRibbonGeo(RIBBON_STEPS), matRailBlue);
    const forkLeftRailR = new THREE.Mesh(makeRibbonGeo(RIBBON_STEPS), matRailBlue);
    const forkRightRailL = new THREE.Mesh(makeRibbonGeo(RIBBON_STEPS), matRailOrange);
    const forkRightRailR = new THREE.Mesh(makeRibbonGeo(RIBBON_STEPS), matRailOrange);
    forkGroup.add(forkLeftRoad, forkRightRoad, forkLeftRailL, forkLeftRailR, forkRightRailL, forkRightRailR);
    forkGroup.visible = false;
    group.add(forkGroup);

    // Loop 360 Group
    const loopGroup = new THREE.Group();
    const loopDeck = new THREE.Mesh(makeBeveledRibbonGeo(LOOP_STEPS), matSkyOrange);
    const loopRailL = new THREE.Mesh(makeRibbonGeo(LOOP_STEPS), matRailBlue);
    const loopRailR = new THREE.Mesh(makeRibbonGeo(LOOP_STEPS), matRailBlue);
    const loopBypassRoad = new THREE.Mesh(makeBeveledRibbonGeo(RIBBON_STEPS), matBankYellow);
    const loopBypassRailL = new THREE.Mesh(makeRibbonGeo(RIBBON_STEPS), matRailOrange);
    const loopBypassRailR = new THREE.Mesh(makeRibbonGeo(RIBBON_STEPS), matRailOrange);
    loopGroup.add(loopDeck, loopRailL, loopRailR, loopBypassRoad, loopBypassRailL, loopBypassRailR);
    loopGroup.visible = false;
    group.add(loopGroup);

    // Overhead Skyway Bridge (for underpass segments)
    const overpassGroup = new THREE.Group();
    const opDeck = new THREE.Mesh(geoOverpassDeck, matSkyOrange);
    const opRailA = new THREE.Mesh(geoOverpassRail, matBankYellow);
    opRailA.position.set(0, 0.85, 3.6);
    const opRailB = new THREE.Mesh(geoOverpassRail, matBankYellow);
    opRailB.position.set(0, 0.85, -3.6);
    const opPierL = new THREE.Mesh(geoOverpassPier, matRailBlue);
    opPierL.position.set(-23, -14.65, 0);
    const opPierR = new THREE.Mesh(geoOverpassPier, matRailBlue);
    opPierR.position.set(23, -14.65, 0);
    overpassGroup.add(opDeck, opRailA, opRailB, opPierL, opPierR);
    overpassGroup.visible = false;
    group.add(overpassGroup);

    // Golden Garuda Tunnel + 3 Rolling Red Energy Orbs
    const skullGroup = buildGarudaSkullPortal();
    skullGroup.visible = false;
    group.add(skullGroup);

    const orbs = [];
    for (let k = 0; k < 3; k++) {
      const og = new THREE.Group();
      const sphere = new THREE.Mesh(geoOrb, matEnergyOrb);
      const ring = new THREE.Mesh(geoOrbRing, matEnergyRing);
      ring.rotation.x = Math.PI * 0.35;
      og.add(sphere, ring);
      og.visible = false;
      group.add(og);
      orbs.push({
        group: og, sphere, ring,
        active: false, lz: 6 - k * 7, baseY: 0, cx: 0, wx: 0, wy: 0, wz: 0,
        phase: k * 2.1, spd: 2.3 + k * 0.45,
      });
    }

    // Warn triangle sign
    const warnGroup = new THREE.Group();
    const wPost = new THREE.Mesh(geoWarnPost, matDeckSide); wPost.position.y = 1.1;
    const wBoard = new THREE.Mesh(geoWarnBoard, matWarnSign); wBoard.position.y = 2.65;
    warnGroup.add(wPost, wBoard);
    warnGroup.visible = false;
    group.add(warnGroup);

    // Start & Finish Arches
    const startArch = buildGateArch(matStartBanner);
    startArch.visible = false;
    group.add(startArch);

    const finishArch = buildGateArch(matFinishBanner);
    finishArch.visible = false;
    group.add(finishArch);

    // Connector clip
    const connector = new THREE.Mesh(geoConnectorBar, matConnectorBlue);
    connector.visible = false;
    group.add(connector);

    // Center dashes
    const dashes = [];
    for (let k = 0; k < 5; k++) {
      const d = new THREE.Mesh(geoDash, matBankYellow);
      group.add(d);
      dashes.push(d);
    }

    // Smashable toy barrels
    const smashProps = [];
    for (let k = 0; k < 3; k++) {
      const bg = new THREE.Group();
      const body = new THREE.Mesh(geoBarrelBody, k % 2 === 0 ? matPropBarrelRed : matPropBarrelYellow);
      body.position.y = 0.62;
      const band = new THREE.Mesh(geoBarrelBand, matRailBlue);
      band.position.y = 0.62;
      bg.add(body, band);
      bg.visible = false;
      group.add(bg);
      smashProps.push({ mesh: bg, active: false, hit: false, lx: 0, lz: 0, baseY: 0, vx: 0, vy: 0, vz: 0, rvx: 0, rvz: 0 });
    }

    // Collectibles
    const collectibles = [];
    for (let k = 0; k < MAX_COLLECTIBLES; k++) {
      const obj = new THREE.Group();
      const coinMesh = new THREE.Group();
      const cBody = new THREE.Mesh(geoCoinBody, matCoinGold);
      const cRim = new THREE.Mesh(geoCoinRim, matCoinRim);
      coinMesh.add(cBody, cRim);
      obj.add(coinMesh);

      const gemMesh = new THREE.Group();
      const gemMat = new THREE.MeshPhysicalMaterial({ color: '#ff2a4b', emissive: '#ffbe0b', emissiveIntensity: 0.45, roughness: 0.14, metalness: 0.25, clearcoat: 1.0 });
      const star = new THREE.Mesh(geoGemStar, gemMat);
      const halo = new THREE.Mesh(geoGemRing, matGemHalo);
      halo.rotation.x = Math.PI / 2;
      gemMesh.add(star, halo);
      gemMesh.userData.gemMat = gemMat;
      gemMesh.visible = false;
      obj.add(gemMesh);

      const fruitVariants = {};
      for (const ft of FRUIT_TYPES) {
        const fm = buildToyFruit(ft);
        fm.scale.setScalar(1.12);
        fm.visible = false;
        obj.add(fm);
        fruitVariants[ft] = fm;
      }

      const fireRingMesh = new THREE.Group();
      const torus = new THREE.Mesh(geoFireRingTorus, matFireRing);
      fireRingMesh.add(torus);
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2;
        const fl = new THREE.Mesh(geoFireFlame, matFireFlame);
        fl.position.set(Math.cos(a) * 1.98, Math.sin(a) * 1.98, 0);
        fl.rotation.z = a - Math.PI * 0.5;
        fireRingMesh.add(fl);
      }
      fireRingMesh.visible = false;
      obj.add(fireRingMesh);

      const groundRing = new THREE.Mesh(geoGlowRing, ringMats.gem);
      groundRing.rotation.x = -Math.PI / 2;
      groundRing.visible = false;
      group.add(groundRing);

      obj.visible = false;
      group.add(obj);
      collectibles.push({
        obj, coinMesh, gemMesh, fruitMesh: fruitVariants.orange, fruitVariants, fireRingMesh, groundRing,
        active: false, collected: false, kind: 'coin', fruitType: 'orange',
        lx: 0, lz: 0, baseY: 0, phase: k * 0.9,
      });
    }

    return {
      index: null, kind: 'plain', group, ocean, road,
      rampRoads: [{ mesh: rampApproach, z0: L / 2, z1: RAMP_GAP_START }, { mesh: rampExit, z0: RAMP_GAP_END, z1: -L / 2 }],
      rampSafeRoad, rampCaps, rampGroup, boostGroup, boosterWheels,
      forkGroup, forkLeftRoad, forkRightRoad, forkLeftRailL, forkLeftRailR, forkRightRailL, forkRightRailR,
      loopGroup, loopDeck, loopRailL, loopRailR, loopBypassRoad, loopBypassRailL, loopBypassRailR,
      overpassGroup, skullGroup, orbs, warnGroup: { mesh: warnGroup, active: false, baseY: 0, phase: 0 },
      startArch, finishArch, connector, dashes, smashProps, collectibles,
    };
  }

  const _tmpL = new THREE.Vector3();
  const _tmpLIn = new THREE.Vector3();
  const _tmpRIn = new THREE.Vector3();
  const _tmpR = new THREE.Vector3();
  const _lpUpTmp = new THREE.Vector3();
  const _lpRightTmp = new THREE.Vector3();

  function displaceLoop(seg, centerZ) {
    const zStart = centerZ + L * 0.5;
    const zEnd = centerZ - L * 0.5;
    const y0 = getTrackHeight(zStart);
    const y1 = getTrackHeight(zEnd);

    const pos = seg.loopDeck.geometry.attributes.position;
    const posRL = seg.loopRailL.geometry.attributes.position;
    const posRR = seg.loopRailR.geometry.attributes.position;

    for (let s = 0; s <= LOOP_STEPS; s++) {
      const u = s / LOOP_STEPS;
      const theta = u * Math.PI * 2;
      _lpUpTmp.set(0, Math.cos(theta), Math.sin(theta)).normalize();

      evalLoopPose(zStart, zEnd, y0, y1, u, 0, _tmpL, null, _lpRightTmp);
      const cx = _tmpL.x, cy = _tmpL.y, cz = _tmpL.z - centerZ;
      const rx = _lpRightTmp.x, ry = _lpRightTmp.y, rz = _lpRightTmp.z;
      const ux = _lpUpTmp.x, uy = _lpUpTmp.y, uz = _lpUpTmp.z;
      const setV = (idxV, lx, hIn) => {
        pos.setXYZ(idxV, cx + rx * lx + ux * hIn, cy + ry * lx + uy * hIn, cz + rz * lx + uz * hIn);
      };
      const b = s * 8;
      setV(b, -LOOP_HALF_W - WALL_W, WALL_H);
      setV(b + 1, -LOOP_HALF_W, WALL_H);
      setV(b + 2, -LOOP_HALF_W + 0.14, 0);
      setV(b + 3, LOOP_HALF_W - 0.14, 0);
      setV(b + 4, LOOP_HALF_W, WALL_H);
      setV(b + 5, LOOP_HALF_W + WALL_W, WALL_H);
      setV(b + 6, LOOP_HALF_W + WALL_W, -DECK_THICK);
      setV(b + 7, -LOOP_HALF_W - WALL_W, -DECK_THICK);

      const i0 = s * 2, i1 = i0 + 1;
      evalLoopPose(zStart, zEnd, y0, y1, u, -LOOP_HALF_W - 0.15, _tmpL, null, null);
      posRL.setXYZ(i0, _tmpL.x, _tmpL.y, _tmpL.z - centerZ);
      posRL.setXYZ(i1, _tmpL.x + ux * 0.68, _tmpL.y + uy * 0.68, _tmpL.z - centerZ + uz * 0.68);

      evalLoopPose(zStart, zEnd, y0, y1, u, LOOP_HALF_W + 0.15, _tmpR, null, null);
      posRR.setXYZ(i0, _tmpR.x, _tmpR.y, _tmpR.z - centerZ);
      posRR.setXYZ(i1, _tmpR.x + ux * 0.68, _tmpR.y + uy * 0.68, _tmpR.z - centerZ + uz * 0.68);
    }
    pos.needsUpdate = true; seg.loopDeck.geometry.computeVertexNormals();
    posRL.needsUpdate = true; seg.loopRailL.geometry.computeVertexNormals();
    posRR.needsUpdate = true; seg.loopRailR.geometry.computeVertexNormals();

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
  }

  function assignCollectibles(seg, i, centerZ) {
    for (const item of seg.collectibles) {
      item.active = false;
      item.collected = false;
      item.obj.visible = false;
      item.groundRing.visible = false;
    }
    if (i <= 0) return;

    const kind = seg.kind;
    let cursor = 0;

    if (kind === 'loop') {
      const zStart = centerZ + L * 0.5;
      const zEnd = centerZ - L * 0.5;
      const y0 = getTrackHeight(zStart);
      const y1 = getTrackHeight(zEnd);
      for (let k = 0; k < 5 && cursor < MAX_COLLECTIBLES; k++) {
        const u = 0.18 + k * 0.16;
        evalLoopPose(zStart, zEnd, y0, y1, u, 0, _tmpL, null, null);
        const item = seg.collectibles[cursor++];
        item.active = true;
        item.kind = k === 2 ? 'gem' : 'coin';
        item.lx = _tmpL.x;
        item.lz = _tmpL.z - centerZ;
        item.baseY = _tmpL.y + 0.9;
        item.obj.position.set(item.lx, item.baseY, item.lz);
        item.obj.visible = true;
        item.coinMesh.visible = item.kind === 'coin';
        item.gemMesh.visible = item.kind === 'gem';
        item.fireRingMesh.visible = false;
        for (const ft of FRUIT_TYPES) item.fruitVariants[ft].visible = false;
      }
      return;
    }

    if (kind === 'ramp') {
      const rampSide = getRampSide(i);
      const item = seg.collectibles[cursor++];
      const wz = centerZ - 4.0;
      const wx = getTrackCenterX(wz) + rampSide * RAMP_OFFSET;
      item.active = true;
      item.kind = 'ring';
      item.lx = wx; item.lz = -4.0;
      item.baseY = getTrackHeight(wz) + 3.6;
      item.obj.position.set(wx, item.baseY, item.lz);
      item.obj.visible = true;
      item.coinMesh.visible = false;
      item.gemMesh.visible = false;
      item.fireRingMesh.visible = true;
      for (const ft of FRUIT_TYPES) item.fruitVariants[ft].visible = false;
      return;
    }

    const lane = ((i % 3) - 1) * 4.4;
    const count = 4;
    for (let k = 0; k < count && cursor < MAX_COLLECTIBLES; k++) {
      const lz = 7.5 - k * 4.6;
      const wz = centerZ + lz;
      const cx = getTrackCenterX(wz);
      const item = seg.collectibles[cursor++];
      item.active = true;
      const isFruit = (k === 2);
      const isGem = (k === 3 && i % 3 === 0);
      item.kind = isGem ? 'gem' : isFruit ? 'fruit' : 'coin';
      const ft = FRUIT_TYPES[(i + k) % FRUIT_TYPES.length];
      item.fruitType = ft;
      item.lx = cx + lane;
      item.lz = lz;
      item.baseY = getTrackHeight(wz) + lane * getTrackBank(wz) + (isFruit ? 1.15 : 0.95);
      item.obj.position.set(item.lx, item.baseY, lz);
      item.obj.visible = true;
      item.coinMesh.visible = item.kind === 'coin';
      item.gemMesh.visible = item.kind === 'gem';
      item.fireRingMesh.visible = false;
      for (const key of FRUIT_TYPES) item.fruitVariants[key].visible = (item.kind === 'fruit' && key === ft);
      if (item.kind === 'fruit' || item.kind === 'gem') {
        item.groundRing.material = ringMats[item.kind === 'gem' ? 'gem' : ft];
        item.groundRing.position.set(item.lx, getTrackHeight(wz) + lane * getTrackBank(wz) + 0.08, lz);
        item.groundRing.visible = true;
      }
    }
  }

  let instDirty = true;

  function rebuildInstancedGeometry() {
    let cTruss = 0, cPostB = 0, cPostO = 0, cChev = 0, cIsl = 0, cPalm = 0;
    for (const seg of pool) {
      if (seg.index === null) continue;
      const i = seg.index;
      const centerZ = -(i + 0.5) * L;
      const kind = seg.kind;

      // 1) Blue Truss Support Pillars strictly beneath U-channel underside (pillarTopY = trackBottomY - 0.1) at outer edges (±hw * 0.85)
      if (kind !== 'fork' && kind !== 'loop') {
        const [, , lvl] = getSegmentElevationSpan(i);
        if (lvl !== 'lower' || kind === 'ascent' || kind === 'descent') {
          for (const side of [-1, 1]) {
            if (cTruss >= MAX_TRUSS) break;
            const wz = centerZ;
            const off = side * (getHalfWidthAt(i, 0.5) * 0.85);
            const trackBottomY = getTrackHeight(wz) + off * getTrackBank(wz) - DECK_THICK;
            const pillarTopY = trackBottomY - 0.1;
            const h = Math.max(1.0, pillarTopY - SKYWAY_FLOOR_Y);
            _dummy.position.set(getTrackCenterX(wz) + off, SKYWAY_FLOOR_Y + h * 0.5, wz);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(1, h, 1);
            _dummy.updateMatrix();
            instTrusses.setMatrixAt(cTruss++, _dummy.matrix);
          }
        }
      }

      // 2) Guardrail Beams (alternating electric-blue & bright orange along sides)
      if (kind !== 'fork' && kind !== 'loop') {
        for (let k = 0; k < 6; k++) {
          const lz = L * 0.5 - 2.0 - k * 4.0;
          const wz = centerZ + lz;
          const t = Math.min(1, Math.max(0, (L * 0.5 - lz) / L));
          const hw = getHalfWidthAt(i, t);
          const yaw = getTrackYaw(wz);
          const slope = getTrackSlope(wz);
          const bank = getTrackBank(wz);
          const cx = getTrackCenterX(wz);
          const h = getTrackHeight(wz);

          for (const side of [-1, 1]) {
            if (kind === 'ramp' && side === getRampSide(i) && lz <= RAMP_GAP_START + 0.5 && lz >= RAMP_GAP_END - 0.5) continue;
            const lx = side * (hw + 0.25);
            _dummy.position.set(cx + lx, h + lx * bank + 0.45, wz);
            _dummy.rotation.order = 'YXZ';
            _dummy.rotation.set(Math.atan(-slope), yaw, bank);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            if ((k + (side > 0 ? 1 : 0)) % 2 === 0) {
              if (cPostB < MAX_POSTS) instPostsBlue.setMatrixAt(cPostB++, _dummy.matrix);
            } else {
              if (cPostO < MAX_POSTS) instPostsOrange.setMatrixAt(cPostO++, _dummy.matrix);
            }
          }
        }
      }

      // 3) Reflective Chevron Arrow Signs on Banked Turns & Curves
      if (kind === 'banked' || Math.abs(getTrackBank(centerZ)) > 0.025) {
        const turnDir = getTrackSlopeX(centerZ);
        const outerSide = turnDir >= 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) {
          if (cChev >= MAX_CHEVS) break;
          const lz = L * 0.4 - k * 6.0;
          const wz = centerZ + lz;
          const t = Math.min(1, Math.max(0, (L * 0.5 - lz) / L));
          const hw = getHalfWidthAt(i, t);
          const lx = outerSide * (hw + 0.95);
          _dummy.position.set(getTrackCenterX(wz) + lx, getTrackHeight(wz) + lx * getTrackBank(wz) + 1.35, wz);
          _dummy.rotation.set(0, getTrackYaw(wz) + (outerSide < 0 ? 0.35 : -0.35), 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          instChevrons.setMatrixAt(cChev++, _dummy.matrix);
        }
      }

      // 4) Colorful Tropical Islands & Palm Trees in the Turquoise Ocean
      for (const side of [-1, 1]) {
        if (hash(i * 19 + side * 7) < 0.35) continue;
        if (cIsl >= MAX_ISLANDS) break;
        const ix = getTrackCenterX(centerZ) + side * (29 + hash(i * 23 + side) * 26);
        const iz = centerZ + (hash(i * 31 + side) - 0.5) * 14;
        const sc = 0.85 + hash(i * 41 + side) * 0.85;
        _dummy.position.set(ix, SKYWAY_FLOOR_Y + 0.9, iz);
        _dummy.rotation.set(0, hash(i * 13 + side) * Math.PI, 0);
        _dummy.scale.set(sc, sc, sc);
        _dummy.updateMatrix();
        instIslandBases.setMatrixAt(cIsl, _dummy.matrix);
        _dummy.position.set(ix, SKYWAY_FLOOR_Y + 2.2 * sc, iz);
        _dummy.updateMatrix();
        instIslandTops.setMatrixAt(cIsl, _dummy.matrix);
        cIsl++;

        // 2–3 Palm trees on the island
        const pCount = 2 + (Math.abs(i) % 2);
        for (let p = 0; p < pCount && cPalm < MAX_PALMS; p++) {
          const px = ix + (hash(i * 53 + p * 7 + side) - 0.5) * 5.2 * sc;
          const pz = iz + (hash(i * 61 + p * 11 + side) - 0.5) * 5.2 * sc;
          const py = SKYWAY_FLOOR_Y + 2.5 * sc;
          const pSc = 0.78 + hash(i * 71 + p) * 0.45;
          _dummy.position.set(px, py + 2.4 * pSc, pz);
          _dummy.rotation.set(0.08 * (p - 1), hash(p * 17 + i) * 3, 0.1 * (side));
          _dummy.scale.set(pSc, pSc, pSc);
          _dummy.updateMatrix();
          instPalmTrunks.setMatrixAt(cPalm, _dummy.matrix);
          _dummy.position.set(px, py + 5.1 * pSc, pz);
          _dummy.rotation.set(0, hash(p * 29 + i) * 3, 0);
          _dummy.scale.set(pSc, pSc, pSc);
          _dummy.updateMatrix();
          instPalmCrowns.setMatrixAt(cPalm, _dummy.matrix);
          cPalm++;
        }
      }
    }

    instTrusses.count = cTruss; instTrusses.instanceMatrix.needsUpdate = true;
    instPostsBlue.count = cPostB; instPostsBlue.instanceMatrix.needsUpdate = true;
    instPostsOrange.count = cPostO; instPostsOrange.instanceMatrix.needsUpdate = true;
    instChevrons.count = cChev; instChevrons.instanceMatrix.needsUpdate = true;
    instIslandBases.count = cIsl; instIslandBases.instanceMatrix.needsUpdate = true;
    instIslandTops.count = cIsl; instIslandTops.instanceMatrix.needsUpdate = true;
    instPalmTrunks.count = cPalm; instPalmTrunks.instanceMatrix.needsUpdate = true;
    instPalmCrowns.count = cPalm; instPalmCrowns.instanceMatrix.needsUpdate = true;
    instDirty = false;
  }

  function assign(seg, i) {
    seg.index = i;
    seg.kind = getSegmentKind(i);
    const centerZ = -(i + 0.5) * L;
    seg.group.position.set(0, 0, centerZ);
    const kind = seg.kind;

    const isPlainDeck = kind !== 'fork' && kind !== 'loop' && kind !== 'ramp';
    seg.road.visible = isPlainDeck;
    if (isPlainDeck) {
      seg.road.material = kind === 'banked' ? matBankYellow : kind === 'boost' ? matBoostBlue : matSkyOrange;
      displaceDeck(seg.road, centerZ, i);
    }

    // Ramp
    const isRamp = kind === 'ramp';
    for (const rr of seg.rampRoads) {
      rr.mesh.visible = isRamp;
      if (isRamp) displaceSimple(rr.mesh, centerZ);
    }
    seg.rampSafeRoad.visible = isRamp;
    const rampSide = getRampSide(i);
    if (isRamp) displaceSimple(seg.rampSafeRoad, centerZ, 0, -rampSide * RAMP_OFFSET);
    for (const rc of seg.rampCaps) {
      rc.mesh.visible = isRamp;
      if (isRamp) {
        const wz = centerZ + rc.lz;
        const gx = rampSide * RAMP_OFFSET;
        rc.mesh.position.set(getTrackCenterX(wz) + gx, getTrackHeight(wz) + gx * getTrackBank(wz) - 0.16, rc.lz);
        rc.mesh.rotation.order = 'YXZ';
        rc.mesh.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
      }
    }
    seg.rampGroup.visible = isRamp;
    if (isRamp) {
      const rx = rampSide * RAMP_OFFSET;
      seg.rampGroup.position.set(getTrackCenterX(centerZ) + rx, getTrackHeight(centerZ) + rx * getTrackBank(centerZ) + RAMP_RISE * 0.5 - 0.05, 0);
      seg.rampGroup.rotation.order = 'YXZ';
      seg.rampGroup.rotation.set(Math.atan(-getTrackSlope(centerZ)), getTrackYaw(centerZ), getTrackBank(centerZ));
    }

    // Boost
    seg.boostGroup.visible = kind === 'boost';
    if (seg.boostGroup.visible) {
      seg.boostGroup.position.set(getTrackCenterX(centerZ), getTrackHeight(centerZ) + 0.04, 0);
      seg.boostGroup.rotation.order = 'YXZ';
      seg.boostGroup.rotation.set(Math.atan(-getTrackSlope(centerZ)), getTrackYaw(centerZ), getTrackBank(centerZ));
    }

    // Fork
    seg.forkGroup.visible = kind === 'fork';
    if (seg.forkGroup.visible) {
      displaceBeveledRibbon(seg.forkLeftRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L; const wz = centerZ + lz; const cx = getTrackCenterX(wz); const fp = getForkProfile(t);
        return { lx: cx + fp.cxL - fp.hwL, rx: cx + fp.cxL + fp.hwL, y: getTrackHeight(wz) + fp.yOffL, z: lz };
      });
      displaceBeveledRibbon(seg.forkRightRoad, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L; const wz = centerZ + lz; const cx = getTrackCenterX(wz); const fp = getForkProfile(t);
        return { lx: cx + fp.cxR - fp.hwR, rx: cx + fp.cxR + fp.hwR, y: getTrackHeight(wz) + fp.yOffR, z: lz };
      });
      displaceRibbon(seg.forkLeftRailL, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L; const wz = centerZ + lz; const cx = getTrackCenterX(wz); const fp = getForkProfile(t);
        return { lx: cx + fp.cxL - fp.hwL - 0.14, rx: cx + fp.cxL - fp.hwL + 0.12, y: getTrackHeight(wz) + fp.yOffL + 0.42, z: lz };
      });
      displaceRibbon(seg.forkLeftRailR, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L; const wz = centerZ + lz; const cx = getTrackCenterX(wz); const fp = getForkProfile(t);
        return { lx: cx + fp.cxL + fp.hwL - 0.12, rx: cx + fp.cxL + fp.hwL + 0.14, y: getTrackHeight(wz) + fp.yOffL + 0.42, z: lz };
      });
      displaceRibbon(seg.forkRightRailL, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L; const wz = centerZ + lz; const cx = getTrackCenterX(wz); const fp = getForkProfile(t);
        return { lx: cx + fp.cxR - fp.hwR - 0.14, rx: cx + fp.cxR - fp.hwR + 0.12, y: getTrackHeight(wz) + fp.yOffR + 0.42, z: lz };
      });
      displaceRibbon(seg.forkRightRailR, RIBBON_STEPS, (t) => {
        const lz = L / 2 - t * L; const wz = centerZ + lz; const cx = getTrackCenterX(wz); const fp = getForkProfile(t);
        return { lx: cx + fp.cxR + fp.hwR - 0.12, rx: cx + fp.cxR + fp.hwR + 0.14, y: getTrackHeight(wz) + fp.yOffR + 0.42, z: lz };
      });
    }

    // Loop 360
    seg.loopGroup.visible = kind === 'loop';
    if (seg.loopGroup.visible) displaceLoop(seg, centerZ);

    // Overhead Bridge on Lower Coastal Level
    seg.overpassGroup.visible = kind === 'underpass';
    if (seg.overpassGroup.visible) {
      const wz = centerZ;
      seg.overpassGroup.position.set(getTrackCenterX(wz), getTrackHeight(wz) + 12.2, 0);
      seg.overpassGroup.rotation.y = getTrackYaw(wz) + (i % 4 === 0 ? 0.22 : -0.22);
    }

    // Golden Garuda Tunnel + Rolling Red Energy Orbs
    const isSkull = kind === 'skullTunnel';
    seg.skullGroup.visible = isSkull;
    if (isSkull) {
      const wz = centerZ + 8.0;
      seg.skullGroup.position.set(getTrackCenterX(wz), getTrackHeight(wz), 8.0);
      seg.skullGroup.rotation.y = getTrackYaw(wz);
    }
    for (let k = 0; k < seg.orbs.length; k++) {
      const ob = seg.orbs[k];
      ob.active = isSkull;
      ob.group.visible = isSkull;
      if (isSkull) {
        const wz = centerZ + ob.lz;
        ob.cx = getTrackCenterX(wz);
        ob.baseY = getTrackHeight(wz) + 1.05;
        ob.wz = wz;
        ob.wy = ob.baseY;
        ob.wx = ob.cx;
        ob.group.position.set(ob.wx, ob.baseY, ob.lz);
      }
    }

    // Warn Triangle Sign ahead of Skull Tunnel
    seg.warnGroup.active = isSkull;
    seg.warnGroup.mesh.visible = isSkull;
    if (isSkull) {
      const wz = centerZ + 11.0;
      const offX = -(W * 0.5 + 1.1);
      seg.warnGroup.baseY = getTrackHeight(wz) + offX * getTrackBank(wz);
      seg.warnGroup.phase = i * 1.2;
      seg.warnGroup.mesh.position.set(getTrackCenterX(wz) + offX, seg.warnGroup.baseY, 11.0);
      seg.warnGroup.mesh.rotation.y = getTrackYaw(wz);
    }

    // Start & Finish Arches
    seg.startArch.visible = (i === 0);
    if (seg.startArch.visible) {
      const wz = centerZ + 2.0;
      seg.startArch.position.set(getTrackCenterX(wz), getTrackHeight(wz), 2.0);
      seg.startArch.rotation.y = getTrackYaw(wz);
    }
    const finishSeg = Math.floor(1500 / L); // 62
    seg.finishArch.visible = (i === finishSeg);
    if (seg.finishArch.visible) {
      const finLz = (-1500) - centerZ;
      seg.finishArch.position.set(getTrackCenterX(-1500), getTrackHeight(-1500), finLz);
      seg.finishArch.rotation.y = getTrackYaw(-1500);
    }

    // Connector blue clip cleanly wrapping U-channel underside & outer edges
    seg.connector.visible = isPlainDeck && i % 2 === 0;
    if (seg.connector.visible) {
      const wz = centerZ - L * 0.5;
      const hwEnd = getHalfWidthAt(i, 1);
      seg.connector.position.set(getTrackCenterX(wz), getTrackHeight(wz) - DECK_THICK + 0.06, -L * 0.5);
      seg.connector.rotation.y = getTrackYaw(wz);
      seg.connector.scale.set((hwEnd * 2 + 1.5) / (W + 1.5), 1, 1);
    }

    // Center dashes
    seg.dashes.forEach((d, k) => {
      const lz = -L * 0.4 + k * 4.8;
      d.visible = isPlainDeck || (isRamp && (lz > RAMP_GAP_START || lz < RAMP_GAP_END));
      if (d.visible) {
        const wz = centerZ + lz;
        d.position.set(getTrackCenterX(wz), getTrackHeight(wz) + 0.03, lz);
        d.rotation.order = 'YXZ';
        d.rotation.set(Math.atan(-getTrackSlope(wz)), getTrackYaw(wz), getTrackBank(wz));
      }
    });

    // Smashable barrels
    const showProps = (kind === 'plain' || kind === 'underpass') && i >= 4 && (i % 3 === 0);
    const propLane = ((i % 2 === 0) ? -1 : 1) * 4.2;
    seg.smashProps.forEach((p, idx) => {
      p.hit = false;
      p.vx = p.vy = p.vz = p.rvx = p.rvz = 0;
      p.mesh.rotation.set(0, 0, 0);
      p.active = showProps;
      p.mesh.visible = showProps;
      if (showProps) {
        const oz = 3.0 - idx * 3.0;
        const wz = centerZ + oz;
        const off = propLane + (idx - 1) * 0.85;
        p.lx = getTrackCenterX(wz) + off;
        p.lz = oz;
        p.baseY = getTrackHeight(wz) + off * getTrackBank(wz);
        p.mesh.position.set(p.lx, p.baseY, oz);
      }
    });

    assignCollectibles(seg, i, centerZ);
    instDirty = true;
  }

  for (let s = 0; s < POOL_SIZE; s++) pool.push(buildSegment());

  let prevT = null;
  function updateTrack(playerZ, t = 0) {
    const dt = prevT === null ? 0.016 : Math.min(0.05, Math.max(0, t - prevT));
    prevT = t;

    const cur = Math.floor(-playerZ / L);
    const min = cur - TRACK.segmentsBehind;
    const max = cur + TRACK.segmentsAhead;
    const needed = new Set();
    for (let i = min; i <= max; i++) needed.add(i);

    for (const seg of pool) {
      if (seg.index !== null && !needed.has(seg.index)) {
        seg.index = null;
        instDirty = true;
      }
    }
    const present = new Set(pool.filter((s) => s.index !== null).map((s) => s.index));
    for (const i of needed) {
      if (present.has(i)) continue;
      const free = pool.find((s) => s.index === null);
      if (free) { assign(free, i); present.add(i); }
    }

    if (instDirty) rebuildInstancedGeometry();

    // Animate orbs, booster wheels, flames, collectibles, and smashed barrels
    for (const seg of pool) {
      if (seg.index === null) continue;
      const centerZ = seg.group.position.z;

      if (seg.boostGroup.visible) {
        for (const w of seg.boosterWheels) w.rotation.x = -t * 22;
      }
      if (seg.startArch.visible && seg.startArch.userData.flames) {
        for (let f = 0; f < seg.startArch.userData.flames.length; f++) {
          const fl = seg.startArch.userData.flames[f];
          fl.scale.set(1, 0.88 + 0.32 * Math.sin(t * 14 + f), 1);
        }
      }
      if (seg.finishArch.visible && seg.finishArch.userData.flames) {
        for (let f = 0; f < seg.finishArch.userData.flames.length; f++) {
          const fl = seg.finishArch.userData.flames[f];
          fl.scale.set(1, 0.88 + 0.32 * Math.sin(t * 14 + f), 1);
        }
      }
      if (seg.warnGroup.active) {
        seg.warnGroup.mesh.position.y = seg.warnGroup.baseY + Math.sin(t * 5.2 + seg.warnGroup.phase) * 0.18;
      }

      for (const ob of seg.orbs) {
        if (!ob.active) continue;
        const wz = centerZ + ob.lz;
        const swing = Math.sin(t * ob.spd + ob.phase) * 5.6;
        const wx = ob.cx + swing;
        const bank = getTrackBank(wz);
        ob.wx = wx;
        ob.wy = ob.baseY + swing * bank;
        ob.wz = wz;
        ob.group.position.set(wx, ob.wy, ob.lz);
        ob.ring.rotation.y = t * 4.2 + ob.phase;
        ob.sphere.rotation.z = -Math.cos(t * ob.spd + ob.phase) * 2.5;
      }

      for (const p of seg.smashProps) {
        if (!p.active || !p.hit || !p.mesh.visible) continue;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 28 * dt;
        p.mesh.rotation.x += p.rvx * dt;
        p.mesh.rotation.z += p.rvz * dt;
        if (p.mesh.position.y < SKYWAY_FLOOR_Y - 6) p.mesh.visible = false;
      }

      for (const item of seg.collectibles) {
        if (!item.active || item.collected) continue;
        item.obj.position.y = item.baseY + Math.sin(t * 3.6 + item.phase) * 0.18;
        if (item.kind === 'coin') {
          item.coinMesh.rotation.y = t * 3.4 + item.phase;
        } else if (item.kind === 'gem') {
          item.gemMesh.rotation.y = t * 2.8 + item.phase;
          const gm = item.gemMesh.userData.gemMat;
          const hue = (t * 0.55 + item.phase * 0.15) % 1;
          gm.color.setHSL(hue, 0.92, 0.62);
          gm.emissive.setHSL(hue, 0.95, 0.52);
        } else if (item.kind === 'ring') {
          item.fireRingMesh.rotation.z = t * 3.2 + item.phase;
        } else {
          item.fruitMesh.rotation.y = t * 2.4 + item.phase;
        }
      }
    }

    matGreenBoost.emissiveIntensity = 0.72 + Math.sin(t * 5.2) * 0.35;
    matEnergyOrb.emissiveIntensity = 1.3 + Math.sin(t * 9.0) * 0.5;
  }

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
        const hitPad = item.kind === 'ring' ? 3.0 : item.kind === 'fruit' ? 2.45 : 2.2;
        const hitY = item.kind === 'ring' ? 3.2 : 2.6;
        if (Math.abs(pos.x - wx) < hitPad && Math.abs(py - wy) < hitY && Math.abs(pos.z - wz) < 2.45) {
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
        if (Math.abs(pos.x - p.lx) < half.x + 0.55 && Math.abs(pos.z - wz) < half.z + 0.55 && Math.abs(pos.y - p.baseY) < 1.8) {
          p.hit = true;
          const dir = p.lx >= pos.x ? 1 : -1;
          p.vx = dir * (6 + Math.random() * 6);
          p.vy = 11 + Math.random() * 5;
          p.vz = -(14 + Math.random() * 8);
          p.rvx = 11; p.rvz = 9;
          _smashed.push({ kind: 'barrel', x: p.lx, y: p.baseY + 0.5, z: wz });
        }
      }
    }
    return _smashed;
  }

  function checkHazardCollision(pos, half = { x: 0.95, z: 1.55 }) {
    for (const seg of pool) {
      if (seg.index === null) continue;
      for (const ob of seg.orbs) {
        if (!ob.active) continue;
        if (
          Math.abs(pos.x - ob.wx) < half.x + 0.92 &&
          Math.abs(pos.z - ob.wz) < half.z + 0.92 &&
          Math.abs((pos.y + 0.85) - ob.wy) < 1.85
        ) {
          return { x: ob.wx, y: ob.wy, z: ob.wz };
        }
      }
    }
    return null;
  }

  const _upcomingHazards = [];
  function getUpcomingHazards(playerZ, maxDist = 72) {
    _upcomingHazards.length = 0;
    for (const seg of pool) {
      if (seg.index === null) continue;
      for (const ob of seg.orbs) {
        if (!ob.active) continue;
        const dist = playerZ - ob.wz;
        if (dist > 0.5 && dist <= maxDist) {
          _upcomingHazards.push({ laneX: ob.wx, dist, z: ob.wz });
        }
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
          p.hit = false; p.vx = p.vy = p.vz = 0;
          p.mesh.rotation.set(0, 0, 0);
          p.mesh.position.set(p.lx, p.baseY, p.lz);
          p.mesh.visible = true;
        }
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
        if (wz >= zMin && wz <= zMax) out.push({ x: item.lx, y: item.obj.position.y, z: wz, kind: item.kind });
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
      seg.forkLeftRoad.geometry.dispose(); seg.forkRightRoad.geometry.dispose();
      seg.forkLeftRailL.geometry.dispose(); seg.forkLeftRailR.geometry.dispose();
      seg.forkRightRailL.geometry.dispose(); seg.forkRightRailR.geometry.dispose();
      seg.loopDeck.geometry.dispose(); seg.loopRailL.geometry.dispose(); seg.loopRailR.geometry.dispose();
      seg.loopBypassRoad.geometry.dispose(); seg.loopBypassRailL.geometry.dispose(); seg.loopBypassRailR.geometry.dispose();
      for (const item of seg.collectibles) item.gemMesh.userData.gemMat.dispose();
    }
    for (const im of allInstanced) { scene.remove(im); im.dispose(); }
    [
      geoOcean, geoDash, geoConnectorBar, geoRamp, geoRampLip, geoBoostPad, geoGreenChev,
      geoBoosterHousing, geoBoosterWheel, geoOrb, geoOrbRing, geoWarnPost, geoWarnBoard,
      geoBarrelBody, geoBarrelBand, geoArchPillar, geoArchBeam, geoArchBanner, geoFlameJet, geoCheckStripe,
      geoOverpassDeck, geoOverpassRail, geoOverpassPier, geoCoinBody, geoCoinRim, geoGemStar, geoGemRing,
      geoGlowRing, geoFireRingTorus, geoFireFlame, geoSkullCrown, geoSkullJaw, geoSkullBeak,
      geoSkullHorn, geoSkullEye, geoSkullGear, geoRibArch, geoInstTruss, geoInstPost,
      geoInstChevron, geoInstIsland, geoInstIslandTop, geoInstPalmTrunk, geoInstPalmCrown,
    ].forEach((g) => g.dispose());
    [
      matSkyOrange, matBankYellow, matBoostBlue, matDeckSide, matRailBlue, matRailOrange, matConnectorBlue,
      matOcean, matGreenBoost, matBoosterWheel, matRamp, matHazardStripe, matStartBanner, matFinishBanner,
      matCheckered, matArchBlue, matArchRed, matArchOrange, matFlameTorch, matGarudaGold, matGarudaBronze,
      matGarudaEye, matEnergyOrb, matEnergyRing, matWarnSign, matCoinGold, matCoinRim, matGemHalo,
      matFireRing, matFireFlame, matTrussSteel, matChevronSign, matIslandSand, matIslandLush,
      matPalmTrunk, matPalmCrown, matPostBlue, matPostOrange, matPropBarrelRed, matPropBarrelYellow,
      ...Object.values(ringMats),
    ].forEach((m) => m.dispose());
    [
      texOrange, texYellow, texBlue, texOcean, texStartBanner, texFinishBanner,
      texChevronSign, texWarn, texCheckered, texRampChev, texGlowRing, texHazard,
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
