/* =====================================================================
   mandalikaFantasyTrack.js — Arena 3: Mandalika Sky Circuit (Fantasy)
   Sirkuit tertutup 17 tikungan (Pertamina Mandalika International Circuit)
   bergaya Hot Wheels: King of the Road di atas samudra tropis:
   - Closed-loop 3D spline (THREE.CatmullRomCurve3, TOTAL_LEN = 1500 m)
   - Main Start/Finish Straight lebar (W_START = 22) → Turn 1 → Turns 2-6
     pesisir pantai → Turns 7-9 teknis → Back Straight Loop 360° → Turn 10
     hairpin → Turns 11-15 S-Curve kuning miring → Turns 16-17 kembali ke garis Start
   - Upper/Lower Split-Level Shortcut (Turns 4-6): Jembatan buah 3D & Fire Rings
   - Dual-Choice 360° Vertical Loop + jalur bypass datar sebelum Turn 10
   - Terowongan Garuda / Naga Emas Mekanik + bola energi merah + rambu `!`
   ===================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PHYSICS, PALETTE as P } from '../config/gameConfig.js';
import { FRUIT_TYPES, buildToyFruit } from '../entities/assetFactory.js';

export const TOTAL_LEN = 1500;
const LUT_N = 750; // resolusi 2 m per titik
const DS = TOTAL_LEN / LUT_N;

const W = 17.0;
const W_START = 22.0;
const W_BANK = 20.0;
export const MANDALIKA_OCEAN_Y = -12.0;
const START_Y = 5.5;

// Split-Level Upper Shortcut (Turns 4-6: s = 270..432)
const SPLIT_S0 = 270;
const SPLIT_CLIMB_END = 300;
const SPLIT_DESC_START = 402;
const SPLIT_S1 = 432;
const SPLIT_HEIGHT = 5.2;
const SPLIT_UP_CX = -4.4;
const SPLIT_UP_HW = 3.5;
const SPLIT_LO_CX = 4.2;
const SPLIT_LO_HW = 4.5;

// Dual-Choice 360° Vertical Loop (Back straight sebelum Turn 10: s = 740..764)
export const LOOP_S0 = 740;
export const LOOP_S1 = 764;
export const LOOP_RADIUS = 7.8;
export const LOOP_HALF_W = 3.1;
export const LOOP_CENTER_X = -4.2;
export const BYPASS_CENTER_X = 4.2;
export const BYPASS_HALF_W = 3.8;
const LOOP_HELIX = 1.35;
export const LOOP_ARC_LEN = Math.PI * 2 * LOOP_RADIUS + 14;
const LOOP_STEPS = 48;

// 2 Jump Ramp Sektor
const RAMPS = [
  { sStart: 456, sEnd: 488, sCenter: 470, side: 1, offset: 4.2, rampLen: 5.4, rise: 1.8, gapStart: 472.7, gapEnd: 481.5 },
  { sStart: 1266, sEnd: 1298, sCenter: 1280, side: -1, offset: 4.2, rampLen: 5.4, rise: 1.8, gapStart: 1282.7, gapEnd: 1291.5 },
];
const RAMP_W = 7.2;
const RAMP_SAFE_W = 8.0;

// Boost Pad Sektor
const BOOSTS = [
  { sStart: 96, sEnd: 138, sCenter: 117 },
  { sStart: 690, sEnd: 730, sCenter: 710 },
  { sStart: 1178, sEnd: 1218, sCenter: 1198 },
];
const BOOST_W = 6.2;
const BOOST_LEN = 4.4;

// Golden Garuda Tunnel + Rolling Energy Orbs (S-Curve sector T11-T15)
const GARUDA_S = 1058;
const GARUDA_WARN_S = 1028;

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export function wrapS(s) {
  const r = s % TOTAL_LEN;
  return r < 0 ? r + TOTAL_LEN : r;
}

/* ==================== Pembentuk Spline 17 Tikungan Mandalika ==================== */
function buildMandalikaLUT() {
  // Titik kontrol searah jarum jam mengikuti siluet Sirkuit Pertamina Mandalika (17 tikungan):
  // Start/Finish menghadap -Z di (0, START_Y, 0), lalu Turn 1 kanan, T2-T6 pesisir timur,
  // T7-T9 teknis, Back Straight (Loop 360°), T10 hairpin, T11-T15 S-Curves selatan, T16-T17 kembali ke Start.
  const rawPts = [
    new THREE.Vector3(0, START_Y, 44),       // T17 exit menuju garis start
    new THREE.Vector3(0, START_Y, 0),        // Garis Start/Finish (u=0 arah -Z)
    new THREE.Vector3(0, START_Y, -68),      // Tengah lintasan utama
    new THREE.Vector3(2, START_Y + 0.4, -138),  // Masuk Turn 1
    new THREE.Vector3(24, START_Y + 0.8, -172), // Apex Turn 1 (kanan tajam)
    new THREE.Vector3(64, START_Y + 1.0, -166), // Keluar T1
    new THREE.Vector3(108, START_Y + 0.2, -142),// Turn 2 (pesisir)
    new THREE.Vector3(154, START_Y - 0.6, -158),// Turn 3
    new THREE.Vector3(204, START_Y - 0.8, -148),// Turn 4 (awal jembatan buah bertingkat)
    new THREE.Vector3(246, START_Y - 0.2, -114),// Turn 5
    new THREE.Vector3(256, START_Y + 0.8, -64), // Turn 6 (akhir jembatan buah)
    new THREE.Vector3(222, START_Y + 1.4, -22), // Turn 7 (kink kanan)
    new THREE.Vector3(184, START_Y + 1.8, -6),  // Turn 8 (kink kiri)
    new THREE.Vector3(182, START_Y + 2.2, 34),  // Turn 9 masuk back straight
    new THREE.Vector3(212, START_Y + 2.6, 76),  // Back straight (Dual-Choice 360° Loop)
    new THREE.Vector3(236, START_Y + 2.8, 126), // Masuk Turn 10 hairpin
    new THREE.Vector3(224, START_Y + 2.2, 168), // Apex Turn 10 hairpin
    new THREE.Vector3(178, START_Y + 1.6, 166), // Keluar Turn 10
    new THREE.Vector3(134, START_Y + 1.0, 128), // Turn 11 (S-Curve 1)
    new THREE.Vector3(88, START_Y + 0.8, 156),  // Turn 12 (S-Curve 2)
    new THREE.Vector3(44, START_Y + 1.0, 124),  // Turn 13 (S-Curve 3 + Garuda Tunnel)
    new THREE.Vector3(8, START_Y + 0.6, 152),   // Turn 14 (S-Curve 4)
    new THREE.Vector3(-24, START_Y + 0.2, 134), // Turn 15
    new THREE.Vector3(-28, START_Y, 92),        // Turn 16
    new THREE.Vector3(-6, START_Y, 64),         // Turn 17 menuju lintasan start
  ];

  // Ukur panjang mentah & skala bidang XZ agar keliling total TEPAT 1500.0 m
  const probe = new THREE.CatmullRomCurve3(rawPts, true, 'centripetal');
  const rawLen = probe.getLength();
  const scaleXZ = TOTAL_LEN / rawLen;

  const scaledPts = rawPts.map((p) => new THREE.Vector3(p.x * scaleXZ, p.y, p.z * scaleXZ));
  const scaledCurve = new THREE.CatmullRomCurve3(scaledPts, true, 'centripetal');

  // Cari titik terdekat dari (0, *, 0) dengan tangent mengarah ke -Z agar s=0 pas di Start/Finish (0, START_Y, 0)
  let bestU = 0;
  let bestScore = 1e9;
  const tmpP = new THREE.Vector3();
  const tmpT = new THREE.Vector3();
  for (let i = 0; i < 600; i++) {
    const u = i / 600;
    scaledCurve.getPointAt(u, tmpP);
    scaledCurve.getTangentAt(u, tmpT);
    if (tmpT.z < -0.85) {
      const d = tmpP.x * tmpP.x + tmpP.z * tmpP.z;
      if (d < bestScore) { bestScore = d; bestU = u; }
    }
  }
  scaledCurve.getPointAt(bestU, tmpP);
  scaledCurve.getTangentAt(bestU, tmpT);
  const startYaw = Math.atan2(-tmpT.x, -tmpT.z); // sudut rotasi Y untuk meluruskan tangent ke (0,0,-1)

  const cosR = Math.cos(-startYaw);
  const sinR = Math.sin(-startYaw);
  const ox = tmpP.x;
  const oz = tmpP.z;

  const alignedPts = scaledPts.map((p) => {
    const dx = p.x - ox;
    const dz = p.z - oz;
    const rx = dx * cosR + dz * sinR;
    const rz = -dx * sinR + dz * cosR;
    return new THREE.Vector3(rx, p.y, rz);
  });

  const curve = new THREE.CatmullRomCurve3(alignedPts, true, 'centripetal');
  // Hitung ulang u0 tepat di (0, *, 0) setelah align
  let u0 = 0;
  let dMin = 1e9;
  for (let i = 0; i < 1000; i++) {
    const u = i / 1000;
    curve.getPointAt(u, tmpP);
    curve.getTangentAt(u, tmpT);
    if (tmpT.z < -0.9) {
      const d = tmpP.x * tmpP.x + tmpP.z * tmpP.z;
      if (d < dMin) { dMin = d; u0 = u; }
    }
  }

  // Bangun Lookup Table berjarak merata (LUT_N = 750)
  const lut = new Array(LUT_N);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const tmpRight = new THREE.Vector3();
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;

  for (let i = 0; i < LUT_N; i++) {
    const u = (u0 + i / LUT_N) % 1;
    curve.getPointAt(u, tmpP);
    curve.getTangentAt(u, tmpT);
    tmpT.normalize();
    tmpRight.crossVectors(tmpT, worldUp).normalize();
    if (tmpP.x < minX) minX = tmpP.x;
    if (tmpP.x > maxX) maxX = tmpP.x;
    if (tmpP.z < minZ) minZ = tmpP.z;
    if (tmpP.z > maxZ) maxZ = tmpP.z;

    lut[i] = {
      s: i * DS,
      px: tmpP.x,
      py: tmpP.y,
      pz: tmpP.z,
      fx: tmpT.x,
      fy: tmpT.y,
      fz: tmpT.z,
      rx: tmpRight.x,
      ry: tmpRight.y,
      rz: tmpRight.z,
      bank: 0,
      halfW: W * 0.5,
      zone: 'orange',
    };
  }

  // Paksa titik awal lurus sempurna agar Start Grid & Menu simetris
  lut[0].px = 0; lut[0].pz = 0;

  // Hitung kemiringan (banking) berbasis kelengkungan tikungan + lebar & zona visual
  for (let i = 0; i < LUT_N; i++) {
    const s = i * DS;
    const prev = lut[(i - 4 + LUT_N) % LUT_N];
    const next = lut[(i + 4) % LUT_N];
    // Kelengkungan horizontal: + bila belok kanan (fx*next.fz - fz*next.fx)
    const crossY = prev.fx * next.fz - prev.fz * next.fx;
    const rawCurv = THREE.MathUtils.clamp(crossY * 1.45, -1, 1);

    // Zona khusus
    let zone = 'orange';
    let halfW = W * 0.5;
    let flatMask = 1;

    if (s < 92 || s > 1430) {
      zone = 'start';
      const endFade = s < 92 ? (1 - smoothstep(66, 92, s)) : smoothstep(1430, 1465, s);
      halfW = THREE.MathUtils.lerp(W * 0.5, W_START * 0.5, endFade);
      flatMask = 0;
    } else if ((s >= 96 && s <= 138) || (s >= 690 && s <= 730) || (s >= 1178 && s <= 1218)) {
      zone = 'boost';
      flatMask = 0.25;
    } else if (s >= SPLIT_S0 && s <= SPLIT_S1) {
      zone = 'bridgeSplit';
      halfW = 9.0;
      flatMask = 0;
    } else if (s >= LOOP_S0 - 6 && s <= LOOP_S1 + 6) {
      zone = 'loop';
      flatMask = 0;
    } else if (
      (s >= RAMPS[0].sStart - 4 && s <= RAMPS[0].sEnd + 4) ||
      (s >= RAMPS[1].sStart - 4 && s <= RAMPS[1].sEnd + 4)
    ) {
      zone = 'ramp';
      flatMask = 0;
    } else if ((s >= 150 && s <= 262) || (s >= 820 && s <= 1172)) {
      zone = 'banked';
      halfW = W_BANK * 0.5;
      flatMask = 1.45;
    }

    // Ketika belok kanan (crossY > 0), sisi luar adalah sisi kiri (-X), jadi sisi kiri naik & sisi kanan turun -> bank negatif (-rawCurv)
    lut[i].bank = THREE.MathUtils.clamp(-rawCurv * 0.145 * flatMask, -0.17, 0.17);
    lut[i].halfW = halfW;
    lut[i].zone = zone;
  }

  // Haluskan bank 2 pass agar transisi kemiringan empuk di mata
  const smoothedBank = new Float32Array(LUT_N);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < LUT_N; i++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += lut[(i + k + LUT_N) % LUT_N].bank;
      smoothedBank[i] = sum / 7;
    }
    for (let i = 0; i < LUT_N; i++) lut[i].bank = smoothedBank[i];
  }

  return {
    lut,
    bounds: {
      minX, maxX, minZ, maxZ,
      centerX: (minX + maxX) * 0.5,
      centerZ: (minZ + maxZ) * 0.5,
      spanX: maxX - minX,
      spanZ: maxZ - minZ,
    },
  };
}

const { lut: LUT, bounds: CIRCUIT_BOUNDS } = buildMandalikaLUT();

/* ---------- Interpolasi O(1) Zero-GC pada Spline Mandalika ---------- */
const _sFwd = new THREE.Vector3();
const _sRight = new THREE.Vector3();
const _sUp = new THREE.Vector3();
const _sPos = new THREE.Vector3();

function sampleCenterline(s, outPos = _sPos, outFwd = _sFwd, outRight = _sRight, outUp = _sUp) {
  const ws = wrapS(s);
  const fIdx = ws / DS;
  const i0 = Math.floor(fIdx) % LUT_N;
  const i1 = (i0 + 1) % LUT_N;
  const frac = fIdx - Math.floor(fIdx);
  const a = LUT[i0];
  const b = LUT[i1];

  outPos.set(
    a.px + (b.px - a.px) * frac,
    a.py + (b.py - a.py) * frac,
    a.pz + (b.pz - a.pz) * frac
  );
  outFwd.set(
    a.fx + (b.fx - a.fx) * frac,
    a.fy + (b.fy - a.fy) * frac,
    a.fz + (b.fz - a.fz) * frac
  ).normalize();
  outRight.set(
    a.rx + (b.rx - a.rx) * frac,
    a.ry + (b.ry - a.ry) * frac,
    a.rz + (b.rz - a.rz) * frac
  ).normalize();
  outUp.crossVectors(outRight, outFwd).normalize();

  return {
    bank: a.bank + (b.bank - a.bank) * frac,
    halfW: a.halfW + (b.halfW - a.halfW) * frac,
    zone: frac < 0.5 ? a.zone : b.zone,
  };
}

function getSplitBridgeOffset(s) {
  const ws = wrapS(s);
  if (ws <= SPLIT_S0 || ws >= SPLIT_S1) return 0;
  if (ws < SPLIT_CLIMB_END) return SPLIT_HEIGHT * smoothstep(SPLIT_S0, SPLIT_CLIMB_END, ws);
  if (ws > SPLIT_DESC_START) return SPLIT_HEIGHT * (1 - smoothstep(SPLIT_DESC_START, SPLIT_S1, ws));
  return SPLIT_HEIGHT;
}

function getSplitBridgeSlope(s) {
  const e = 0.5;
  return (getSplitBridgeOffset(s + e) - getSplitBridgeOffset(s - e)) / (2 * e);
}

export function evalCircuitPose(s, latX = 0, outPos = null, outFwd = null, outRight = null, outUp = null) {
  const meta = sampleCenterline(s, _sPos, _sFwd, _sRight, _sUp);
  if (outPos) {
    outPos.copy(_sPos).addScaledVector(_sRight, latX);
    outPos.y += latX * meta.bank;
  }
  if (outFwd) outFwd.copy(_sFwd);
  if (outRight) outRight.copy(_sRight);
  if (outUp) outUp.copy(_sUp);
  return meta;
}

export function getCircuitSurfaceAt(s, latX = 0) {
  const ws = wrapS(s);
  const meta = sampleCenterline(ws, _sPos, _sFwd, _sRight, _sUp);
  const baseY = _sPos.y;
  const bank = meta.bank;
  const hw = meta.halfW;
  const slope = _sFwd.y;

  // 1) Upper/Lower Split-Level Shortcut (Turns 4-6)
  if (ws >= SPLIT_S0 && ws <= SPLIT_S1) {
    const splitBlend = smoothstep(SPLIT_S0, SPLIT_S0 + 10, ws) * (1 - smoothstep(SPLIT_S1 - 10, SPLIT_S1, ws));
    if (splitBlend < 0.25) {
      const onTrack = Math.abs(latX) <= hw + 0.45;
      return {
        type: 'fork', onTrack, groundY: baseY + latX * bank, slope, bank,
        safeCenterX: 0, safeHalfW: hw, inGap: !onTrack, hasGuardrails: true, onUpperBridge: false,
      };
    }
    const onUpper = Math.abs(latX - SPLIT_UP_CX) <= SPLIT_UP_HW + 0.35;
    const onLower = Math.abs(latX - SPLIT_LO_CX) <= SPLIT_LO_HW + 0.35;
    const nearUpper = latX < -0.35;
    const bridgeOff = nearUpper ? getSplitBridgeOffset(ws) : 0;
    const bridgeSlope = nearUpper ? getSplitBridgeSlope(ws) : 0;
    return {
      type: 'fork',
      onTrack: onUpper || onLower,
      groundY: baseY + bridgeOff,
      slope: slope + bridgeSlope,
      bank: 0,
      safeCenterX: nearUpper ? SPLIT_UP_CX : SPLIT_LO_CX,
      safeHalfW: nearUpper ? SPLIT_UP_HW : SPLIT_LO_HW,
      inGap: !(onUpper || onLower),
      hasGuardrails: true,
      onUpperBridge: nearUpper && bridgeOff > 1.0,
    };
  }

  // 2) Dual-Choice 360° Vertical Loop (Back straight sebelum Turn 10)
  if (ws >= LOOP_S0 && ws <= LOOP_S1) {
    const u = (ws - LOOP_S0) / (LOOP_S1 - LOOP_S0);
    const onEntryExit = u < 0.08 || u > 0.92;
    const onLoop = Math.abs(latX - LOOP_CENTER_X) <= LOOP_HALF_W + 0.45;
    const onBypass = Math.abs(latX - BYPASS_CENTER_X) <= BYPASS_HALF_W + 0.45;
    const onTrack = onEntryExit ? Math.abs(latX) <= hw + 0.5 : (onLoop || onBypass);
    const nearLoop = latX < 0;
    return {
      type: 'loop', onTrack, groundY: baseY, slope, bank: 0,
      safeCenterX: nearLoop ? LOOP_CENTER_X : BYPASS_CENTER_X,
      safeHalfW: nearLoop ? LOOP_HALF_W : BYPASS_HALF_W,
      inGap: !onTrack, hasGuardrails: true, onUpperBridge: false,
    };
  }

  // 3) Jump Ramp & Chasm
  for (let r = 0; r < RAMPS.length; r++) {
    const rp = RAMPS[r];
    if (ws >= rp.sStart && ws <= rp.sEnd) {
      const onGapSide = (latX * rp.side) > -0.25;
      const inChasm = onGapSide && ws >= rp.gapStart && ws <= rp.gapEnd;
      const onTrack = !inChasm && Math.abs(latX) <= hw + 0.45;
      return {
        type: 'ramp', onTrack,
        groundY: baseY + latX * bank,
        slope, bank,
        safeCenterX: inChasm ? -rp.side * rp.offset : 0,
        safeHalfW: inChasm ? RAMP_SAFE_W * 0.48 : hw,
        inGap: inChasm || !onTrack,
        hasGuardrails: !inChasm,
        rampSide: rp.side,
        onUpperBridge: false,
      };
    }
  }

  return {
    type: meta.zone,
    onTrack: Math.abs(latX) <= hw + 0.5,
    groundY: baseY + latX * bank,
    slope, bank,
    safeCenterX: 0,
    safeHalfW: hw,
    inGap: false,
    hasGuardrails: true,
    onUpperBridge: false,
  };
}

export function getLoopZoneAtS(s) {
  const ws = wrapS(s);
  if (ws >= LOOP_S0 && ws <= LOOP_S1) {
    return {
      active: true,
      sStart: LOOP_S0,
      sEnd: LOOP_S1,
      centerLatX: LOOP_CENTER_X,
      halfW: LOOP_HALF_W,
      arcLen: LOOP_ARC_LEN,
    };
  }
  return null;
}

const _lpBasePos = new THREE.Vector3();
const _lpBaseFwd = new THREE.Vector3();
const _lpBaseRight = new THREE.Vector3();
const _lpBaseUp = new THREE.Vector3();
const _lpFwd = new THREE.Vector3();
const _lpInward = new THREE.Vector3();
const _lpUp = new THREE.Vector3();
const _lpRight = new THREE.Vector3();
const _lpZAxis = new THREE.Vector3();
const _lpMat = new THREE.Matrix4();

export function evalLoopPoseAtS(sStart, sEnd, u, latX, outPos, outQuat, outRight = null, outFwd = null) {
  const clampedU = Math.min(1, Math.max(0, u));
  const theta = clampedU * Math.PI * 2;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const sBase = THREE.MathUtils.lerp(sStart, sEnd, clampedU);
  sampleCenterline(sBase, _lpBasePos, _lpBaseFwd, _lpBaseRight, _lpBaseUp);

  const cx = _lpBasePos.x
    + _lpBaseRight.x * (LOOP_CENTER_X - LOOP_HELIX * sinT)
    + _lpBaseUp.x * (LOOP_RADIUS * (1 - cosT))
    + _lpBaseFwd.x * (LOOP_RADIUS * sinT);
  const cy = _lpBasePos.y
    + _lpBaseRight.y * (LOOP_CENTER_X - LOOP_HELIX * sinT)
    + _lpBaseUp.y * (LOOP_RADIUS * (1 - cosT))
    + _lpBaseFwd.y * (LOOP_RADIUS * sinT);
  const cz = _lpBasePos.z
    + _lpBaseRight.z * (LOOP_CENTER_X - LOOP_HELIX * sinT)
    + _lpBaseUp.z * (LOOP_RADIUS * (1 - cosT))
    + _lpBaseFwd.z * (LOOP_RADIUS * sinT);

  const dTheta = Math.PI * 2;
  const spanS = sEnd - sStart;
  _lpFwd.set(0, 0, 0)
    .addScaledVector(_lpBaseFwd, spanS + LOOP_RADIUS * cosT * dTheta)
    .addScaledVector(_lpBaseUp, LOOP_RADIUS * sinT * dTheta)
    .addScaledVector(_lpBaseRight, -LOOP_HELIX * cosT * dTheta)
    .normalize();

  _lpInward.set(0, 0, 0)
    .addScaledVector(_lpBaseUp, cosT)
    .addScaledVector(_lpBaseFwd, -sinT);
  const dot = _lpInward.dot(_lpFwd);
  _lpUp.copy(_lpInward).addScaledVector(_lpFwd, -dot).normalize();
  _lpRight.crossVectors(_lpFwd, _lpUp).normalize();

  if (outPos) {
    outPos.set(
      cx + _lpRight.x * latX,
      cy + _lpRight.y * latX,
      cz + _lpRight.z * latX
    );
  }
  if (outQuat) {
    _lpZAxis.copy(_lpFwd).negate();
    _lpMat.makeBasis(_lpRight, _lpUp, _lpZAxis);
    outQuat.setFromRotationMatrix(_lpMat);
  }
  if (outRight) outRight.copy(_lpRight);
  if (outFwd) outFwd.copy(_lpFwd);
}

export function checkCircuitRampCollision(s, latX) {
  const ws = wrapS(s);
  for (let r = 0; r < RAMPS.length; r++) {
    const rp = RAMPS[r];
    if (Math.abs(ws - rp.sCenter) < rp.rampLen * 0.5 && Math.abs(latX - rp.side * rp.offset) < RAMP_W * 0.5) {
      return { s: rp.sCenter, latX: rp.side * rp.offset, launchVy: PHYSICS.ramp.launchVy };
    }
  }
  return null;
}

export function checkCircuitBoostCollision(s, latX) {
  const ws = wrapS(s);
  for (let b = 0; b < BOOSTS.length; b++) {
    const bp = BOOSTS[b];
    if (Math.abs(ws - bp.sCenter) < BOOST_LEN * 0.5 + 1.2 && Math.abs(latX) < BOOST_W * 0.5) {
      return { s: bp.sCenter, width: BOOST_W };
    }
  }
  // Pendorong masuk loop 360°
  if (Math.abs(ws - (LOOP_S0 + 1.6)) < 2.2 && Math.abs(latX - LOOP_CENTER_X) < LOOP_HALF_W) {
    return { s: LOOP_S0 + 1.6, width: LOOP_HALF_W * 2 };
  }
  return null;
}

// Titik siluet sirkuit tertutup untuk minimap bundar
const PREVIEW_STEPS = 120;
const STATIC_PREVIEW_PTS = (() => {
  const pts = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= PREVIEW_STEPS; i++) {
    const s = (i / PREVIEW_STEPS) * TOTAL_LEN;
    sampleCenterline(s, p);
    const meta = LUT[Math.floor((wrapS(s) / DS)) % LUT_N];
    pts.push({
      x: p.x,
      y: p.y + (s >= SPLIT_S0 && s <= SPLIT_S1 ? 2.5 : 0),
      z: p.z,
      zone: meta.zone,
    });
  }
  return pts;
})();

export function getCircuitPreviewPoints(out = []) {
  out.length = 0;
  for (let i = 0; i < STATIC_PREVIEW_PTS.length; i++) out.push(STATIC_PREVIEW_PTS[i]);
  return out;
}

export const isSplineCircuit = true;
export const getTrackSurfaceAt = getCircuitSurfaceAt;
export const checkRampCollision = checkCircuitRampCollision;
export const checkBoostCollision = checkCircuitBoostCollision;
export function getTrackHeight() { return LUT[0]?.py ?? START_Y; }
export function getTrackSlope() { return 0; }
export function getTrackCenterX() { return 0; }
export function getTrackYaw() { return 0; }
export function getTrackBank() { return 0; }
export function getRampSide() { return 1; }
export function getSegmentType(i) { return LUT[((i * 12) % LUT_N + LUT_N) % LUT_N].zone; }
export function evalLoopPose(sStart, sEnd, _y0, _y1, u, latX, outPos, outQuat, outRight = null) {
  return evalLoopPoseAtS(sStart, sEnd, u, latX, outPos, outQuat, outRight);
}

/* ==================== Pembantu Tekstur Prosedural ==================== */
function makeOrangeTrackTex() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#e85d04');
  grad.addColorStop(0.06, '#ff6b00');
  grad.addColorStop(0.5, '#ff7b1c');
  grad.addColorStop(0.94, '#ff6b00');
  grad.addColorStop(1, '#e85d04');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  // Center speed stripe & longitudinal Hot Wheels track grooves
  g.fillStyle = 'rgba(255, 245, 220, 0.24)';
  g.fillRect(size * 0.486, 0, size * 0.028, size);
  for (const gx of [0.18, 0.30, 0.42, 0.58, 0.70, 0.82]) {
    g.fillStyle = 'rgba(154, 48, 0, 0.24)';
    g.fillRect(size * gx, 0, 4, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
  g.fillStyle = 'rgba(34, 197, 94, 0.36)';
  g.fillRect(size * 0.25, 0, size * 0.5, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
      if (x === 0) g.moveTo(x, wy); else g.lineTo(x, wy);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}

function makeBannerTex(text, c0, c1, border = '#ffd100', checkered = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, c0); grad.addColorStop(0.5, c1); grad.addColorStop(1, c0);
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
  g.strokeStyle = border; g.lineWidth = 12;
  g.beginPath(); g.roundRect(14, 14, 996, 164, 20); g.stroke();
  g.fillStyle = '#fff8eb';
  g.font = '700 46px Fredoka, "Plus Jakarta Sans", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeChevronSignTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd100'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#18181b'; g.lineWidth = 26; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(64, 48); g.lineTo(188, 128); g.lineTo(64, 208); g.stroke();
  g.strokeStyle = '#ff6b00'; g.lineWidth = 12; g.strokeRect(8, 8, 240, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWarnTriangleTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e11d48'; g.strokeStyle = '#ffffff'; g.lineWidth = 16; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(128, 22); g.lineTo(234, 218); g.lineTo(22, 218); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#b91c1c';
  g.beginPath(); g.moveTo(128, 56); g.lineTo(198, 192); g.lineTo(58, 192); g.closePath(); g.fill();
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
  g.fillStyle = '#ff4d00'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff'; g.lineWidth = 22; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let y = 52; y <= 212; y += 72) {
    g.beginPath(); g.moveTo(48, y + 34); g.lineTo(128, y - 18); g.lineTo(208, y + 34); g.stroke();
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

/* ==================== Pembangun Pita U-Channel Spline Statis ==================== */
const DECK_THICK = 0.65;
const WALL_W = 0.44;
const WALL_H = 0.36;

function buildBeveledSplineMesh(slices, material, evalSlice) {
  const g = new THREE.BufferGeometry();
  const N = 8;
  const vertCount = slices.length * N;
  const pos = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const idx = [];
  const uCoords = [0.02, 0.06, 0.10, 0.90, 0.94, 0.98, 0.98, 0.02];

  for (let i = 0; i < slices.length; i++) {
    const sl = evalSlice(slices[i], i);
    const b = i * N;
    const v = sl.v ?? (i * 0.22);
    for (let k = 0; k < N; k++) {
      const pt = sl.pts[k];
      const pOff = (b + k) * 3;
      pos[pOff] = pt.x;
      pos[pOff + 1] = pt.y;
      pos[pOff + 2] = pt.z;
      const uOff = (b + k) * 2;
      uv[uOff] = uCoords[k];
      uv[uOff + 1] = v;
    }
    if (i < slices.length - 1 && !slices[i + 1].breakBefore) {
      for (let k = 0; k < N; k++) {
        const kNext = (k + 1) % N;
        const a = b + k;
        const c = b + kNext;
        const d = b + N + k;
        const e = b + N + kNext;
        // Outward CCW winding: (+X) x (-Z) = +Y on road surface
        idx.push(a, c, d, c, e, d);
      }
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function buildRailSplineMesh(slices, material, evalSlice) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(slices.length * 2 * 3);
  const uv = new Float32Array(slices.length * 2 * 2);
  const idx = [];
  for (let i = 0; i < slices.length; i++) {
    const sl = evalSlice(slices[i], i);
    const b = i * 2;
    pos.set([sl.bot.x, sl.bot.y, sl.bot.z, sl.top.x, sl.top.y, sl.top.z], b * 3);
    const v = i * 0.25;
    uv.set([0, v, 1, v], b * 2);
    if (i < slices.length - 1 && !slices[i + 1].breakBefore) {
      const a = b, c = b + 1, d = b + 2, e = b + 3;
      idx.push(a, c, d, c, e, d);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/* =====================================================================
   createMandalikaTrack(scene, opts)
   ===================================================================== */
export function createMandalikaTrack(scene, { maxAnisotropy = 8 } = {}) {
  const root = new THREE.Group();
  scene.add(root);

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
  const texStartBanner = tuneTex(makeBannerTex('🏝️ MANDALIKA SKY CIRCUIT • GRAND PRIX 🏁', '#0055cc', '#ff6b00', '#ffd100', true));
  const texSector500 = tuneTex(makeBannerTex('⚡ SEKTOR PESISIR • JEMBATAN BUAH 500M ⚡', '#1e3a8a', '#0ea5e9', '#ffd100', false));
  const texSector1000 = tuneTex(makeBannerTex('🐉 S-CURVE MANDALIKA • TEROWONGAN GARUDA 1000M 🔥', '#9a3412', '#ff6b00', '#ffbe0b', false));
  const texChevronSign = tuneTex(makeChevronSignTex());
  const texWarn = tuneTex(makeWarnTriangleTex());
  const texCheckered = tuneTex(makeCheckeredStripeTex());
  const texRampChev = tuneTex(makeRampChevronTex());
  const texGlowRing = tuneTex(makeGlowRingTex());
  const texHazard = tuneTex(makeHazardStripeTex());

  const matSkyOrange = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texOrange, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matBankYellow = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texYellow, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matBoostBlue = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texBlue, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matRailBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matRailOrange = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const matDeckSide = new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.36, metalness: 0.08, side: THREE.DoubleSide });
  const matConnectorBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.34, metalness: 0.08, emissive: '#0044aa', emissiveIntensity: 0.14 });
  const matOcean = new THREE.MeshStandardMaterial({ map: texOcean, roughness: 0.26, metalness: 0.16 });
  const matGreenBoost = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#16a34a', emissiveIntensity: 0.9, roughness: 0.26 });
  const matBoosterWheel = new THREE.MeshStandardMaterial({ color: '#ffd100', emissive: '#ffaa00', emissiveIntensity: 0.26, roughness: 0.36, metalness: 0.08 });
  const matRamp = new THREE.MeshStandardMaterial({ map: texRampChev, emissive: '#ff3b00', emissiveMap: texRampChev, emissiveIntensity: 0.22, roughness: 0.36, metalness: 0.08 });
  const matHazardStripe = new THREE.MeshStandardMaterial({ map: texHazard, roughness: 0.36, metalness: 0.08, emissive: '#ffbe0b', emissiveIntensity: 0.16 });
  const matCheckered = new THREE.MeshStandardMaterial({ map: texCheckered, roughness: 0.36, metalness: 0.06 });
  const matArchBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.36, metalness: 0.08 });
  const matArchRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.36, metalness: 0.08 });
  const matArchOrange = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.36, metalness: 0.08 });
  const matFlameTorch = new THREE.MeshStandardMaterial({ color: '#ffbe0b', emissive: '#ff5400', emissiveIntensity: 1.4, roughness: 0.2 });

  const matGarudaGold = new THREE.MeshStandardMaterial({ color: '#fbbf24', metalness: 0.72, roughness: 0.24, emissive: '#b45309', emissiveIntensity: 0.16 });
  const matGarudaBronze = new THREE.MeshStandardMaterial({ color: '#92400e', metalness: 0.65, roughness: 0.35 });
  const matGarudaEye = new THREE.MeshStandardMaterial({ color: '#ff2a4b', emissive: '#ff0033', emissiveIntensity: 1.8, roughness: 0.18 });
  const matEnergyOrb = new THREE.MeshStandardMaterial({ color: '#ff2a4b', emissive: '#ef4444', emissiveIntensity: 1.65, roughness: 0.15, metalness: 0.2 });
  const matEnergyRing = new THREE.MeshBasicMaterial({ color: '#fca5a5', transparent: true, opacity: 0.85 });
  const matWarnSign = new THREE.MeshStandardMaterial({ map: texWarn, transparent: true, alphaTest: 0.15, side: THREE.DoubleSide, emissive: '#ff2a4b', emissiveMap: texWarn, emissiveIntensity: 0.6, roughness: 0.28 });

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

  const matTrussSteel = new THREE.MeshStandardMaterial({ color: '#1d4ed8', metalness: 0.42, roughness: 0.34 });
  const matChevronSign = new THREE.MeshStandardMaterial({ map: texChevronSign, roughness: 0.28, emissive: '#ffd100', emissiveMap: texChevronSign, emissiveIntensity: 0.22 });
  const matIslandSand = new THREE.MeshStandardMaterial({ color: '#fde68a', roughness: 0.85 });
  const matIslandLush = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.72 });
  const matCoastHill = new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.78 });
  const matPalmTrunk = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.8 });
  const matPalmCrown = new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.65 });
  const matPostBlue = new THREE.MeshStandardMaterial({ color: '#0077ff', roughness: 0.36, metalness: 0.08 });
  const matPostOrange = new THREE.MeshStandardMaterial({ color: '#ff6b00', roughness: 0.36, metalness: 0.08 });
  const matPropBarrelRed = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.36, metalness: 0.08 });
  const matPropBarrelYellow = new THREE.MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.36, metalness: 0.08 });

  const disposablesGeo = [];
  const disposablesMat = [
    matSkyOrange, matBankYellow, matBoostBlue, matRailBlue, matRailOrange, matDeckSide, matConnectorBlue,
    matOcean, matGreenBoost, matBoosterWheel, matRamp, matHazardStripe, matCheckered, matArchBlue, matArchRed,
    matArchOrange, matFlameTorch, matGarudaGold, matGarudaBronze, matGarudaEye, matEnergyOrb, matEnergyRing,
    matWarnSign, matCoinGold, matCoinRim, matGemHalo, matFireRing, matFireFlame, matTrussSteel, matChevronSign,
    matIslandSand, matIslandLush, matCoastHill, matPalmTrunk, matPalmCrown, matPostBlue, matPostOrange,
    matPropBarrelRed, matPropBarrelYellow, ...Object.values(ringMats),
  ];
  const disposablesTex = [
    texOrange, texYellow, texBlue, texOcean, texStartBanner, texSector500, texSector1000,
    texChevronSign, texWarn, texCheckered, texRampChev, texGlowRing, texHazard,
  ];

  /* ---------- 1) Samudra Tropis Mandalika ---------- */
  const oceanSize = Math.max(CIRCUIT_BOUNDS.spanX, CIRCUIT_BOUNDS.spanZ) + 460;
  const geoOcean = new THREE.PlaneGeometry(oceanSize, oceanSize);
  geoOcean.rotateX(-Math.PI / 2);
  disposablesGeo.push(geoOcean);
  const oceanMesh = new THREE.Mesh(geoOcean, matOcean);
  oceanMesh.position.set(CIRCUIT_BOUNDS.centerX, MANDALIKA_OCEAN_Y, CIRCUIT_BOUNDS.centerZ);
  oceanMesh.receiveShadow = true;
  root.add(oceanMesh);

  /* ---------- 2) Permukaan Trek Utama & Pita Sektor (Statis, 3 Draw Calls Utama) ---------- */
  const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  const _basis = new THREE.Matrix4(), _zAxis = new THREE.Vector3(), _q = new THREE.Quaternion();
  const _dummy = new THREE.Object3D();

  function makeBasisQuat(s, extraY = 0) {
    const meta = evalCircuitPose(s, 0, null, _f, _r, _u);
    _zAxis.copy(_f).negate();
    _basis.makeBasis(_r, _u, _zAxis);
    _q.setFromRotationMatrix(_basis);
    if (meta.bank !== 0) {
      const bq = new THREE.Quaternion().setFromAxisAngle(_f, -meta.bank);
      _q.premultiply(bq);
    }
    if (extraY) {
      const yq = new THREE.Quaternion().setFromAxisAngle(_u, extraY);
      _q.multiply(yq);
    }
    return _q;
  }

  function buildDeckSlice(s, lxMin, lxMax, yOff = 0) {
    const meta = sampleCenterline(s, _p, _f, _r, _u);
    const yL = yOff + lxMin * meta.bank;
    const yR = yOff + lxMax * meta.bank;
    const x0 = lxMin - WALL_W;
    const x1 = lxMin;
    const x2 = lxMin + 0.14;
    const x3 = lxMax - 0.14;
    const x4 = lxMax;
    const x5 = lxMax + WALL_W;

    const pt = (lx, dy) => {
      const v = _p.clone().addScaledVector(_r, lx);
      v.y += dy;
      return v;
    };
    return {
      pts: [
        pt(x0, yL + WALL_H),
        pt(x1, yL + WALL_H),
        pt(x2, yL),
        pt(x3, yR),
        pt(x4, yR + WALL_H),
        pt(x5, yR + WALL_H),
        pt(x5, yR - DECK_THICK),
        pt(x0, yL - DECK_THICK),
      ],
      v: s * 0.1,
    };
  }

  // Klasifikasi tiap langkah 2m di sepanjang 1500m lintasan
  function zoneMatKind(s) {
    const ws = wrapS(s);
    if ((ws >= 96 && ws <= 138) || (ws >= 690 && ws <= 730) || (ws >= 1178 && ws <= 1218)) return 'blue';
    if ((ws >= 146 && ws <= 268) || (ws >= 816 && ws <= 1174)) return 'yellow';
    return 'orange';
  }

  // Bangun potongan pita berurutan per jenis material agar draw call minim
  const sectorSlices = { orange: [], yellow: [], blue: [] };
  const stepS = 2.0;
  for (let s = 0; s < TOTAL_LEN; s += stepS) {
    const sNext = s + stepS;
    const midS = s + stepS * 0.5;
    // Lewati bagian khusus (split bridge, loop, ramp chasm) yg digambar terpisah
    const inSplit = midS > SPLIT_S0 + 2 && midS < SPLIT_S1 - 2;
    const inLoop = midS > LOOP_S0 + 1 && midS < LOOP_S1 - 1;
    const inRampGap = RAMPS.some((rp) => midS > rp.gapStart && midS < rp.gapEnd);
    if (inSplit || inLoop || inRampGap) continue;

    const kind = zoneMatKind(midS);
    const arr = sectorSlices[kind];
    const prevS = arr.length ? arr[arr.length - 1].sEnd : -999;
    const breakBefore = Math.abs(prevS - s) > 0.2;
    if (breakBefore || arr.length === 0) {
      arr.push({ s, sEnd: s, breakBefore: true });
    }
    arr.push({ s: sNext, sEnd: sNext, breakBefore: false });
  }

  // Filter agar pasangan berurutan bersih
  function buildZonedDeck(list, mat) {
    if (!list.length) return;
    const mesh = buildBeveledSplineMesh(list, mat, (sl) => {
      const meta = sampleCenterline(sl.s);
      return buildDeckSlice(sl.s, -meta.halfW, meta.halfW, 0);
    });
    disposablesGeo.push(mesh.geometry);
    root.add(mesh);
  }
  buildZonedDeck(sectorSlices.orange, matSkyOrange);
  buildZonedDeck(sectorSlices.yellow, matBankYellow);
  buildZonedDeck(sectorSlices.blue, matBoostBlue);

  // Jalur Aman saat Jump Ramp (sisi seberang jurang)
  for (const rp of RAMPS) {
    const safeSlices = [];
    for (let s = rp.gapStart - 1; s <= rp.gapEnd + 1; s += 1.5) {
      safeSlices.push({ s, breakBefore: safeSlices.length === 0 });
    }
    const safeMesh = buildBeveledSplineMesh(safeSlices, matSkyOrange, (sl) => {
      const cx = -rp.side * rp.offset;
      return buildDeckSlice(sl.s, cx - RAMP_SAFE_W * 0.5, cx + RAMP_SAFE_W * 0.5, 0);
    });
    disposablesGeo.push(safeMesh.geometry);
    root.add(safeMesh);
  }

  /* ---------- 3) Upper/Lower Split-Level Shortcut (Turns 4-6: Jembatan Buah Bertingkat) ---------- */
  const splitSlices = [];
  for (let s = SPLIT_S0; s <= SPLIT_S1; s += 2.0) {
    splitSlices.push({ s, breakBefore: splitSlices.length === 0 });
  }
  const upperBridgeMesh = buildBeveledSplineMesh(splitSlices, matSkyOrange, (sl) => {
    const blend = smoothstep(SPLIT_S0, SPLIT_S0 + 10, sl.s) * (1 - smoothstep(SPLIT_S1 - 10, SPLIT_S1, sl.s));
    const hw = THREE.MathUtils.lerp(9.0, SPLIT_UP_HW, blend);
    const cx = THREE.MathUtils.lerp(0, SPLIT_UP_CX, blend);
    return buildDeckSlice(sl.s, cx - hw, cx + hw, getSplitBridgeOffset(sl.s));
  });
  const lowerCoastMesh = buildBeveledSplineMesh(splitSlices, matBankYellow, (sl) => {
    const blend = smoothstep(SPLIT_S0, SPLIT_S0 + 10, sl.s) * (1 - smoothstep(SPLIT_S1 - 10, SPLIT_S1, sl.s));
    const hw = THREE.MathUtils.lerp(9.0, SPLIT_LO_HW, blend);
    const cx = THREE.MathUtils.lerp(0, SPLIT_LO_CX, blend);
    return buildDeckSlice(sl.s, cx - hw, cx + hw, 0);
  });
  const upperRailL = buildRailSplineMesh(splitSlices, matRailBlue, (sl) => {
    const blend = smoothstep(SPLIT_S0, SPLIT_S0 + 10, sl.s) * (1 - smoothstep(SPLIT_S1 - 10, SPLIT_S1, sl.s));
    const cx = THREE.MathUtils.lerp(0, SPLIT_UP_CX, blend) - THREE.MathUtils.lerp(9.0, SPLIT_UP_HW, blend);
    sampleCenterline(sl.s, _p, _f, _r, _u);
    const yOff = getSplitBridgeOffset(sl.s);
    const bot = _p.clone().addScaledVector(_r, cx); bot.y += yOff;
    const top = bot.clone(); top.y += 0.62;
    return { bot, top };
  });
  const upperRailR = buildRailSplineMesh(splitSlices, matRailBlue, (sl) => {
    const blend = smoothstep(SPLIT_S0, SPLIT_S0 + 10, sl.s) * (1 - smoothstep(SPLIT_S1 - 10, SPLIT_S1, sl.s));
    const cx = THREE.MathUtils.lerp(0, SPLIT_UP_CX, blend) + THREE.MathUtils.lerp(9.0, SPLIT_UP_HW, blend);
    sampleCenterline(sl.s, _p, _f, _r, _u);
    const yOff = getSplitBridgeOffset(sl.s);
    const bot = _p.clone().addScaledVector(_r, cx); bot.y += yOff;
    const top = bot.clone(); top.y += 0.62;
    return { bot, top };
  });
  disposablesGeo.push(upperBridgeMesh.geometry, lowerCoastMesh.geometry, upperRailL.geometry, upperRailR.geometry);
  root.add(upperBridgeMesh, lowerCoastMesh, upperRailL, upperRailR);

  /* ---------- 4) Dual-Choice 360° Vertical Loop (Back straight sebelum Turn 10) ---------- */
  const loopSlices = [];
  for (let k = 0; k <= LOOP_STEPS; k++) {
    loopSlices.push({ u: k / LOOP_STEPS, breakBefore: k === 0 });
  }
  const _lpL0 = new THREE.Vector3(), _lpR1 = new THREE.Vector3(), _lpCenter = new THREE.Vector3(), _lpRightTmp = new THREE.Vector3();
  const loopDeck = buildBeveledSplineMesh(loopSlices, matSkyOrange, (sl) => {
    evalLoopPoseAtS(LOOP_S0, LOOP_S1, sl.u, 0, _lpCenter, null, _lpRightTmp);
    const theta = sl.u * Math.PI * 2;
    sampleCenterline(THREE.MathUtils.lerp(LOOP_S0, LOOP_S1, sl.u), _p, _f, _r, _u);
    const inward = _u.clone().multiplyScalar(Math.cos(theta)).addScaledVector(_f, -Math.sin(theta)).normalize();
    const lp = (lx, hIn) => _lpCenter.clone().addScaledVector(_lpRightTmp, lx).addScaledVector(inward, hIn);
    return {
      pts: [
        lp(-LOOP_HALF_W - WALL_W, WALL_H),
        lp(-LOOP_HALF_W, WALL_H),
        lp(-LOOP_HALF_W + 0.14, 0),
        lp(LOOP_HALF_W - 0.14, 0),
        lp(LOOP_HALF_W, WALL_H),
        lp(LOOP_HALF_W + WALL_W, WALL_H),
        lp(LOOP_HALF_W + WALL_W, -DECK_THICK),
        lp(-LOOP_HALF_W - WALL_W, -DECK_THICK),
      ],
      v: sl.u * 4,
    };
  });
  const loopRailL = buildRailSplineMesh(loopSlices, matRailBlue, (sl) => {
    const theta = sl.u * Math.PI * 2;
    sampleCenterline(THREE.MathUtils.lerp(LOOP_S0, LOOP_S1, sl.u), _p, _f, _r, _u);
    const inward = _u.clone().multiplyScalar(Math.cos(theta)).addScaledVector(_f, -Math.sin(theta)).normalize();
    evalLoopPoseAtS(LOOP_S0, LOOP_S1, sl.u, -LOOP_HALF_W - 0.1, _lpL0);
    return { bot: _lpL0.clone(), top: _lpL0.clone().addScaledVector(inward, 0.72) };
  });
  const loopRailR = buildRailSplineMesh(loopSlices, matRailBlue, (sl) => {
    const theta = sl.u * Math.PI * 2;
    sampleCenterline(THREE.MathUtils.lerp(LOOP_S0, LOOP_S1, sl.u), _p, _f, _r, _u);
    const inward = _u.clone().multiplyScalar(Math.cos(theta)).addScaledVector(_f, -Math.sin(theta)).normalize();
    evalLoopPoseAtS(LOOP_S0, LOOP_S1, sl.u, LOOP_HALF_W + 0.1, _lpR1);
    return { bot: _lpR1.clone(), top: _lpR1.clone().addScaledVector(inward, 0.72) };
  });
  const bypassSlices = [];
  for (let s = LOOP_S0; s <= LOOP_S1; s += 2) bypassSlices.push({ s, breakBefore: bypassSlices.length === 0 });
  const loopBypassMesh = buildBeveledSplineMesh(bypassSlices, matBankYellow, (sl) =>
    buildDeckSlice(sl.s, BYPASS_CENTER_X - BYPASS_HALF_W, BYPASS_CENTER_X + BYPASS_HALF_W, 0)
  );
  disposablesGeo.push(loopDeck.geometry, loopRailL.geometry, loopRailR.geometry, loopBypassMesh.geometry);
  root.add(loopDeck, loopRailL, loopRailR, loopBypassMesh);

  /* ---------- 5) Ramp Lompat, Booster Pad & Connector Biru ---------- */
  const geoRamp = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(-2.7, 0); shape.lineTo(2.7, 0); shape.lineTo(2.7, 1.8); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: RAMP_W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    g.center(); g.rotateY(Math.PI / 2);
    return g;
  })();
  const geoRampLip = new RoundedBoxGeometry(RAMP_W + 0.28, 0.34, 0.78, 2, 0.08);
  const geoBoostPad = new RoundedBoxGeometry(BOOST_W, 0.14, BOOST_LEN + 2.2, 3, 0.06);
  const geoGreenChev = new RoundedBoxGeometry(3.8, 0.09, 0.55, 2, 0.03);
  const geoBoosterHousing = new RoundedBoxGeometry(1.35, 1.32, BOOST_LEN + 1.6, 3, 0.2);
  const geoBoosterWheel = new THREE.CylinderGeometry(1.02, 1.02, 0.46, 14); geoBoosterWheel.rotateZ(Math.PI / 2);
  disposablesGeo.push(geoRamp, geoRampLip, geoBoostPad, geoGreenChev, geoBoosterHousing, geoBoosterWheel);

  for (const rp of RAMPS) {
    evalCircuitPose(rp.sCenter, rp.side * rp.offset, _p, _f, _r, _u);
    const rg = new THREE.Mesh(geoRamp, matRamp);
    rg.position.copy(_p);
    rg.position.y += rp.rise * 0.5 - 0.05;
    rg.quaternion.copy(makeBasisQuat(rp.sCenter));
    rg.castShadow = true;
    root.add(rg);

    for (const edgeS of [rp.gapStart, rp.gapEnd]) {
      evalCircuitPose(edgeS, rp.side * rp.offset, _p);
      const lip = new THREE.Mesh(geoRampLip, matHazardStripe);
      lip.position.copy(_p); lip.position.y -= 0.16;
      lip.quaternion.copy(makeBasisQuat(edgeS));
      root.add(lip);
    }
  }

  const boosterWheels = [];
  for (const bp of BOOSTS) {
    const bg = new THREE.Group();
    evalCircuitPose(bp.sCenter, 0, _p);
    bg.position.copy(_p); bg.position.y += 0.05;
    bg.quaternion.copy(makeBasisQuat(bp.sCenter));
    const pad = new THREE.Mesh(geoBoostPad, matBoostBlue);
    bg.add(pad);
    for (let k = -1; k <= 1; k++) {
      const ch = new THREE.Mesh(geoGreenChev, matGreenBoost);
      ch.position.set(0, 0.1, k * 1.45);
      bg.add(ch);
    }
    for (const side of [-1, 1]) {
      const house = new THREE.Mesh(geoBoosterHousing, matRailBlue);
      house.position.set(side * (BOOST_W * 0.5 + 0.72), 0.62, 0);
      bg.add(house);
      for (const wz of [-1.2, 1.2]) {
        const w = new THREE.Mesh(geoBoosterWheel, matBoosterWheel);
        w.position.set(side * (BOOST_W * 0.5 + 0.5), 0.92, wz);
        bg.add(w);
        boosterWheels.push(w);
      }
    }
    root.add(bg);
  }

  /* ---------- 6) Gerbang Start/Finish & Milestone 500m / 1000m ---------- */
  const geoArchPillar = new RoundedBoxGeometry(1.5, 14.5, 1.5, 3, 0.18);
  const geoArchBeam = new RoundedBoxGeometry(W_START + 4.0, 1.9, 1.6, 3, 0.24);
  const geoArchBanner = new THREE.PlaneGeometry(W_START + 1.6, 2.6);
  const geoFlameJet = new THREE.ConeGeometry(0.62, 2.1, 8);
  const geoCheckStripe = new THREE.PlaneGeometry(W_START - 0.8, 3.2); geoCheckStripe.rotateX(-Math.PI / 2);
  disposablesGeo.push(geoArchPillar, geoArchBeam, geoArchBanner, geoFlameJet, geoCheckStripe);

  const torchFlames = [];
  function placeArch(sPos, bannerTex, spanW, withCheckered = false) {
    const matBanner = new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: 0.25, roughness: 0.4 });
    disposablesMat.push(matBanner);
    const g = new THREE.Group();
    evalCircuitPose(sPos, 0, _p);
    g.position.copy(_p);
    g.quaternion.copy(makeBasisQuat(sPos));
    const pL = new THREE.Mesh(geoArchPillar, matArchBlue); pL.position.set(-spanW * 0.5, 7.2, 0);
    const pR = new THREE.Mesh(geoArchPillar, matArchRed); pR.position.set(spanW * 0.5, 7.2, 0);
    const beam = new THREE.Mesh(geoArchBeam, matArchOrange); beam.position.set(0, 13.8, 0);
    const bF = new THREE.Mesh(geoArchBanner, matBanner); bF.position.set(0, 13.8, 0.85);
    const bB = new THREE.Mesh(geoArchBanner, matBanner); bB.position.set(0, 13.8, -0.85); bB.rotation.y = Math.PI;
    const fL = new THREE.Mesh(geoFlameJet, matFlameTorch); fL.position.set(-spanW * 0.5, 15.6, 0);
    const fR = new THREE.Mesh(geoFlameJet, matFlameTorch); fR.position.set(spanW * 0.5, 15.6, 0);
    g.add(pL, pR, beam, bF, bB, fL, fR);
    torchFlames.push(fL, fR);
    if (withCheckered) {
      const ch = new THREE.Mesh(geoCheckStripe, matCheckered);
      ch.position.set(0, 0.05, 0);
      g.add(ch);
    }
    root.add(g);
  }
  placeArch(1.5, texStartBanner, W_START + 2.8, true);
  placeArch(500, texSector500, W + 2.8, false);
  placeArch(1000, texSector1000, W_BANK + 2.8, false);

  /* ---------- 7) Terowongan Garuda Emas Mekanik + 3 Bola Energi Merah + Rambu `!` ---------- */
  const geoSkullCrown = new THREE.ConeGeometry(3.8, 5.2, 5);
  const geoSkullJaw = new RoundedBoxGeometry(W_BANK + 3.2, 3.4, 4.4, 2, 0.4);
  const geoSkullBeak = new THREE.ConeGeometry(2.2, 5.4, 4);
  const geoSkullHorn = new THREE.ConeGeometry(0.95, 5.2, 6);
  const geoSkullEye = new THREE.SphereGeometry(0.95, 10, 8);
  const geoSkullGear = new THREE.CylinderGeometry(1.85, 1.85, 0.6, 10); geoSkullGear.rotateZ(Math.PI / 2);
  const geoRibArch = new THREE.TorusGeometry(W_BANK * 0.5 + 1.6, 0.72, 8, 24, Math.PI);
  const geoOrb = new THREE.SphereGeometry(1.02, 16, 12);
  const geoOrbRing = new THREE.TorusGeometry(1.32, 0.11, 8, 24);
  const geoWarnPost = new THREE.CylinderGeometry(0.08, 0.11, 2.2, 8);
  const geoWarnBoard = new THREE.PlaneGeometry(2.15, 2.15);
  disposablesGeo.push(geoSkullCrown, geoSkullJaw, geoSkullBeak, geoSkullHorn, geoSkullEye, geoSkullGear, geoRibArch, geoOrb, geoOrbRing, geoWarnPost, geoWarnBoard);

  const garudaGroup = new THREE.Group();
  evalCircuitPose(GARUDA_S, 0, _p);
  garudaGroup.position.copy(_p);
  garudaGroup.quaternion.copy(makeBasisQuat(GARUDA_S));
  {
    const pillarL = new THREE.Mesh(geoSkullJaw, matGarudaGold);
    pillarL.scale.set(0.24, 2.4, 1.0);
    pillarL.position.set(-(W_BANK * 0.5 + 1.8), 4.0, 0);
    const pillarR = pillarL.clone(); pillarR.position.x = (W_BANK * 0.5 + 1.8);
    const brow = new THREE.Mesh(geoSkullJaw, matGarudaGold); brow.position.set(0, 8.2, 0);
    const crest = new THREE.Mesh(geoSkullCrown, matGarudaGold); crest.position.set(0, 11.4, -0.2);
    const beak = new THREE.Mesh(geoSkullBeak, matGarudaBronze); beak.rotation.x = Math.PI * 0.85; beak.position.set(0, 6.2, 2.2);
    garudaGroup.add(pillarL, pillarR, brow, crest, beak);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(geoSkullHorn, matGarudaGold);
      horn.position.set(s * 6.4, 10.6, -0.5); horn.rotation.z = -s * 0.52; horn.rotation.x = -0.2;
      const eye = new THREE.Mesh(geoSkullEye, matGarudaEye); eye.position.set(s * 4.2, 7.8, 2.1);
      const gear = new THREE.Mesh(geoSkullGear, matGarudaBronze); gear.position.set(s * (W_BANK * 0.5 + 2.4), 5.6, 0);
      garudaGroup.add(horn, eye, gear);
    }
    for (let r = 0; r < 4; r++) {
      const rib = new THREE.Mesh(geoRibArch, r % 2 === 0 ? matGarudaGold : matGarudaBronze);
      rib.position.set(0, 0.2, -5.0 - r * 7.2);
      garudaGroup.add(rib);
    }
  }
  root.add(garudaGroup);

  // Rambu peringatan `!` merah menjelang Terowongan Garuda
  const warnGroup = new THREE.Group();
  evalCircuitPose(GARUDA_WARN_S, -(W_BANK * 0.5 + 1.15), _p);
  const warnBaseY = _p.y;
  warnGroup.position.copy(_p);
  warnGroup.quaternion.copy(makeBasisQuat(GARUDA_WARN_S));
  const wPost = new THREE.Mesh(geoWarnPost, matDeckSide); wPost.position.y = 1.1;
  const wBoard = new THREE.Mesh(geoWarnBoard, matWarnSign); wBoard.position.y = 2.65;
  warnGroup.add(wPost, wBoard);
  root.add(warnGroup);

  // 3 Bola Energi Merah berguling bolak-balik di S-Curve Terowongan Garuda
  const orbs = [];
  for (let k = 0; k < 3; k++) {
    const orbS = GARUDA_S + 8 + k * 10;
    const og = new THREE.Group();
    const sphere = new THREE.Mesh(geoOrb, matEnergyOrb);
    const ring = new THREE.Mesh(geoOrbRing, matEnergyRing);
    ring.rotation.x = Math.PI * 0.35;
    og.add(sphere, ring);
    root.add(og);
    orbs.push({
      group: og, sphere, ring, s: orbS,
      phase: k * 2.1, spd: 2.3 + k * 0.45,
      wx: 0, wy: 0, wz: 0, latX: 0,
    });
  }

  /* ---------- 8) InstancedMesh: Pilar Truss di Bawah Deck (±0.85 * halfW), Guardrail, Rambu Chevron, Bukit Pesisir, Pulau & Palem ---------- */
  const geoInstTruss = new THREE.CylinderGeometry(0.66, 0.90, 1.0, 8);
  const geoInstPost = new RoundedBoxGeometry(0.32, 0.95, 3.6, 2, 0.06);
  const geoInstConn = new RoundedBoxGeometry(W + 1.5, 0.38, 1.2, 2, 0.08);
  const geoInstChevron = new THREE.BoxGeometry(1.4, 1.4, 0.24);
  const geoInstIsland = new THREE.CylinderGeometry(7.0, 10.5, 2.8, 12);
  const geoInstIslandTop = new THREE.CylinderGeometry(6.6, 7.2, 0.75, 12);
  const geoInstHill = new THREE.ConeGeometry(16, 18, 11);
  const geoInstPalmTrunk = new THREE.CylinderGeometry(0.28, 0.48, 5.2, 7);
  const geoInstPalmCrown = new THREE.ConeGeometry(2.6, 2.4, 7);
  disposablesGeo.push(geoInstTruss, geoInstPost, geoInstConn, geoInstChevron, geoInstIsland, geoInstIslandTop, geoInstHill, geoInstPalmTrunk, geoInstPalmCrown);

  // Pilar truss biru murni DI BAWAH bagian terbawah dek (pillarTopY = trackBottomY - 0.1) di sisi luar (±halfW * 0.85)
  const trussList = [];
  for (let s = 12; s < TOTAL_LEN - 10; s += 26) {
    if (s >= LOOP_S0 - 6 && s <= LOOP_S1 + 6) continue;
    const meta = sampleCenterline(s, _p, _f, _r);

    if (s >= SPLIT_S0 - 4 && s <= SPLIT_S1 + 4) {
      // Di sektor jembatan bertingkat: dukung sisi luar jalur bawah & sisi paling kiri jalur atas agar tidak menembus dek mana pun
      const loOff = SPLIT_LO_CX + SPLIT_LO_HW * 0.85;
      const loTrackBottomY = _p.y + loOff * meta.bank - DECK_THICK;
      const loTopY = loTrackBottomY - 0.1;
      const loH = Math.max(1.0, loTopY - MANDALIKA_OCEAN_Y);
      trussList.push({ x: _p.x + _r.x * loOff, y: MANDALIKA_OCEAN_Y + loH * 0.5, z: _p.z + _r.z * loOff, h: loH });

      const upOff = SPLIT_UP_CX - SPLIT_UP_HW * 0.85;
      const upTrackBottomY = _p.y + getSplitBridgeOffset(s) + upOff * meta.bank - DECK_THICK;
      const upTopY = upTrackBottomY - 0.1;
      const upH = Math.max(1.0, upTopY - MANDALIKA_OCEAN_Y);
      trussList.push({ x: _p.x + _r.x * upOff, y: MANDALIKA_OCEAN_Y + upH * 0.5, z: _p.z + _r.z * upOff, h: upH });
      continue;
    }

    for (const side of [-1, 1]) {
      const off = side * (meta.halfW * 0.85);
      const trackBottomY = _p.y + off * meta.bank - DECK_THICK;
      const pillarTopY = trackBottomY - 0.1;
      const h = Math.max(1.0, pillarTopY - MANDALIKA_OCEAN_Y);
      trussList.push({
        x: _p.x + _r.x * off,
        y: MANDALIKA_OCEAN_Y + h * 0.5,
        z: _p.z + _r.z * off,
        h,
      });
    }
  }
  const instTrusses = new THREE.InstancedMesh(geoInstTruss, matTrussSteel, trussList.length);
  for (let i = 0; i < trussList.length; i++) {
    const t = trussList[i];
    _dummy.position.set(t.x, t.y, t.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, t.h, 1);
    _dummy.updateMatrix();
    instTrusses.setMatrixAt(i, _dummy.matrix);
  }
  instTrusses.instanceMatrix.needsUpdate = true;
  root.add(instTrusses);

  // Guardrail posts (orange & blue alternating) + connectors
  const bluePosts = [], orangePosts = [], connectors = [], chevrons = [];
  for (let s = 2; s < TOTAL_LEN; s += 4) {
    if (s >= SPLIT_S0 && s <= SPLIT_S1) continue;
    if (s >= LOOP_S0 && s <= LOOP_S1) continue;
    const inRampGap = RAMPS.some((rp) => s >= rp.gapStart - 1 && s <= rp.gapEnd + 1);
    const meta = sampleCenterline(s, _p, _f, _r, _u);
    const q = makeBasisQuat(s);
    for (const side of [-1, 1]) {
      if (inRampGap && side === (s < 750 ? RAMPS[0].side : RAMPS[1].side)) continue;
      const lx = side * (meta.halfW + 0.25);
      const px = _p.x + _r.x * lx;
      const py = _p.y + lx * meta.bank + 0.45;
      const pz = _p.z + _r.z * lx;
      const item = { px, py, pz, q: q.clone() };
      if (((Math.floor(s / 4)) + (side > 0 ? 1 : 0)) % 2 === 0) bluePosts.push(item);
      else orangePosts.push(item);
    }
    if (s % 24 === 0) {
      connectors.push({ px: _p.x, py: _p.y - DECK_THICK + 0.06, pz: _p.z, q: q.clone(), sx: (meta.halfW * 2 + 1.5) / (W + 1.5) });
    }
    // Chevron signs on outer bends (T1-T3, T7-T17)
    if (Math.abs(meta.bank) > 0.04 && s % 8 === 0) {
      const outerSide = meta.bank > 0 ? 1 : -1;
      const lx = outerSide * (meta.halfW + 1.05);
      chevrons.push({
        px: _p.x + _r.x * lx,
        py: _p.y + lx * meta.bank + 1.35,
        pz: _p.z + _r.z * lx,
        q: makeBasisQuat(s, outerSide < 0 ? 0.4 : -0.4).clone(),
      });
    }
  }

  function makeInst(geo, mat, items) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      _dummy.position.set(it.px, it.py, it.pz);
      _dummy.quaternion.copy(it.q);
      _dummy.scale.set(it.sx ?? 1, 1, 1);
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
    return im;
  }
  const instBluePosts = makeInst(geoInstPost, matPostBlue, bluePosts);
  const instOrangePosts = makeInst(geoInstPost, matPostOrange, orangePosts);
  const instConnectors = makeInst(geoInstConn, matConnectorBlue, connectors);
  const instChevrons = makeInst(geoInstChevron, matChevronSign, chevrons);

  // Pulau Tropis, Bukit Pesisir Mandalika & Pohon Palem
  const islands = [], hills = [], palms = [];
  for (let s = 35; s < TOTAL_LEN; s += 44) {
    const meta = sampleCenterline(s, _p, _f, _r);
    for (const side of [-1, 1]) {
      if (hash(s * 1.7 + side * 9) < 0.32) continue;
      const distOut = meta.halfW + 26 + hash(s * 2.3 + side) * 28;
      const ix = _p.x + _r.x * side * distOut;
      const iz = _p.z + _r.z * side * distOut;
      // Hindari tumpang tindih dengan bagian trek lain
      let tooClose = false;
      for (let k = 0; k < LUT_N; k += 8) {
        const dx = LUT[k].px - ix;
        const dz = LUT[k].pz - iz;
        if (dx * dx + dz * dz < 23 * 23) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const sc = 0.9 + hash(s * 3.1 + side) * 0.95;
      islands.push({ ix, iz, sc, ry: hash(s + side) * Math.PI });
      if (hash(s * 5.7 + side) > 0.58) {
        hills.push({ ix, iz, sc: sc * 1.15 });
      }
      const pCount = 2 + (Math.floor(s) % 2);
      for (let p = 0; p < pCount; p++) {
        const px = ix + (hash(s * 4.1 + p * 7 + side) - 0.5) * 6.5 * sc;
        const pz = iz + (hash(s * 6.3 + p * 11 + side) - 0.5) * 6.5 * sc;
        const py = MANDALIKA_OCEAN_Y + 2.5 * sc;
        const pSc = 0.8 + hash(s * 7.1 + p) * 0.5;
        palms.push({ px, py, pz, pSc, rx: 0.08 * (p - 1), rz: 0.1 * side, ry: hash(p * 17 + s) * 3 });
      }
    }
  }
  const instIslBase = new THREE.InstancedMesh(geoInstIsland, matIslandSand, Math.max(1, islands.length));
  const instIslTop = new THREE.InstancedMesh(geoInstIslandTop, matIslandLush, Math.max(1, islands.length));
  for (let i = 0; i < islands.length; i++) {
    const it = islands[i];
    _dummy.position.set(it.ix, MANDALIKA_OCEAN_Y + 0.9, it.iz);
    _dummy.rotation.set(0, it.ry, 0); _dummy.scale.set(it.sc, it.sc, it.sc);
    _dummy.updateMatrix();
    instIslBase.setMatrixAt(i, _dummy.matrix);
    _dummy.position.set(it.ix, MANDALIKA_OCEAN_Y + 2.2 * it.sc, it.iz);
    _dummy.updateMatrix();
    instIslTop.setMatrixAt(i, _dummy.matrix);
  }
  instIslBase.instanceMatrix.needsUpdate = true;
  instIslTop.instanceMatrix.needsUpdate = true;
  root.add(instIslBase, instIslTop);

  const instHills = new THREE.InstancedMesh(geoInstHill, matCoastHill, Math.max(1, hills.length));
  for (let i = 0; i < hills.length; i++) {
    const h = hills[i];
    _dummy.position.set(h.ix, MANDALIKA_OCEAN_Y + 8.0 * h.sc, h.iz);
    _dummy.rotation.set(0, i * 0.9, 0);
    _dummy.scale.set(h.sc, h.sc * 0.85, h.sc);
    _dummy.updateMatrix();
    instHills.setMatrixAt(i, _dummy.matrix);
  }
  instHills.instanceMatrix.needsUpdate = true;
  if (hills.length > 0) root.add(instHills);

  const instPalmTrunks = new THREE.InstancedMesh(geoInstPalmTrunk, matPalmTrunk, Math.max(1, palms.length));
  const instPalmCrowns = new THREE.InstancedMesh(geoInstPalmCrown, matPalmCrown, Math.max(1, palms.length));
  for (let i = 0; i < palms.length; i++) {
    const p = palms[i];
    _dummy.position.set(p.px, p.py + 2.4 * p.pSc, p.pz);
    _dummy.rotation.set(p.rx, p.ry, p.rz);
    _dummy.scale.set(p.pSc, p.pSc, p.pSc);
    _dummy.updateMatrix();
    instPalmTrunks.setMatrixAt(i, _dummy.matrix);
    _dummy.position.set(p.px, p.py + 5.1 * p.pSc, p.pz);
    _dummy.rotation.set(0, p.ry, 0);
    _dummy.updateMatrix();
    instPalmCrowns.setMatrixAt(i, _dummy.matrix);
  }
  instPalmTrunks.instanceMatrix.needsUpdate = true;
  instPalmCrowns.instanceMatrix.needsUpdate = true;
  if (palms.length > 0) root.add(instPalmTrunks, instPalmCrowns);

  /* ---------- 9) Tong Mainan yang Bisa Ditabrak ---------- */
  const geoBarrelBody = new THREE.CylinderGeometry(0.54, 0.54, 1.25, 12);
  const geoBarrelBand = new THREE.CylinderGeometry(0.56, 0.56, 0.32, 12);
  disposablesGeo.push(geoBarrelBody, geoBarrelBand);
  const smashProps = [];
  for (const bs of [190, 560, 880, 1140, 1380]) {
    const laneSide = (bs % 2 === 0 ? 1 : -1) * 4.4;
    for (let k = 0; k < 3; k++) {
      const s = bs + k * 3.0;
      const lx = laneSide + (k - 1) * 0.85;
      evalCircuitPose(s, lx, _p);
      const bg = new THREE.Group();
      const body = new THREE.Mesh(geoBarrelBody, k % 2 === 0 ? matPropBarrelRed : matPropBarrelYellow);
      body.position.y = 0.62;
      const band = new THREE.Mesh(geoBarrelBand, matRailBlue);
      band.position.y = 0.62;
      bg.add(body, band);
      bg.position.copy(_p);
      root.add(bg);
      smashProps.push({
        mesh: bg, s, lx,
        baseX: _p.x, baseY: _p.y, baseZ: _p.z,
        hit: false, vx: 0, vy: 0, vz: 0, rvx: 0, rvz: 0,
      });
    }
  }

  /* ---------- 10) Koleksi: Koin Emas, Permata, Buah 3D (Stroberi, Melon, Pisang, Jeruk) & Cincin Api ---------- */
  const geoCoinBody = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 18); geoCoinBody.rotateX(Math.PI / 2);
  const geoCoinRim = new THREE.TorusGeometry(0.55, 0.09, 10, 22);
  const geoGemStar = new THREE.OctahedronGeometry(0.68, 0);
  const geoGemRing = new THREE.TorusGeometry(0.92, 0.055, 8, 22);
  const geoGlowRing = new THREE.PlaneGeometry(2.35, 2.35);
  const geoFireRingTorus = new THREE.TorusGeometry(1.82, 0.19, 10, 24);
  const geoFireFlame = new THREE.ConeGeometry(0.22, 0.68, 5);
  disposablesGeo.push(geoCoinBody, geoCoinRim, geoGemStar, geoGemRing, geoGlowRing, geoFireRingTorus, geoFireFlame);

  const collectibles = [];
  function addCollectible({ kind, fruitType = 'orange', s, latX, wx, wy, wz, groundY = null, quat = null }) {
    const obj = new THREE.Group();
    let coinMesh = null, gemMesh = null, fruitMesh = null, fireRingMesh = null, groundRing = null;
    if (kind === 'coin') {
      coinMesh = new THREE.Group();
      coinMesh.add(new THREE.Mesh(geoCoinBody, matCoinGold), new THREE.Mesh(geoCoinRim, matCoinRim));
      obj.add(coinMesh);
    } else if (kind === 'gem') {
      gemMesh = new THREE.Group();
      const gemMat = new THREE.MeshPhysicalMaterial({ color: '#ff2a4b', emissive: '#ffbe0b', emissiveIntensity: 0.45, roughness: 0.14, metalness: 0.25, clearcoat: 1.0 });
      disposablesMat.push(gemMat);
      const star = new THREE.Mesh(geoGemStar, gemMat);
      const halo = new THREE.Mesh(geoGemRing, matGemHalo); halo.rotation.x = Math.PI / 2;
      gemMesh.add(star, halo);
      gemMesh.userData.gemMat = gemMat;
      obj.add(gemMesh);
    } else if (kind === 'ring') {
      fireRingMesh = new THREE.Group();
      fireRingMesh.add(new THREE.Mesh(geoFireRingTorus, matFireRing));
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2;
        const fl = new THREE.Mesh(geoFireFlame, matFireFlame);
        fl.position.set(Math.cos(a) * 1.98, Math.sin(a) * 1.98, 0);
        fl.rotation.z = a - Math.PI * 0.5;
        fireRingMesh.add(fl);
      }
      obj.add(fireRingMesh);
    } else {
      fruitMesh = buildToyFruit(fruitType);
      fruitMesh.scale.setScalar(1.12);
      obj.add(fruitMesh);
    }
    obj.position.set(wx, wy, wz);
    if (quat) obj.quaternion.copy(quat);
    root.add(obj);

    if (groundY !== null && (kind === 'fruit' || kind === 'gem')) {
      groundRing = new THREE.Mesh(geoGlowRing, ringMats[kind === 'gem' ? 'gem' : fruitType]);
      groundRing.rotation.x = -Math.PI / 2;
      groundRing.position.set(wx, groundY + 0.08, wz);
      root.add(groundRing);
    }

    collectibles.push({
      obj, coinMesh, gemMesh, fruitMesh, fireRingMesh, groundRing,
      kind, fruitType, s, latX, wx, baseY: wy, wz,
      collected: false, phase: collectibles.length * 0.65,
    });
  }

  // A) Buah 3D (Stroberi, Melon, Pisang) & 2 Cincin Api Emas di Jembatan Atas (Turns 4-6)
  const upperFruits = ['strawberry', 'melon', 'banana', 'strawberry', 'melon', 'banana'];
  for (let k = 0; k < upperFruits.length; k++) {
    const s = 306 + k * 16;
    evalCircuitPose(s, SPLIT_UP_CX, _p);
    const bridgeY = _p.y + getSplitBridgeOffset(s);
    addCollectible({
      kind: 'fruit', fruitType: upperFruits[k], s, latX: SPLIT_UP_CX,
      wx: _p.x, wy: bridgeY + 1.15, wz: _p.z, groundY: bridgeY,
    });
  }
  for (const rs of [330, 382]) {
    evalCircuitPose(rs, SPLIT_UP_CX, _p);
    const bridgeY = _p.y + getSplitBridgeOffset(rs);
    addCollectible({
      kind: 'ring', s: rs, latX: SPLIT_UP_CX,
      wx: _p.x, wy: bridgeY + 2.1, wz: _p.z, quat: makeBasisQuat(rs),
    });
  }

  // B) Cincin Api Emas di atas 2 Jump Ramp
  for (const rp of RAMPS) {
    const sRing = rp.sCenter + 7.0;
    const lx = rp.side * rp.offset;
    evalCircuitPose(sRing, lx, _p);
    addCollectible({
      kind: 'ring', s: sRing, latX: lx,
      wx: _p.x, wy: _p.y + 3.6, wz: _p.z, quat: makeBasisQuat(sRing),
    });
  }

  // C) Koin & Permata di dalam Loop 360° Vertikal
  for (let k = 0; k < 5; k++) {
    const u = 0.18 + k * 0.16;
    evalLoopPoseAtS(LOOP_S0, LOOP_S1, u, 0, _p);
    addCollectible({
      kind: k === 2 ? 'gem' : 'coin',
      s: THREE.MathUtils.lerp(LOOP_S0, LOOP_S1, u),
      latX: LOOP_CENTER_X,
      wx: _p.x, wy: _p.y + 0.9, wz: _p.z,
    });
  }

  // D) Koin, Buah Segar 3D & Permata sepanjang 1500m
  for (let s = 48; s < TOTAL_LEN - 20; s += 26) {
    if (s >= SPLIT_S0 && s <= SPLIT_S1) {
      // Tambah koin di jalur bawah pesisir juga
      evalCircuitPose(s, SPLIT_LO_CX, _p);
      addCollectible({ kind: 'coin', s, latX: SPLIT_LO_CX, wx: _p.x, wy: _p.y + 0.95, wz: _p.z });
      continue;
    }
    if (s >= LOOP_S0 - 6 && s <= LOOP_S1 + 6) continue;
    if (RAMPS.some((rp) => s >= rp.sStart - 4 && s <= rp.sEnd + 4)) continue;

    const idx = Math.floor(s / 26);
    const lane = ((idx % 3) - 1) * 4.4;
    const surf = getCircuitSurfaceAt(s, lane);
    evalCircuitPose(s, lane, _p);
    const isGem = idx % 6 === 2;
    const isFruit = !isGem && idx % 2 === 0;
    const ft = FRUIT_TYPES[idx % FRUIT_TYPES.length];
    addCollectible({
      kind: isGem ? 'gem' : isFruit ? 'fruit' : 'coin',
      fruitType: ft,
      s, latX: lane,
      wx: _p.x, wy: surf.groundY + (isFruit ? 1.15 : 0.95), wz: _p.z,
      groundY: surf.groundY,
    });
  }

  /* ==================== Update & Interaksi Per-Frame (Zero-GC) ==================== */
  let prevT = null;
  function updateTrack(_playerPosOrS, t = 0) {
    const dt = prevT === null ? 0.016 : Math.min(0.05, Math.max(0, t - prevT));
    prevT = t;

    for (let i = 0; i < boosterWheels.length; i++) {
      boosterWheels[i].rotation.x = -t * 22;
    }
    for (let i = 0; i < torchFlames.length; i++) {
      torchFlames[i].scale.set(1, 0.88 + 0.32 * Math.sin(t * 14 + i), 1);
    }
    warnGroup.position.y = warnBaseY + Math.sin(t * 5.2) * 0.18;

    for (let i = 0; i < orbs.length; i++) {
      const ob = orbs[i];
      const swing = Math.sin(t * ob.spd + ob.phase) * 5.8;
      ob.latX = swing;
      evalCircuitPose(ob.s, swing, _p);
      ob.wx = _p.x; ob.wy = _p.y + 1.05; ob.wz = _p.z;
      ob.group.position.set(ob.wx, ob.wy, ob.wz);
      ob.ring.rotation.y = t * 4.2 + ob.phase;
      ob.sphere.rotation.z = -Math.cos(t * ob.spd + ob.phase) * 2.5;
    }

    for (let i = 0; i < smashProps.length; i++) {
      const p = smashProps[i];
      if (!p.hit || !p.mesh.visible) continue;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 28 * dt;
      p.mesh.rotation.x += p.rvx * dt;
      p.mesh.rotation.z += p.rvz * dt;
      if (p.mesh.position.y < MANDALIKA_OCEAN_Y - 6) p.mesh.visible = false;
    }

    for (let i = 0; i < collectibles.length; i++) {
      const item = collectibles[i];
      if (item.collected) continue;
      item.obj.position.y = item.baseY + Math.sin(t * 3.6 + item.phase) * 0.16;
      if (item.coinMesh) item.coinMesh.rotation.y = t * 3.4 + item.phase;
      else if (item.gemMesh) {
        item.gemMesh.rotation.y = t * 2.8 + item.phase;
        const gm = item.gemMesh.userData.gemMat;
        const hue = (t * 0.55 + item.phase * 0.15) % 1;
        gm.color.setHSL(hue, 0.92, 0.62);
        gm.emissive.setHSL(hue, 0.95, 0.52);
      } else if (item.fireRingMesh) {
        item.fireRingMesh.rotation.z = t * 3.2 + item.phase;
      } else if (item.fruitMesh) {
        item.fruitMesh.rotation.y = t * 2.4 + item.phase;
      }
    }

    matGreenBoost.emissiveIntensity = 0.72 + Math.sin(t * 5.2) * 0.35;
    matEnergyOrb.emissiveIntensity = 1.3 + Math.sin(t * 9.0) * 0.5;
  }

  const _collected = [];
  function collectNearby(pos) {
    _collected.length = 0;
    const py = pos.y + 0.9;
    for (let i = 0; i < collectibles.length; i++) {
      const item = collectibles[i];
      if (item.collected) continue;
      const hitPad = item.kind === 'ring' ? 3.1 : item.kind === 'fruit' ? 2.5 : 2.3;
      const hitY = item.kind === 'ring' ? 3.2 : 2.6;
      if (
        Math.abs(pos.x - item.wx) < hitPad &&
        Math.abs(pos.z - item.wz) < hitPad &&
        Math.abs(py - item.obj.position.y) < hitY
      ) {
        item.collected = true;
        item.obj.visible = false;
        if (item.groundRing) item.groundRing.visible = false;
        _collected.push({ kind: item.kind, fruitType: item.fruitType, x: item.wx, y: item.obj.position.y, z: item.wz });
      }
    }
    return _collected;
  }

  const _smashed = [];
  function checkPropSmash(pos, half = { x: 1.15, z: 1.75 }) {
    _smashed.length = 0;
    for (let i = 0; i < smashProps.length; i++) {
      const p = smashProps[i];
      if (p.hit) continue;
      if (
        Math.abs(pos.x - p.baseX) < half.x + 0.6 &&
        Math.abs(pos.z - p.baseZ) < half.z + 0.6 &&
        Math.abs(pos.y - p.baseY) < 1.8
      ) {
        p.hit = true;
        evalCircuitPose(p.s, 0, null, _f, _r);
        const dir = ((pos.x - p.baseX) * _r.x + (pos.z - p.baseZ) * _r.z) <= 0 ? 1 : -1;
        const spd = 16 + Math.random() * 8;
        p.vx = _f.x * spd + _r.x * dir * (5 + Math.random() * 5);
        p.vz = _f.z * spd + _r.z * dir * (5 + Math.random() * 5);
        p.vy = 11 + Math.random() * 5;
        p.rvx = 11; p.rvz = 9;
        _smashed.push({ kind: 'barrel', x: p.baseX, y: p.baseY + 0.5, z: p.baseZ });
      }
    }
    return _smashed;
  }

  function checkHazardCollision(pos, half = { x: 0.95, z: 1.55 }) {
    for (let i = 0; i < orbs.length; i++) {
      const ob = orbs[i];
      if (
        Math.abs(pos.x - ob.wx) < half.x + 0.92 &&
        Math.abs(pos.z - ob.wz) < half.z + 0.92 &&
        Math.abs((pos.y + 0.85) - ob.wy) < 1.85
      ) {
        return { x: ob.wx, y: ob.wy, z: ob.wz };
      }
    }
    return null;
  }

  const _upcomingHazards = [];
  function getUpcomingHazards(playerS, maxDist = 72) {
    _upcomingHazards.length = 0;
    const ws = wrapS(playerS);
    for (let i = 0; i < orbs.length; i++) {
      const ob = orbs[i];
      let ds = ob.s - ws;
      if (ds < 0) ds += TOTAL_LEN;
      if (ds > 0.5 && ds <= maxDist) {
        _upcomingHazards.push({ laneX: ob.latX, dist: ds, s: ob.s });
      }
    }
    _upcomingHazards.sort((a, b) => a.dist - b.dist);
    return _upcomingHazards;
  }

  function getCollectibleTargets(sFrom, sTo, out = []) {
    out.length = 0;
    const span = sTo - sFrom;
    const base = wrapS(sFrom);
    for (let i = 0; i < collectibles.length; i++) {
      const item = collectibles[i];
      if (item.collected) continue;
      let ds = item.s - base;
      if (ds < 0) ds += TOTAL_LEN;
      if (ds >= 0 && ds <= span) {
        out.push({ s: item.s, latX: item.latX, x: item.wx, y: item.obj.position.y, z: item.wz, kind: item.kind });
      }
    }
    return out;
  }

  function resetCollectibles() {
    for (let i = 0; i < collectibles.length; i++) {
      const item = collectibles[i];
      item.collected = false;
      item.obj.visible = true;
      if (item.groundRing) item.groundRing.visible = true;
    }
    for (let i = 0; i < smashProps.length; i++) {
      const p = smashProps[i];
      p.hit = false; p.vx = p.vy = p.vz = 0;
      p.mesh.rotation.set(0, 0, 0);
      p.mesh.position.set(p.baseX, p.baseY, p.baseZ);
      p.mesh.visible = true;
    }
  }

  function dispose() {
    scene.remove(root);
    [
      instTrusses, instBluePosts, instOrangePosts, instConnectors, instChevrons,
      instIslBase, instIslTop, instHills, instPalmTrunks, instPalmCrowns,
    ].forEach((im) => im.dispose());
    disposablesGeo.forEach((g) => g.dispose());
    disposablesMat.forEach((m) => m.dispose());
    disposablesTex.forEach((t) => t.dispose());
    collectibles.length = 0;
    smashProps.length = 0;
    orbs.length = 0;
  }

  return {
    isSplineCircuit: true,
    TOTAL_LEN,
    LOOP_ARC_LEN,
    LOOP_HALF_W,
    LOOP_CENTER_X,
    BYPASS_CENTER_X,
    updateTrack,
    collectNearby,
    checkPropSmash,
    checkHazardCollision,
    getUpcomingHazards,
    getCollectibleTargets,
    resetCollectibles,
    dispose,
    evalCircuitPose,
    getTrackSurfaceAt: getCircuitSurfaceAt,
    evalLoopPoseAtS,
    getLoopZoneAtS,
    checkRampCollision: checkCircuitRampCollision,
    checkBoostCollision: checkCircuitBoostCollision,
    getCircuitPreviewPoints,
    getTrackHeight: () => START_Y,
    getTrackSlope: () => 0,
    getTrackCenterX: () => 0,
    getTrackYaw: () => 0,
    getTrackBank: () => 0,
    getRampSide: () => 1,
    getSegmentType: (i) => LUT[((i * 12) % LUT_N + LUT_N) % LUT_N].zone,
    get segmentCount() { return LUT_N; },
  };
}
