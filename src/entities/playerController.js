/* =====================================================================
   playerController.js — Gerak menyamping, suspensi membal, lompatan
   ramp, Barrel Roll liar di udara, manuver loop 360°, tepi terbuka
   trek menyempit/bercabang, jatuh ke jurang & respawn mulus.
   Kontrak terkunci:
     updatePlayer(dt, input, trackData) -> { pos, speed, airborne, stuntBonus, ... }
   ===================================================================== */
import * as THREE from 'three';
import { PHYSICS, SCORE, TRACK, getVehicleDef } from '../config/gameConfig.js';
import {
  getTrackHeight as defHeight, getTrackSlope as defSlope,
  checkRampCollision as defRamp, checkBoostCollision as defBoost,
  getSegmentType, getTrackSurfaceAt, evalLoopPose,
  LOOP_ARC_LEN, LOOP_HALF_W,
} from '../world/trackGenerator.js';

const TWO_PI = Math.PI * 2;

export function createPlayerController({ scene, vehicle, type = 'angkot', callbacks = {}, audio = null }) {
  let def = getVehicleDef(type);
  let group = vehicle;
  if (group && !group.parent) scene.add(group);

  const pos = new THREE.Vector3(0, defHeight(0), 0);
  const rightVec = new THREE.Vector3(1, 0, 0);
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
  let flamePhase = 0;

  /* Status loop 360°, jatuh jurang, & respawn */
  let loopState = null;
  let lastLoopSeg = -1;
  let falling = false;
  let fallTimer = 0;
  let respawning = false;
  let respawnTimer = 0;
  let respawnStartY = 0;
  let respawnTargetY = 0;
  let respawnFromX = 0;
  let respawnTargetX = 0;

  const _loopPos = new THREE.Vector3();
  const _loopQuat = new THREE.Quaternion();
  const _loopRight = new THREE.Vector3();
  const _rollQuat = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);

  function topSpeed() { return PHYSICS.maxSpeed * def.perf.speedMul; }

  function reset() {
    pos.set(0, defHeight(0), 0);
    rightVec.set(1, 0, 0);
    speed = PHYSICS.baseSpeed;
    vy = 0; airborne = false; latVel = 0;
    rollAngle = 0; rolling = false; turboTimer = 0;
    suspOffset = 0; suspVel = 0; pitch = 0; crashCooldown = 0;
    loopState = null; lastLoopSeg = -1;
    falling = false; fallTimer = 0;
    respawning = false; respawnTimer = 0;
    if (group) {
      group.position.copy(pos);
      group.quaternion.identity();
      group.rotation.set(0, 0, 0);
      group.visible = true;
      if (group.userData.flames?.group) group.userData.flames.group.visible = false;
    }
  }

  function triggerAbyssFall(kind) {
    if (falling || respawning) return;
    falling = true;
    fallTimer = 0;
    airborne = false;
    loopState = null;
    turboTimer = 0;
    rolling = false;
    vy = Math.min(-2.5, vy);
    audio?.playAbyssWhistle?.();
    callbacks.onAbyssFall?.(kind);
  }

  function startRespawnDrop() {
    let safeZ = pos.z;
    let safeSurf = getTrackSurfaceAt(0, safeZ);
    for (let step = 0; step < 12; step++) {
      if (safeSurf.onTrack && !safeSurf.inGap) break;
      safeZ -= 2.2;
      safeSurf = getTrackSurfaceAt(0, safeZ);
    }
    if (!safeSurf.onTrack) {
      const s = getTrackSurfaceAt(safeSurf.safeCenterX, safeZ);
      safeSurf = s;
    }
    respawnTargetX = safeSurf.safeCenterX || 0;
    respawnTargetY = safeSurf.groundY;
    respawnFromX = pos.x;
    respawnStartY = respawnTargetY + 8.5;
    pos.z = safeZ;
    pos.y = respawnStartY;
    vy = 0;
    latVel = 0;
    rollAngle = 0;
    pitch = 0;
    falling = false;
    respawning = true;
    respawnTimer = 0;
    rightVec.set(1, 0, 0);
  }

  function hitObstacle() {
    if (crashCooldown > 0 || loopState || falling || respawning) return false;
    speed *= 0.45;
    turboTimer = 0;
    suspVel = -6;
    crashCooldown = 0.8;
    callbacks.onCrash?.();
    return true;
  }

  function triggerBoostSurge(duration = PHYSICS.turbo.duration, speedBoost = 5) {
    turboTimer = Math.max(turboTimer, duration);
    speed = Math.min(topSpeed() * 1.15, speed + speedBoost);
  }

  function bounceProp() {
    suspVel = Math.max(-4.5, suspVel - 2.6);
  }

  function updateFlames(dt, active) {
    const flames = group?.userData?.flames;
    if (!flames?.group) return;
    flames.group.visible = active;
    if (active) {
      flamePhase += dt * 44;
      for (let i = 0; i < flames.jets.length; i++) {
        const jet = flames.jets[i];
        const flicker = 0.85 + 0.45 * Math.abs(Math.sin(flamePhase + i * 1.7));
        const stretch = 1.05 + 0.55 * Math.sin(flamePhase * 1.37 + i * 2.1);
        jet.scale.set(flicker, flicker, Math.max(0.75, stretch));
      }
    }
  }

  function updatePlayer(dt, input = {}, trackData = {}) {
    const H = trackData.getTrackHeight || defHeight;
    const S = trackData.getTrackSlope || defSlope;
    const R = trackData.checkRampCollision || defRamp;
    const B = trackData.checkBoostCollision || defBoost;
    const P = PHYSICS;

    crashCooldown = Math.max(0, crashCooldown - dt);
    let stuntBonus = 0;

    /* 1) Sedang respawn mulus turun dari langit ke tengah trek */
    if (respawning) {
      respawnTimer += dt;
      const t = Math.min(1, respawnTimer / 0.42);
      const ease = 1 - Math.pow(1 - t, 3);
      pos.x = THREE.MathUtils.lerp(respawnFromX, respawnTargetX, ease);
      pos.y = THREE.MathUtils.lerp(respawnStartY, respawnTargetY, ease);
      if (group) {
        group.position.copy(pos);
        group.rotation.set(0, 0, 0);
        updateFlames(dt, false);
      }
      if (t >= 1) {
        respawning = false;
        pos.y = getTrackSurfaceAt(pos.x, pos.z).groundY;
        suspVel = -6.5;
        speed = P.baseSpeed * 0.85;
        callbacks.onAbyssRecover?.();
      }
      return {
        pos, speed, airborne: true, stuntBonus: 0,
        turbo: false, inBoost: false, rollAngle: 0, totalStunt,
        inLoop: false, loopCenterZ: 0, falling: false, respawning: true, rightVec,
      };
    }

    /* 2) Sedang jatuh bebas ke jurang */
    if (falling) {
      fallTimer += dt;
      vy += P.gravity * dt;
      pos.y += vy * dt;
      pos.z -= Math.max(4, speed * 0.45) * dt;
      pos.x += latVel * dt * 0.4;
      if (group) {
        group.position.copy(pos);
        group.rotation.x += 3.1 * dt;
        group.rotation.z += (latVel >= 0 ? -3.8 : 3.8) * dt;
        updateFlames(dt, false);
      }
      const refY = H(pos.z);
      if (fallTimer > 0.72 || pos.y < refY - 9.5) {
        startRespawnDrop();
      }
      return {
        pos, speed, airborne: true, stuntBonus: 0,
        turbo: false, inBoost: false, rollAngle, totalStunt,
        inLoop: false, loopCenterZ: 0, falling: true, respawning: false, rightVec,
      };
    }

    /* Akselerasi otomatis + turbo */
    speed = Math.min(topSpeed(), speed + P.accel * def.perf.accelMul * dt);
    if (turboTimer > 0) turboTimer = Math.max(0, turboTimer - dt);
    const turboActive = turboTimer > 0;
    const effSpeed = speed * (turboActive ? P.turbo.multiplier : 1);
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    /* 3) Sedang menunggangi Loop 360° Vertikal */
    if (loopState) {
      const loopSpeed = Math.max(effSpeed, P.baseSpeed * 1.52);
      loopState.u += (loopSpeed * dt) / LOOP_ARC_LEN;
      const targetLat = steer * P.steer.maxLatSpeed * 0.75 * def.perf.steerMul;
      latVel += (targetLat - latVel) * (1 - Math.exp(-P.steer.lerp * dt));
      loopState.latX = THREE.MathUtils.clamp(
        loopState.latX + latVel * dt,
        -(LOOP_HALF_W - 0.6),
        LOOP_HALF_W - 0.6
      );

      const uEval = Math.min(1, loopState.u);
      evalLoopPose(
        loopState.zStart, loopState.zEnd, loopState.y0, loopState.y1,
        uEval, loopState.latX, _loopPos, _loopQuat, _loopRight
      );
      pos.copy(_loopPos);
      rightVec.copy(_loopRight);

      if (group) {
        group.position.copy(pos);
        group.quaternion.copy(_loopQuat);
        _rollQuat.setFromAxisAngle(_zAxis, -latVel * 0.018);
        group.quaternion.multiply(_rollQuat);
        const wr = def.wheelRadius || 0.34;
        for (const w of group.userData.wheels || []) w.rotation.x -= (loopSpeed / wr) * dt;
        updateFlames(dt, true);
      }

      const loopCenterZ = (loopState.zStart + loopState.zEnd) * 0.5;
      if (loopState.u >= 1) {
        lastLoopSeg = loopState.segIndex;
        pos.set(loopState.latX, H(loopState.zEnd), loopState.zEnd - 0.06);
        rightVec.set(1, 0, 0);
        loopState = null;
        turboTimer = Math.max(turboTimer, 1.5);
        stuntBonus += SCORE.loopBonus;
        totalStunt += SCORE.loopBonus;
        audio?.playLoopWhoosh?.();
        callbacks.onLoopComplete?.();
        return {
          pos, speed: loopSpeed, airborne: false, stuntBonus,
          turbo: true, inBoost: true, rollAngle: 0, totalStunt,
          inLoop: false, loopCenterZ, falling: false, respawning: false, rightVec,
        };
      }

      return {
        pos, speed: loopSpeed, airborne: false, stuntBonus,
        turbo: true, inBoost: true, rollAngle: 0, totalStunt,
        inLoop: true, loopCenterZ, falling: false, respawning: false, rightVec,
      };
    }

    /* 4) Maju normal di -Z */
    pos.z -= effSpeed * dt;
    const segIdx = Math.floor(-pos.z / TRACK.segmentLength);
    if (!airborne && getSegmentType(segIdx) === 'loop' && segIdx !== lastLoopSeg && Math.abs(pos.x) <= LOOP_HALF_W + 0.4) {
      const zStart = -segIdx * TRACK.segmentLength;
      const zEnd = -(segIdx + 1) * TRACK.segmentLength;
      loopState = {
        segIndex: segIdx,
        zStart,
        zEnd,
        y0: H(zStart),
        y1: H(zEnd),
        u: Math.max(0, Math.min(0.18, (zStart - pos.z) / TRACK.segmentLength)),
        latX: THREE.MathUtils.clamp(pos.x, -(LOOP_HALF_W - 0.6), LOOP_HALF_W - 0.6),
      };
      evalLoopPose(
        loopState.zStart, loopState.zEnd, loopState.y0, loopState.y1,
        loopState.u, loopState.latX, _loopPos, _loopQuat, _loopRight
      );
      pos.copy(_loopPos);
      rightVec.copy(_loopRight);
      if (group) {
        group.position.copy(pos);
        group.quaternion.copy(_loopQuat);
        updateFlames(dt, true);
      }
      return {
        pos, speed: effSpeed, airborne: false, stuntBonus: 0,
        turbo: true, inBoost: true, rollAngle: 0, totalStunt,
        inLoop: true, loopCenterZ: (zStart + zEnd) * 0.5, falling: false, respawning: false, rightVec,
      };
    }

    let surf = getTrackSurfaceAt(pos.x, pos.z);
    const maxSteerX = surf.hasGuardrails ? P.steer.maxX : 7.4;

    if (!airborne) {
      const targetLat = steer * P.steer.maxLatSpeed * def.perf.steerMul;
      latVel += (targetLat - latVel) * (1 - Math.exp(-P.steer.lerp * dt));
      pos.x = THREE.MathUtils.clamp(pos.x + latVel * dt, -maxSteerX, maxSteerX);
      surf = getTrackSurfaceAt(pos.x, pos.z);

      if (!surf.onTrack) {
        triggerAbyssFall(surf.type);
        return {
          pos, speed: effSpeed, airborne: true, stuntBonus: 0,
          turbo: false, inBoost: false, rollAngle, totalStunt,
          inLoop: false, loopCenterZ: 0, falling: true, respawning: false, rightVec,
        };
      }

      pos.y = surf.groundY;

      /* Ramp → lompat */
      const ramp = R(pos.x, pos.z);
      if (ramp && effSpeed > P.ramp.minSpeed) {
        airborne = true;
        vy = ramp.launchVy + effSpeed * 0.12;
        rollAngle = 0; rolling = false;
        audio?.playTeloletHorn?.();
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
      pos.x = THREE.MathUtils.clamp(pos.x + latVel * dt * 0.35, -7.4, 7.4);

      vy += P.gravity * dt;
      pos.y += vy * dt;

      surf = getTrackSurfaceAt(pos.x, pos.z);
      if (pos.y <= surf.groundY && vy < 0) {
        if (!surf.onTrack) {
          triggerAbyssFall(surf.type);
          return {
            pos, speed: effSpeed, airborne: true, stuntBonus: 0,
            turbo: false, inBoost: false, rollAngle, totalStunt,
            inLoop: false, loopCenterZ: 0, falling: true, respawning: false, rightVec,
          };
        }
        pos.y = surf.groundY;
        airborne = false;
        vy = 0;
        const rolls = Math.floor(Math.abs(rollAngle) / TWO_PI);
        if (rolls > 0) {
          const bonus = rolls * P.barrelRoll.bonusPerRoll;
          stuntBonus += bonus;
          totalStunt += bonus;
          if (P.barrelRoll.landingBoost) turboTimer = P.turbo.duration;
          audio?.playTeloletFlourish?.();
          callbacks.onLand?.(rolls, bonus);
        } else {
          callbacks.onLand?.(0, 0);
        }
        rollAngle = 0; rolling = false;
        suspVel = -7 - Math.min(4, Math.abs(vy) * 0.1);
      }
    }

    /* Suspensi membal */
    const sus = P.suspension;
    suspVel += (-sus.stiffness * suspOffset - sus.damping * suspVel) * dt;
    suspOffset = THREE.MathUtils.clamp(suspOffset + suspVel * dt, -sus.maxCompress, 0.12);

    /* Pitch mengikuti kemiringan trek; di udara melandai */
    const slope = S(pos.z);
    const targetPitch = airborne ? pitch * 0.4 : Math.atan(-slope);
    pitch += (targetPitch - pitch) * (1 - Math.exp(-8 * dt));

    /* Terapkan transform visual */
    if (group) {
      group.position.set(pos.x, pos.y + suspOffset, pos.z);
      group.rotation.order = 'YXZ';
      group.rotation.x = pitch;
      group.rotation.z = airborne ? rollAngle : rollAngle * 0.2;
      group.rotation.y = airborne ? 0 : -latVel * 0.015;
      rightVec.set(1, 0, 0).applyEuler(group.rotation);

      const wr = def.wheelRadius || 0.34;
      for (const w of group.userData.wheels || []) w.rotation.x -= (effSpeed / wr) * dt;
      updateFlames(dt, turboActive);
    }

    return {
      pos, speed: effSpeed, airborne, stuntBonus,
      turbo: turboActive,
      inBoost: turboActive || (airborne && Math.abs(rollAngle) > 0.25),
      rollAngle, totalStunt,
      inLoop: false, loopCenterZ: 0, falling: false, respawning: false, rightVec,
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
    return {
      pos, speed, airborne, turboTimer, rollAngle, totalStunt, type,
      inLoop: !!loopState, falling, respawning, rightVec,
    };
  }

  function dispose() { if (group) scene.remove(group); }

  reset();
  return {
    updatePlayer, reset, hitObstacle, triggerBoostSurge, bounceProp, setVehicle, getState, dispose,
    get group() { return group; },
  };
}
