/* =====================================================================
   activeTrack.js — Router trek aktif (Salatiga Klasik vs Nusantara Skyway).
   Mengalihkan seluruh fungsi geometri/fisika murni tanpa mengubah satu
   baris pun di trackGenerator.js. Juga menyediakan titik pratinjau minimap.
   ===================================================================== */
import * as salatigaMod from './trackGenerator.js';
import * as skywayMod from './fantasyTrack.js';

let currentArenaId = 'salatiga';
let currentMod = salatigaMod;

export const LOOP_ARC_LEN = salatigaMod.LOOP_ARC_LEN;
export const LOOP_HALF_W = salatigaMod.LOOP_HALF_W;
export const LOOP_CENTER_X = salatigaMod.LOOP_CENTER_X;
export const BYPASS_CENTER_X = salatigaMod.BYPASS_CENTER_X;

export function setActiveArena(arenaId) {
  currentArenaId = arenaId === 'skyway' ? 'skyway' : 'salatiga';
  currentMod = currentArenaId === 'skyway' ? skywayMod : salatigaMod;
  return currentArenaId;
}

export function getActiveArenaId() {
  return currentArenaId;
}

export function getTrackHeight(z) { return currentMod.getTrackHeight(z); }
export function getTrackSlope(z) { return currentMod.getTrackSlope(z); }
export function getTrackCenterX(z) { return currentMod.getTrackCenterX(z); }
export function getTrackYaw(z) { return currentMod.getTrackYaw(z); }
export function getTrackBank(z) { return currentMod.getTrackBank(z); }
export function getRampSide(i) { return currentMod.getRampSide(i); }
export function getSegmentType(i) { return currentMod.getSegmentType(i); }
export function getTrackSurfaceAt(x, z) { return currentMod.getTrackSurfaceAt(x, z); }
export function getForkProfile(t) { return currentMod.getForkProfile(t); }
export function evalLoopPose(zStart, zEnd, y0, y1, u, lateralX, outPos, outQuat, outRight = null) {
  return currentMod.evalLoopPose(zStart, zEnd, y0, y1, u, lateralX, outPos, outQuat, outRight);
}
export function checkRampCollision(x, z) { return currentMod.checkRampCollision(x, z); }
export function checkBoostCollision(x, z) { return currentMod.checkBoostCollision(x, z); }

/** Isi buffer titik kurva (x, y, z) untuk minimap bundar zero-GC */
export function getTrackPreviewPoints(zFrom, zTo, steps = 28, out = []) {
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
