/* =====================================================================
   activeTrack.js — Router trek aktif (Salatiga Klasik, Nusantara Skyway,
   dan Mandalika Sky Circuit). Mengalihkan seluruh fungsi geometri/fisika
   murni serta menyediakan titik pratinjau minimap.
   ===================================================================== */
import * as salatigaMod from './trackGenerator.js';
import * as skywayMod from './fantasyTrack.js';
import * as mandalikaMod from './mandalikaFantasyTrack.js';

let currentArenaId = 'salatiga';
let currentMod = salatigaMod;

export const LOOP_ARC_LEN = salatigaMod.LOOP_ARC_LEN;
export const LOOP_HALF_W = salatigaMod.LOOP_HALF_W;
export const LOOP_CENTER_X = salatigaMod.LOOP_CENTER_X;
export const BYPASS_CENTER_X = salatigaMod.BYPASS_CENTER_X;

export function setActiveArena(arenaId) {
  if (arenaId === 'mandalika') {
    currentArenaId = 'mandalika';
    currentMod = mandalikaMod;
  } else if (arenaId === 'skyway') {
    currentArenaId = 'skyway';
    currentMod = skywayMod;
  } else {
    currentArenaId = 'salatiga';
    currentMod = salatigaMod;
  }
  return currentArenaId;
}

export function getActiveArenaId() {
  return currentArenaId;
}

export function isSplineCircuit() {
  return !!currentMod.isSplineCircuit;
}

export function getTrackHeight(z) { return currentMod.getTrackHeight(z); }
export function getTrackSlope(z) { return currentMod.getTrackSlope(z); }
export function getTrackCenterX(z) { return currentMod.getTrackCenterX(z); }
export function getTrackYaw(z) { return currentMod.getTrackYaw(z); }
export function getTrackBank(z) { return currentMod.getTrackBank(z); }
export function getRampSide(i) { return currentMod.getRampSide(i); }
export function getSegmentType(i) { return currentMod.getSegmentType(i); }
export function getTrackSurfaceAt(xOrS, zOrLat) { return currentMod.getTrackSurfaceAt(xOrS, zOrLat); }
export function getForkProfile(t) { return currentMod.getForkProfile ? currentMod.getForkProfile(t) : null; }
export function evalLoopPose(zStart, zEnd, y0, y1, u, lateralX, outPos, outQuat, outRight = null) {
  return currentMod.evalLoopPose(zStart, zEnd, y0, y1, u, lateralX, outPos, outQuat, outRight);
}
export function evalCircuitPose(s, latX, outPos, outFwd, outRight, outUp) {
  return currentMod.evalCircuitPose?.(s, latX, outPos, outFwd, outRight, outUp);
}
export function evalLoopPoseAtS(sStart, sEnd, u, latX, outPos, outQuat, outRight = null, outFwd = null) {
  return currentMod.evalLoopPoseAtS?.(sStart, sEnd, u, latX, outPos, outQuat, outRight, outFwd);
}
export function getLoopZoneAtS(s) { return currentMod.getLoopZoneAtS?.(s) || null; }
export function checkRampCollision(x, z) { return currentMod.checkRampCollision(x, z); }
export function checkBoostCollision(x, z) { return currentMod.checkBoostCollision(x, z); }

/** Isi buffer titik kurva (x, y, z) untuk minimap bundar zero-GC */
export function getTrackPreviewPoints(zFrom, zTo, steps = 28, out = []) {
  if (currentMod.isSplineCircuit && currentMod.getCircuitPreviewPoints) {
    return currentMod.getCircuitPreviewPoints(out);
  }
  out.length = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const z = zFrom + (zTo - zFrom) * t;
    out.push({
      x: currentMod.getTrackCenterX(z),
      y: currentMod.getTrackHeight(z),
      z,
    });
  }
  return out;
}
