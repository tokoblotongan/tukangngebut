/* =====================================================================
   playerController.js — Gerak menyamping, suspensi membal, lompatan
   ramp, dan Barrel Roll liar di udara (kamera TIDAK ikut roll).
   Kontrak terkunci:
     updatePlayer(dt, input, trackData) -> { pos, speed, airborne, stuntBonus }
   input     = { left, right }
   trackData = { getTrackHeight, getTrackSlope, checkRampCollision, checkBoostCollision }
   ===================================================================== */
import * as THREE from 'three';
import { PHYSICS, SCORE, getVehicleDef } from '../config/gameConfig.js';
import {
  getTrackHeight as defHeight, getTrackSlope as defSlope,
  checkRampCollision as defRamp, checkBoostCollision as defBoost,
} from '../world/trackGenerator.js';

const TWO_PI = Math.PI * 2;

export function createPlayerController({ scene, vehicle, type = 'angkot', callbacks = {} }) {
  let def = getVehicleDef(type);
  let group = vehicle;
  if (group && !group.parent) scene.add(group);

  const pos = new THREE.Vector3(0, defHeight(0), 0);
  let speed = PHYSICS.baseSpeed;
  let vy = 0;
  let airborne = false;
  let latVel = 0;
  let rollAngle = 0;
  let rolling = false;
  let turboTimer = 0;
  let suspOffset = 0, suspVel = 0;
  let pitch = 0;
  let totalStunt = 0;
  let crashCooldown = 0;

  function topSpeed() { return PHYSICS.maxSpeed * def.perf.speedMul; }

  function reset() {
    pos.set(0, defHeight(0), 0);
    speed = PHYSICS.baseSpeed;
    vy = 0; airborne = false; latVel = 0;
    rollAngle = 0; rolling = false; turboTimer = 0;
    suspOffset = 0; suspVel = 0; pitch = 0; crashCooldown = 0;
    if (group) {
      group.position.copy(pos);
      group.rotation.set(0, 0, 0);
    }
  }

  function hitObstacle() {
    if (crashCooldown > 0) return false;
    speed *= 0.45;
    turboTimer = 0;
    suspVel = -6;
    crashCooldown = 0.8;
    callbacks.onCrash?.();
    return true;
  }

  function updatePlayer(dt, input = {}, trackData = {}) {
    const H = trackData.getTrackHeight || defHeight;
    const S = trackData.getTrackSlope || defSlope;
    const R = trackData.checkRampCollision || defRamp;
    const B = trackData.checkBoostCollision || defBoost;
    const P = PHYSICS;

    crashCooldown = Math.max(0, crashCooldown - dt);
    let stuntBonus = 0;

    /* Akselerasi otomatis + turbo */
    speed = Math.min(topSpeed(), speed + P.accel * def.perf.accelMul * dt);
    if (turboTimer > 0) turboTimer = Math.max(0, turboTimer - dt);
    const turboActive = turboTimer > 0;
    const effSpeed = speed * (turboActive ? P.turbo.multiplier : 1);

    /* Maju -Z */
    pos.z -= effSpeed * dt;

    const groundY = H(pos.z);
    const slope = S(pos.z);
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (!airborne) {
      /* Menyamping halus di darat */
      const targetLat = steer * P.steer.maxLatSpeed * def.perf.steerMul;
      latVel += (targetLat - latVel) * (1 - Math.exp(-P.steer.lerp * dt));
      pos.x = THREE.MathUtils.clamp(pos.x + latVel * dt, -P.steer.maxX, P.steer.maxX);
      pos.y = groundY;

      /* Ramp → lompat */
      const ramp = R(pos.x, pos.z);
      if (ramp && effSpeed > P.ramp.minSpeed) {
        airborne = true;
        vy = ramp.launchVy + effSpeed * 0.12;
        rollAngle = 0; rolling = false;
        callbacks.onLaunch?.();
      }
      /* Boost pad → turbo */
      const boost = B(pos.x, pos.z);
      if (boost && turboTimer < P.turbo.duration * 0.5) {
        turboTimer = P.turbo.duration;
        stuntBonus += SCORE.boostPadBonus;
        callbacks.onBoost?.('pad');
      }
      rollAngle += (0 - rollAngle) * (1 - Math.exp(-12 * dt));
    } else {
      /* Di udara: Kiri/Kanan = Barrel Roll 360° liar */
      if (steer !== 0) {
        if (!rolling) { rolling = true; callbacks.onRollStart?.(); }
        rollAngle += steer * P.barrelRoll.speed * dt;
      }
      latVel *= Math.exp(-3 * dt);
      pos.x = THREE.MathUtils.clamp(pos.x + latVel * dt * 0.3, -P.steer.maxX, P.steer.maxX);

      vy += P.gravity * dt;
      pos.y += vy * dt;

      /* Mendarat */
      if (pos.y <= groundY && vy < 0) {
        pos.y = groundY;
        airborne = false;
        vy = 0;
        const rolls = Math.floor(Math.abs(rollAngle) / TWO_PI);
        if (rolls > 0) {
          const bonus = rolls * P.barrelRoll.bonusPerRoll;
          stuntBonus += bonus;
          totalStunt += bonus;
          if (P.barrelRoll.landingBoost) turboTimer = P.turbo.duration;
          callbacks.onLand?.(rolls, bonus);
        } else {
          callbacks.onLand?.(0, 0);
        }
        rollAngle = 0; rolling = false;
        suspVel = -7 - Math.min(4, Math.abs(vy) * 0.1);
      }
    }

    /* Suspensi membal (pegas visual terpisah dari posisi kontak) */
    const sus = P.suspension;
    suspVel += (-sus.stiffness * suspOffset - sus.damping * suspVel) * dt;
    suspOffset = THREE.MathUtils.clamp(suspOffset + suspVel * dt, -sus.maxCompress, 0.12);

    /* Pitch mengikuti kemiringan trek; di udara melandai */
    const targetPitch = airborne ? pitch * 0.4 : Math.atan(-slope);
    pitch += (targetPitch - pitch) * (1 - Math.exp(-8 * dt));

    /* Terapkan transform visual — roll hanya pada kendaraan, bukan kamera */
    if (group) {
      group.position.set(pos.x, pos.y + suspOffset, pos.z);
      group.rotation.order = 'YXZ';
      group.rotation.x = pitch;
      group.rotation.z = airborne ? rollAngle : rollAngle * 0.2;
      group.rotation.y = airborne ? 0 : -latVel * 0.015;

      const wr = def.wheelRadius || 0.34;
      for (const w of group.userData.wheels || []) w.rotation.x -= (effSpeed / wr) * dt;
    }

    return {
      pos, speed: effSpeed, airborne, stuntBonus,
      turbo: turboActive, rollAngle, totalStunt,
    };
  }

  function setVehicle(newGroup, newType) {
    if (group) scene.remove(group);
    group = newGroup;
    def = getVehicleDef(newType || type);
    type = newType || type;
    if (group && !group.parent) scene.add(group);
    reset();
  }

  function getState() {
    return { pos, speed, airborne, turboTimer, rollAngle, totalStunt, type };
  }

  function dispose() { if (group) scene.remove(group); }

  reset();
  return { updatePlayer, reset, hitObstacle, setVehicle, getState, dispose, get group() { return group; } };
}
