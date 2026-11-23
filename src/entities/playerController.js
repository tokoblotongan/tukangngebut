/* =====================================================================
   playerController.js — Gerak menyamping, suspensi membal, lompatan
   ramp, Barrel Roll liar di udara, manuver loop 360°, tepi terbuka
   trek menyempit/bercabang, jatuh ke jurang & respawn mulus.
   Mendukung trek -Z (Salatiga & Skyway) maupun Closed Spline Circuit
   (Mandalika Sky Circuit).
   Kontrak terkunci:
     updatePlayer(dt, input, trackData) -> { pos, speed, airborne, stuntBonus, ... }
   ===================================================================== */
import * as THREE from 'three';
import { PHYSICS, SCORE, TRACK, getVehicleDef } from '../config/gameConfig.js';
import {
  getTrackHeight as defHeight, getTrackSlope as defSlope,
  getTrackCenterX, getTrackYaw, getTrackBank,
  checkRampCollision as defRamp, checkBoostCollision as defBoost,
  getSegmentType, getTrackSurfaceAt, evalLoopPose,
  LOOP_ARC_LEN, LOOP_HALF_W, LOOP_CENTER_X,
} from '../world/activeTrack.js';

const TWO_PI = Math.PI * 2;

export function createPlayerController({ scene, vehicle, type = 'angkot', callbacks = {}, audio = null }) {
  let def = getVehicleDef(type);
  let group = vehicle;
  if (group && !group.parent) scene.add(group);

  const pos = new THREE.Vector3(0, defHeight(0), 0);
  const camAnchor = new THREE.Vector3(0, defHeight(0), 0);
  const rightVec = new THREE.Vector3(1, 0, 0);
  const forwardVec = new THREE.Vector3(0, 0, -1);
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

  /* Koordinat parametrik untuk lintasan spline tertutup (Mandalika) */
  let sCoord = 0;
  let latX = 0;
  let lastLoopLap = -1;

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

  const _spPos = new THREE.Vector3();
  const _spUp = new THREE.Vector3();
  const _spZAxis = new THREE.Vector3();
  const _spMat = new THREE.Matrix4();
  const _spEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _spQ = new THREE.Quaternion();

  /* Pool asap knalpot tipis & transparan (zero-GC, tidak pernah menutupi bodi) */
  const PUFF_MAX = 14;
  const puffGeo = new THREE.SphereGeometry(0.13, 7, 6);
  const puffs = [];
  for (let i = 0; i < PUFF_MAX; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: '#f8fafc',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(puffGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 4;
    scene.add(mesh);
    puffs.push({ mesh, mat, active: false, age: 0, life: 0.28, vx: 0, vy: 0, vz: 0, baseScale: 0.8, startOp: 0.25 });
  }
  let puffTimer = 0;

  function clearPuffs() {
    puffTimer = 0;
    for (let i = 0; i < PUFF_MAX; i++) {
      puffs[i].active = false;
      puffs[i].mesh.visible = false;
    }
  }

  function updatePuffs(dt, spawnActive, turboOn) {
    for (let i = 0; i < PUFF_MAX; i++) {
      const p = puffs[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      const k = p.age / p.life;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(p.baseScale * (0.65 + k * 0.85));
      p.mat.opacity = p.startOp * Math.pow(1 - k, 1.65);
    }

    if (!spawnActive) return;
    puffTimer -= dt;
    if (puffTimer > 0) return;
    puffTimer = turboOn ? 0.055 : 0.085;

    const tailBack = (def.targetSize?.z || 4.0) * 0.48;
    const hLen = Math.hypot(forwardVec.x, forwardVec.z) || 1;
    const fx = forwardVec.x / hLen;
    const fz = forwardVec.z / hLen;

    for (let i = 0; i < PUFF_MAX; i++) {
      const p = puffs[i];
      if (p.active) continue;
      p.active = true;
      p.age = 0;
      p.life = 0.28;
      p.baseScale = turboOn ? 0.96 : 0.76;
      p.startOp = turboOn ? 0.32 : 0.23;
      const driftBack = 2.5 + Math.random() * 1.1;
      const jitterSide = (Math.random() - 0.5) * 0.45;
      p.vx = -fx * driftBack - fz * jitterSide;
      p.vy = 0.25 + Math.random() * 0.20;
      p.vz = -fz * driftBack + fx * jitterSide;
      p.mesh.position.set(
        pos.x - fx * tailBack + (Math.random() - 0.5) * 0.34,
        pos.y + suspOffset + 0.24,
        pos.z - fz * tailBack + (Math.random() - 0.5) * 0.34
      );
      p.mesh.scale.setScalar(p.baseScale * 0.65);
      p.mat.opacity = p.startOp;
      p.mesh.visible = true;
      break;
    }
  }

  function topSpeed() { return PHYSICS.maxSpeed * def.perf.speedMul; }

  function reset() {
    pos.set(0, defHeight(0), 0);
    camAnchor.copy(pos);
    rightVec.set(1, 0, 0);
    forwardVec.set(0, 0, -1);
    sCoord = 0;
    latX = 0;
    lastLoopLap = -1;
    speed = PHYSICS.baseSpeed;
    vy = 0; airborne = false; latVel = 0;
    rollAngle = 0; rolling = false; turboTimer = 0;
    suspOffset = 0; suspVel = 0; pitch = 0; crashCooldown = 0;
    loopState = null; lastLoopSeg = -1;
    falling = false; fallTimer = 0;
    respawning = false; respawnTimer = 0;
    clearPuffs();
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
    clearPuffs();
    vy = Math.min(-2.5, vy);
    audio?.playAbyssWhistle?.();
    callbacks.onAbyssFall?.(kind);
  }

  function startRespawnDrop() {
    let safeZ = pos.z;
    let safeSurf = getTrackSurfaceAt(getTrackCenterX(safeZ), safeZ);
    for (let step = 0; step < 12; step++) {
      if (safeSurf.onTrack && !safeSurf.inGap) break;
      safeZ -= 2.2;
      safeSurf = getTrackSurfaceAt(getTrackCenterX(safeZ), safeZ);
    }
    respawnTargetX = safeSurf.safeCenterX || getTrackCenterX(safeZ);
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
    camAnchor.copy(pos);
    rightVec.set(1, 0, 0);
  }

  function startSplineRespawn(trackData) {
    let safeS = sCoord;
    let safeSurf = trackData.getTrackSurfaceAt(safeS, 0);
    for (let step = 0; step < 12; step++) {
      if (safeSurf.onTrack && !safeSurf.inGap) break;
      safeS += 2.4;
      safeSurf = trackData.getTrackSurfaceAt(safeS, safeSurf.safeCenterX ?? 0);
    }
    sCoord = safeS;
    respawnTargetX = safeSurf.safeCenterX || 0;
    respawnTargetY = safeSurf.groundY;
    respawnFromX = latX;
    respawnStartY = respawnTargetY + 8.5;
    trackData.evalCircuitPose(sCoord, latX, _spPos, forwardVec, rightVec, _spUp);
    pos.set(_spPos.x, respawnStartY, _spPos.z);
    vy = 0;
    latVel = 0;
    rollAngle = 0;
    pitch = 0;
    falling = false;
    respawning = true;
    respawnTimer = 0;
    camAnchor.copy(pos);
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

  /* ==================== Update Khusus Closed-Spline Circuit (Mandalika) ==================== */
  function updateSplinePlayer(dt, input, trackData) {
    const P = PHYSICS;
    const totalLen = trackData.TOTAL_LEN || 1500;
    crashCooldown = Math.max(0, crashCooldown - dt);
    let stuntBonus = 0;

    if (respawning) {
      respawnTimer += dt;
      const t = Math.min(1, respawnTimer / 0.42);
      const ease = 1 - Math.pow(1 - t, 3);
      latX = THREE.MathUtils.lerp(respawnFromX, respawnTargetX, ease);
      const curY = THREE.MathUtils.lerp(respawnStartY, respawnTargetY, ease);
      const meta = trackData.evalCircuitPose(sCoord, latX, _spPos, forwardVec, rightVec, _spUp);
      pos.set(_spPos.x, curY, _spPos.z);
      if (group) {
        group.position.copy(pos);
        _spZAxis.copy(forwardVec).negate();
        _spMat.makeBasis(rightVec, _spUp, _spZAxis);
        group.quaternion.setFromRotationMatrix(_spMat);
        _spEuler.set(0, 0, meta.bank);
        _spQ.setFromEuler(_spEuler);
        group.quaternion.multiply(_spQ);
        updateFlames(dt, false);
      }
      updatePuffs(dt, false, false);
      if (t >= 1) {
        respawning = false;
        pos.y = trackData.getTrackSurfaceAt(sCoord, latX).groundY;
        suspVel = -6.5;
        speed = P.baseSpeed * 0.85;
        callbacks.onAbyssRecover?.();
      }
      const camAlphaX = 1 - Math.exp(-10 * dt);
      const camAlphaY = 1 - Math.exp(-9 * dt);
      camAnchor.x += (pos.x - camAnchor.x) * camAlphaX;
      camAnchor.y += (pos.y - camAnchor.y) * camAlphaY;
      camAnchor.z += (pos.z - camAnchor.z) * camAlphaX;
      return {
        pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed,
        airborne: true, stuntBonus: 0, turbo: false, inBoost: false,
        rollAngle: 0, totalStunt, inLoop: false, loopCenterZ: 0, falling: false, respawning: true,
      };
    }

    if (falling) {
      fallTimer += dt;
      vy += P.gravity * dt;
      pos.y += vy * dt;
      const fwdSpd = Math.max(4, speed * 0.45);
      sCoord += fwdSpd * dt;
      pos.x += (forwardVec.x * fwdSpd + rightVec.x * latVel * 0.4) * dt;
      pos.z += (forwardVec.z * fwdSpd + rightVec.z * latVel * 0.4) * dt;
      if (group) {
        group.position.copy(pos);
        group.rotation.x += 3.1 * dt;
        group.rotation.z += (latVel >= 0 ? -3.8 : 3.8) * dt;
        updateFlames(dt, false);
      }
      updatePuffs(dt, false, false);
      const refSurf = trackData.getTrackSurfaceAt(sCoord, 0);
      if (fallTimer > 0.72 || pos.y < refSurf.groundY - 9.5) {
        startSplineRespawn(trackData);
      }
      const fallK = 1 - Math.exp(-8 * dt);
      camAnchor.lerp(pos, fallK);
      return {
        pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed,
        airborne: true, stuntBonus: 0, turbo: false, inBoost: false,
        rollAngle, totalStunt, inLoop: false, loopCenterZ: 0, falling: true, respawning: false,
      };
    }

    speed = Math.min(topSpeed(), speed + P.accel * def.perf.accelMul * dt);
    if (turboTimer > 0) turboTimer = Math.max(0, turboTimer - dt);
    const turboActive = turboTimer > 0;
    const effSpeed = speed * (turboActive ? P.turbo.multiplier : 1);
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (loopState) {
      const loopArc = trackData.LOOP_ARC_LEN || LOOP_ARC_LEN;
      const loopHW = trackData.LOOP_HALF_W || LOOP_HALF_W;
      const loopCx = trackData.LOOP_CENTER_X ?? LOOP_CENTER_X;
      const loopSpeed = Math.max(effSpeed, P.baseSpeed * 1.52);
      loopState.u += (loopSpeed * dt) / loopArc;
      const targetLat = steer * P.steer.maxLatSpeed * 0.75 * def.perf.steerMul;
      latVel += (targetLat - latVel) * (1 - Math.exp(-P.steer.lerp * dt));
      loopState.latX = THREE.MathUtils.clamp(loopState.latX + latVel * dt, -(loopHW - 0.65), loopHW - 0.65);

      const uEval = Math.min(1, loopState.u);
      trackData.evalLoopPoseAtS(loopState.sStart, loopState.sEnd, uEval, loopState.latX, _loopPos, _loopQuat, _loopRight, forwardVec);
      pos.copy(_loopPos);
      rightVec.copy(_loopRight);
      sCoord = loopState.lapBase + THREE.MathUtils.lerp(loopState.sStart, loopState.sEnd, uEval);
      latX = loopCx + loopState.latX;

      if (group) {
        group.position.copy(pos);
        group.quaternion.copy(_loopQuat);
        _rollQuat.setFromAxisAngle(_zAxis, -latVel * 0.018);
        group.quaternion.multiply(_rollQuat);
        const wr = def.wheelRadius || 0.34;
        for (const w of group.userData.wheels || []) w.rotation.x -= (loopSpeed / wr) * dt;
        updateFlames(dt, true);
      }
      updatePuffs(dt, false, true);

      const lpAlpha = 1 - Math.exp(-10 * dt);
      camAnchor.lerp(pos, lpAlpha);

      if (loopState.u >= 1) {
        lastLoopLap = loopState.lapIdx;
        sCoord = loopState.lapBase + loopState.sEnd + 0.1;
        latX = loopCx + loopState.latX;
        trackData.evalCircuitPose(sCoord, latX, _spPos, forwardVec, rightVec, _spUp);
        pos.copy(_spPos);
        loopState = null;
        turboTimer = Math.max(turboTimer, 1.5);
        stuntBonus += SCORE.loopBonus;
        totalStunt += SCORE.loopBonus;
        audio?.playLoopWhoosh?.();
        callbacks.onLoopComplete?.();
        return {
          pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed: loopSpeed,
          airborne: false, stuntBonus, turbo: true, inBoost: true,
          rollAngle: 0, totalStunt, inLoop: false, loopCenterZ: 0, falling: false, respawning: false,
        };
      }
      return {
        pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed: loopSpeed,
        airborne: false, stuntBonus, turbo: true, inBoost: true,
        rollAngle: 0, totalStunt, inLoop: true, loopCenterZ: 0, falling: false, respawning: false,
      };
    }

    sCoord += effSpeed * dt;
    const lapIdx = Math.floor(sCoord / totalLen);
    const loopZone = trackData.getLoopZoneAtS?.(sCoord);
    if (!airborne && loopZone && lapIdx !== lastLoopLap && Math.abs(latX - loopZone.centerLatX) <= loopZone.halfW + 0.45) {
      const ws = ((sCoord % totalLen) + totalLen) % totalLen;
      loopState = {
        lapIdx,
        lapBase: lapIdx * totalLen,
        sStart: loopZone.sStart,
        sEnd: loopZone.sEnd,
        u: Math.max(0, Math.min(0.18, (ws - loopZone.sStart) / Math.max(1, loopZone.sEnd - loopZone.sStart))),
        latX: THREE.MathUtils.clamp(latX - loopZone.centerLatX, -(loopZone.halfW - 0.65), loopZone.halfW - 0.65),
      };
      trackData.evalLoopPoseAtS(loopState.sStart, loopState.sEnd, loopState.u, loopState.latX, _loopPos, _loopQuat, _loopRight, forwardVec);
      pos.copy(_loopPos);
      rightVec.copy(_loopRight);
      if (group) {
        group.position.copy(pos);
        group.quaternion.copy(_loopQuat);
        updateFlames(dt, true);
      }
      return {
        pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed: effSpeed,
        airborne: false, stuntBonus: 0, turbo: true, inBoost: true,
        rollAngle: 0, totalStunt, inLoop: true, loopCenterZ: 0, falling: false, respawning: false,
      };
    }

    let surf = trackData.getTrackSurfaceAt(sCoord, latX);
    const maxSteerX = Math.max(P.steer.maxX, (surf.safeHalfW || 8) - 1.1);

    if (!airborne) {
      const targetLat = steer * P.steer.maxLatSpeed * def.perf.steerMul;
      latVel += (targetLat - latVel) * (1 - Math.exp(-P.steer.lerp * dt));
      const minClamp = surf.type === 'fork' ? -8.2 : -maxSteerX;
      const maxClamp = surf.type === 'fork' ? 8.8 : maxSteerX;
      latX = THREE.MathUtils.clamp(latX + latVel * dt, minClamp, maxClamp);
      surf = trackData.getTrackSurfaceAt(sCoord, latX);

      if (!surf.onTrack) {
        triggerAbyssFall(surf.type);
        return {
          pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed: effSpeed,
          airborne: true, stuntBonus: 0, turbo: false, inBoost: false,
          rollAngle, totalStunt, inLoop: false, loopCenterZ: 0, falling: true, respawning: false,
        };
      }

      pos.y = surf.groundY;
      const ramp = trackData.checkRampCollision(sCoord, latX);
      if (ramp && effSpeed > P.ramp.minSpeed) {
        airborne = true;
        vy = ramp.launchVy + effSpeed * 0.12;
        rollAngle = 0; rolling = false;
        audio?.playTeloletHorn?.();
        callbacks.onLaunch?.();
      }
      const boost = trackData.checkBoostCollision(sCoord, latX);
      if (boost && turboTimer < P.turbo.duration * 0.5) {
        turboTimer = P.turbo.duration;
        stuntBonus += SCORE.boostPadBonus;
        callbacks.onBoost?.('pad');
      }
      rollAngle += (0 - rollAngle) * (1 - Math.exp(-12 * dt));
    } else {
      if (steer !== 0) {
        if (!rolling) { rolling = true; callbacks.onRollStart?.(); }
        rollAngle += steer * P.barrelRoll.speed * dt;
      }
      latVel *= Math.exp(-3 * dt);
      latX = THREE.MathUtils.clamp(latX + latVel * dt * 0.35, -9.2, 9.2);
      vy += P.gravity * dt;
      pos.y += vy * dt;

      surf = trackData.getTrackSurfaceAt(sCoord, latX);
      if (pos.y <= surf.groundY && vy < 0) {
        if (!surf.onTrack) {
          triggerAbyssFall(surf.type);
          return {
            pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed: effSpeed,
            airborne: true, stuntBonus: 0, turbo: false, inBoost: false,
            rollAngle, totalStunt, inLoop: false, loopCenterZ: 0, falling: true, respawning: false,
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

    const sus = P.suspension;
    suspVel += (-sus.stiffness * suspOffset - sus.damping * suspVel) * dt;
    suspOffset = THREE.MathUtils.clamp(suspOffset + suspVel * dt, -sus.maxCompress, 0.12);

    const meta = trackData.evalCircuitPose(sCoord, latX, _spPos, forwardVec, rightVec, _spUp);
    pos.x = _spPos.x;
    pos.z = _spPos.z;

    const extraSlope = surf.slope - forwardVec.y;
    const targetPitch = airborne ? pitch * 0.4 : Math.atan(extraSlope);
    pitch += (targetPitch - pitch) * (1 - Math.exp(-8 * dt));

    if (group) {
      group.position.set(pos.x, pos.y + suspOffset, pos.z);
      _spZAxis.copy(forwardVec).negate();
      _spMat.makeBasis(rightVec, _spUp, _spZAxis);
      group.quaternion.setFromRotationMatrix(_spMat);
      _spEuler.set(
        pitch,
        airborne ? 0 : THREE.MathUtils.clamp(-latVel * 0.015, -0.24, 0.24),
        airborne ? rollAngle : rollAngle * 0.2 + (surf.bank ?? meta.bank)
      );
      _spQ.setFromEuler(_spEuler);
      group.quaternion.multiply(_spQ);

      const wr = def.wheelRadius || 0.34;
      for (const w of group.userData.wheels || []) w.rotation.x -= (effSpeed / wr) * dt;
      updateFlames(dt, turboActive);
    }
    updatePuffs(dt, !airborne, turboActive);

    const anchorKH = 1 - Math.exp(-12.5 * dt);
    const anchorKY = 1 - Math.exp(-(airborne ? 6.8 : 9.5) * dt);
    camAnchor.x += (pos.x - camAnchor.x) * anchorKH;
    camAnchor.y += ((pos.y + suspOffset * 0.25) - camAnchor.y) * anchorKY;
    camAnchor.z += (pos.z - camAnchor.z) * anchorKH;

    return {
      pos, camAnchor, s: sCoord, latX, forwardVec, rightVec, speed: effSpeed,
      airborne, stuntBonus, turbo: turboActive,
      inBoost: turboActive || (airborne && Math.abs(rollAngle) > 0.25),
      rollAngle, totalStunt, inLoop: false, loopCenterZ: 0, falling: false, respawning: false,
    };
  }

  function updatePlayer(dt, input = {}, trackData = {}) {
    if (trackData?.isSplineCircuit) {
      return updateSplinePlayer(dt, input, trackData);
    }

    const H = trackData.getTrackHeight || defHeight;
    const S = trackData.getTrackSlope || defSlope;
    const R = trackData.checkRampCollision || defRamp;
    const B = trackData.checkBoostCollision || defBoost;
    const P = PHYSICS;

    forwardVec.set(0, 0, -1);
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
        group.rotation.order = 'YXZ';
        group.rotation.set(0, getTrackYaw(pos.z), getTrackBank(pos.z));
        updateFlames(dt, false);
      }
      updatePuffs(dt, false, false);
      if (t >= 1) {
        respawning = false;
        pos.y = getTrackSurfaceAt(pos.x, pos.z).groundY;
        suspVel = -6.5;
        speed = P.baseSpeed * 0.85;
        callbacks.onAbyssRecover?.();
      }
      const camAlphaX = 1 - Math.exp(-10 * dt);
      const camAlphaY = 1 - Math.exp(-9 * dt);
      camAnchor.x += (pos.x - camAnchor.x) * camAlphaX;
      camAnchor.y += (pos.y - camAnchor.y) * camAlphaY;
      camAnchor.z = pos.z;
      return {
        pos, camAnchor, s: -pos.z, speed, airborne: true, stuntBonus: 0,
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
      updatePuffs(dt, false, false);
      const refY = H(pos.z);
      if (fallTimer > 0.72 || pos.y < refY - 9.5) {
        startRespawnDrop();
      }
      const fallK = 1 - Math.exp(-8 * dt);
      camAnchor.x += (pos.x - camAnchor.x) * fallK;
      camAnchor.y += (pos.y - camAnchor.y) * fallK;
      camAnchor.z = pos.z;
      return {
        pos, camAnchor, s: -pos.z, speed, airborne: true, stuntBonus: 0,
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
        -(LOOP_HALF_W - 0.65),
        LOOP_HALF_W - 0.65
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
      updatePuffs(dt, false, true);

      const lpAlpha = 1 - Math.exp(-10 * dt);
      camAnchor.x += (pos.x - camAnchor.x) * lpAlpha;
      camAnchor.y += (pos.y - camAnchor.y) * lpAlpha;
      camAnchor.z = pos.z;

      const loopCenterZ = (loopState.zStart + loopState.zEnd) * 0.5;
      if (loopState.u >= 1) {
        lastLoopSeg = loopState.segIndex;
        pos.set(getTrackCenterX(loopState.zEnd) + LOOP_CENTER_X + loopState.latX, H(loopState.zEnd), loopState.zEnd - 0.06);
        rightVec.set(1, 0, 0);
        loopState = null;
        turboTimer = Math.max(turboTimer, 1.5);
        stuntBonus += SCORE.loopBonus;
        totalStunt += SCORE.loopBonus;
        audio?.playLoopWhoosh?.();
        callbacks.onLoopComplete?.();
        return {
          pos, camAnchor, s: -pos.z, speed: loopSpeed, airborne: false, stuntBonus,
          turbo: true, inBoost: true, rollAngle: 0, totalStunt,
          inLoop: false, loopCenterZ, falling: false, respawning: false, rightVec,
        };
      }

      return {
        pos, camAnchor, s: -pos.z, speed: loopSpeed, airborne: false, stuntBonus,
        turbo: true, inBoost: true, rollAngle: 0, totalStunt,
        inLoop: true, loopCenterZ, falling: false, respawning: false, rightVec,
      };
    }

    /* 4) Maju normal di -Z sambil mengikuti kurva S-curve */
    const prevZ = pos.z;
    pos.z -= effSpeed * dt;
    const cxPrev = getTrackCenterX(prevZ);
    const cxNow = getTrackCenterX(pos.z);
    pos.x += cxNow - cxPrev;

    const segIdx = Math.floor(-pos.z / TRACK.segmentLength);
    const loopWorldCx = cxNow + LOOP_CENTER_X;
    if (!airborne && getSegmentType(segIdx) === 'loop' && segIdx !== lastLoopSeg && Math.abs(pos.x - loopWorldCx) <= LOOP_HALF_W + 0.4) {
      const zStart = -segIdx * TRACK.segmentLength;
      const zEnd = -(segIdx + 1) * TRACK.segmentLength;
      loopState = {
        segIndex: segIdx,
        zStart,
        zEnd,
        y0: H(zStart),
        y1: H(zEnd),
        u: Math.max(0, Math.min(0.18, (zStart - pos.z) / TRACK.segmentLength)),
        latX: THREE.MathUtils.clamp(pos.x - loopWorldCx, -(LOOP_HALF_W - 0.65), LOOP_HALF_W - 0.65),
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
        pos, speed: effSpeed, s: -pos.z, airborne: false, stuntBonus: 0,
        turbo: true, inBoost: true, rollAngle: 0, totalStunt,
        inLoop: true, loopCenterZ: (zStart + zEnd) * 0.5, falling: false, respawning: false, rightVec,
      };
    }

    let surf = getTrackSurfaceAt(pos.x, pos.z);
    const maxSteerX = surf.hasGuardrails ? Math.max(P.steer.maxX, (surf.safeHalfW || 8) - 1.1) : 8.4;

    if (!airborne) {
      const targetLat = steer * P.steer.maxLatSpeed * def.perf.steerMul;
      latVel += (targetLat - latVel) * (1 - Math.exp(-P.steer.lerp * dt));
      pos.x = THREE.MathUtils.clamp(pos.x + latVel * dt, cxNow - maxSteerX, cxNow + maxSteerX);
      surf = getTrackSurfaceAt(pos.x, pos.z);

      if (!surf.onTrack) {
        triggerAbyssFall(surf.type);
        return {
          pos, camAnchor, s: -pos.z, speed: effSpeed, airborne: true, stuntBonus: 0,
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
      pos.x = THREE.MathUtils.clamp(pos.x + latVel * dt * 0.35, cxNow - 8.4, cxNow + 8.4);

      vy += P.gravity * dt;
      pos.y += vy * dt;

      surf = getTrackSurfaceAt(pos.x, pos.z);
      if (pos.y <= surf.groundY && vy < 0) {
        if (!surf.onTrack) {
          triggerAbyssFall(surf.type);
          return {
            pos, camAnchor, s: -pos.z, speed: effSpeed, airborne: true, stuntBonus: 0,
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

    /* Terapkan transform visual mengikuti S-curve yaw & bank */
    if (group) {
      const trackYaw = getTrackYaw(pos.z);
      const trackBank = getTrackBank(pos.z);
      group.position.set(pos.x, pos.y + suspOffset, pos.z);
      group.rotation.order = 'YXZ';
      group.rotation.x = pitch;
      group.rotation.z = airborne ? rollAngle : rollAngle * 0.2 + trackBank;
      group.rotation.y = trackYaw + (airborne ? 0 : -latVel * 0.015);
      rightVec.set(1, 0, 0).applyEuler(group.rotation);

      const wr = def.wheelRadius || 0.34;
      for (const w of group.userData.wheels || []) w.rotation.x -= (effSpeed / wr) * dt;
      updateFlames(dt, turboActive);
    }
    updatePuffs(dt, !airborne, turboActive);

    /* Eksponensial smoothing frame-rate-independent untuk target kamera chase */
    const anchorKX = 1 - Math.exp(-11.5 * dt);
    const anchorKY = 1 - Math.exp(-(airborne ? 6.8 : 9.5) * dt);
    camAnchor.x += (pos.x - camAnchor.x) * anchorKX;
    camAnchor.y += ((pos.y + suspOffset * 0.25) - camAnchor.y) * anchorKY;
    camAnchor.z = pos.z;

    return {
      pos, camAnchor, s: -pos.z, speed: effSpeed, airborne, stuntBonus,
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
      pos, camAnchor, s: sCoord, latX, forwardVec, speed, airborne, turboTimer, rollAngle, totalStunt, type,
      inLoop: !!loopState, falling, respawning, rightVec,
    };
  }

  function dispose() {
    if (group) scene.remove(group);
    for (let i = 0; i < PUFF_MAX; i++) {
      scene.remove(puffs[i].mesh);
      puffs[i].mat.dispose();
    }
    puffGeo.dispose();
  }

  reset();
  return {
    updatePlayer, reset, hitObstacle, triggerBoostSurge, bounceProp, setVehicle, getState, dispose,
    get group() { return group; },
  };
}
