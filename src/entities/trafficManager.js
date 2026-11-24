/* =====================================================================
   trafficManager.js — Spawner lalu lintas Nusantara + 3 Pembalap AI
   kompetitif (membentuk grid 4 pembalap bersama Player menggunakan
   seluruh 4 armada: Angkot, Bemo, L300, Ojol, dan otomatis bertukar
   saat pemain online bergabung lewat Supabase).
   Mendukung trek -Z (Salatiga & Skyway) dan Closed Spline (Mandalika).
   API: update(dt, playerZ, t, playerX, opts), checkCollision(pos, half),
        reset(playerType), dispose(), activeCount, consumeNearMisses(),
        getAIRacersSnapshot().
   ===================================================================== */
import * as THREE from 'three';
import {
  TRAFFIC, PHYSICS, TRACK, SCORE, VEHICLE_TYPES, SLOT_COLORS, getVehicleDef,
} from '../config/gameConfig.js';
import { loadVehicle, setVehicleUnderglow, createNeonRibbonTrail } from './assetFactory.js';
import {
  getTrackHeight, getTrackSlope, getTrackCenterX, getTrackYaw, getTrackBank, getRampSide,
  getSegmentType, getTrackSurfaceAt, getForkProfile, evalLoopPose,
  evalCircuitPose, evalLoopPoseAtS, getLoopZoneAtS, isSplineCircuit,
  checkRampCollision, checkBoostCollision, getActiveArenaId,
  LOOP_ARC_LEN, LOOP_HALF_W, LOOP_CENTER_X, BYPASS_CENTER_X,
} from '../world/activeTrack.js';

const rand = (a, b) => a + Math.random() * (b - a);
const LANE_W = TRACK.width / TRACK.lanes;
const LANES = [-LANE_W, 0, LANE_W];
const AI_LANE_PREFS = [-4.2, 0, 4.2];
const WEIGHTS = [['angkot', 0.3], ['bemo', 0.2], ['l300', 0.25], ['ojol', 0.25]];
const AI_NAMES = {
  angkot: 'AI • Kang Angkot',
  bemo: 'AI • Mang Bemo',
  l300: 'AI • Juragan L300',
  ojol: 'AI • Bang Ojol',
};
const AI_EMOJIS = { angkot: '🚐', bemo: '🛺', l300: '🛻', ojol: '🏍️' };
const TWO_PI = Math.PI * 2;

function pickType() {
  let r = Math.random(), acc = 0;
  for (const [t, w] of WEIGHTS) { acc += w; if (r <= acc) return t; }
  return 'angkot';
}

function makeAINameplate(name, colorHex, vehicleType) {
  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 84;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);

  g.fillStyle = 'rgba(26, 20, 28, 0.88)';
  g.beginPath();
  g.roundRect(8, 12, 344, 58, 26);
  g.fill();

  g.strokeStyle = colorHex || '#ffbe0b';
  g.lineWidth = 4.5;
  g.beginPath();
  g.roundRect(8, 12, 344, 58, 26);
  g.stroke();

  const em = AI_EMOJIS[vehicleType] || '🚐';
  g.fillStyle = '#fff8eb';
  g.font = '700 24px Fredoka, "Plus Jakarta Sans", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`${em} ${String(name).slice(0, 18)}`, 180, 42);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.9, 0.92, 1);
  sprite.renderOrder = 6;
  sprite.userData = { tex, mat };
  return sprite;
}

export async function createTrafficManager(scene) {
  /* 1) Preload pool lalu lintas ambient: 4 instance per tipe */
  const freeByType = {};
  const allGroups = [];
  for (const type of VEHICLE_TYPES) {
    freeByType[type] = [];
    for (let k = 0; k < 4; k++) {
      const g = await loadVehicle(type);
      setVehicleUnderglow(g, null);
      g.visible = false;
      scene.add(g);
      freeByType[type].push(g);
      allGroups.push(g);
    }
  }

  /* 2) Preload 1 instance khusus per tipe untuk Pembalap AI (4 armada lengkap) */
  const aiRigs = {};
  for (const type of VEHICLE_TYPES) {
    const mesh = await loadVehicle(type);
    const def = getVehicleDef(type);
    const root = new THREE.Group();
    root.visible = false;
    root.add(mesh);
    scene.add(root);
    aiRigs[type] = { type, def, root, mesh, plate: null, plateColor: '' };
  }

  const aiSlots = [0, 1, 2].map((idx) => ({
    slotIdx: idx,
    slotColor: SLOT_COLORS[(idx + 1) % SLOT_COLORS.length],
    prefLaneX: AI_LANE_PREFS[idx],
    id: `ai_slot_${idx}`,
    type: 'bemo',
    name: AI_NAMES.bemo,
    rig: null,
    ribbon: createNeonRibbonTrail(scene, SLOT_COLORS[(idx + 1) % SLOT_COLORS.length], 0.50),
    active: false,
    s: 0.6,
    latX: 0,
    x: 0,
    y: 0,
    z: -3,
    vy: 0,
    latVel: 0,
    targetX: 0,
    speed: PHYSICS.baseSpeed * 1.12,
    score: 0,
    coins: 0,
    lastCollectZ: 999,
    lastCollectS: -999,
    airborne: false,
    rollAngle: 0,
    targetRoll: 0,
    turboTimer: 0,
    flamePhase: idx * 2.1,
    loopState: null,
    lastLoopSeg: -1,
    lastLoopLap: -1,
    finishTime: 0,
    skillBias: (idx === 0 ? 0.12 : idx === 1 ? 0.02 : -0.07),
    rightVec: new THREE.Vector3(1, 0, 0),
    forwardVec: new THREE.Vector3(0, 0, -1),
  }));

  const _lpPos = new THREE.Vector3();
  const _lpQuat = new THREE.Quaternion();
  const _lpRight = new THREE.Vector3();
  const _lpFwd = new THREE.Vector3();
  const _spPos = new THREE.Vector3();
  const _spFwd = new THREE.Vector3();
  const _spRight = new THREE.Vector3();
  const _spUp = new THREE.Vector3();
  const _spZAxis = new THREE.Vector3();
  const _spMat = new THREE.Matrix4();
  const _spEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _spQ = new THREE.Quaternion();
  const _targetsBuf = [];

  function bindSlotRig(slot, vType) {
    if (slot.rig && slot.rig.root) {
      slot.rig.root.visible = false;
    }
    const rig = aiRigs[vType] || aiRigs.bemo;
    slot.rig = rig;
    slot.type = vType;
    slot.id = `ai_${vType}`;
    slot.name = AI_NAMES[vType] || `AI • ${rig.def.label}`;
    setVehicleUnderglow(rig.mesh, slot.slotColor);
    if (!rig.plate || rig.plateColor !== slot.slotColor) {
      if (rig.plate) {
        rig.root.remove(rig.plate);
        rig.plate.userData?.tex?.dispose();
        rig.plate.userData?.mat?.dispose();
      }
      const plate = makeAINameplate(slot.name, slot.slotColor, vType);
      plate.position.set(0, rig.def.targetSize.y + 1.08, 0);
      rig.root.add(plate);
      rig.plate = plate;
      rig.plateColor = slot.slotColor;
    }
  }

  function assignAIRacers(playerType = 'angkot', resetPositions = false) {
    const others = VEHICLE_TYPES.filter((t) => t !== playerType);
    const arenaId = getActiveArenaId();
    const isFantasy = arenaId === 'skyway' || arenaId === 'mandalika';
    const splineMode = isSplineCircuit();
    const startOffsets = isFantasy
      ? [
          { x: -4.2, z: -2.2 },
          { x: 0.0, z: -4.8 },
          { x: 4.2, z: -2.4 },
        ]
      : [
          { x: -4.6, z: -2.8 },
          { x: 4.6, z: -3.2 },
          { x: 0.0, z: -6.2 },
        ];
    for (let i = 0; i < aiSlots.length; i++) {
      const slot = aiSlots[i];
      slot.prefLaneX = AI_LANE_PREFS[i];
      const vType = others[i % others.length];
      if (!slot.rig || slot.type !== vType) {
        bindSlotRig(slot, vType);
      }
      if (resetPositions) {
        const off = startOffsets[i];
        slot.s = -off.z;
        slot.latX = off.x;
        if (splineMode) {
          evalCircuitPose(slot.s, slot.latX, _spPos, _spFwd, _spRight, _spUp);
          slot.x = _spPos.x;
          slot.y = _spPos.y;
          slot.z = _spPos.z;
          slot.forwardVec.copy(_spFwd);
          slot.rightVec.copy(_spRight);
        } else {
          slot.x = off.x;
          slot.z = off.z;
          slot.y = getTrackHeight(off.z);
          slot.forwardVec.set(0, 0, -1);
          slot.rightVec.set(1, 0, 0);
        }
        slot.vy = 0;
        slot.latVel = 0;
        slot.targetX = off.x;
        slot.speed = PHYSICS.baseSpeed * (1.02 + slot.skillBias);
        slot.score = 0;
        slot.coins = 0;
        slot.lastCollectZ = 999;
        slot.lastCollectS = -999;
        slot.airborne = false;
        slot.rollAngle = 0;
        slot.targetRoll = 0;
        slot.turboTimer = 0;
        slot.loopState = null;
        slot.lastLoopSeg = -1;
        slot.lastLoopLap = -1;
        slot.finishTime = 0;
        slot.rig.root.position.set(slot.x, slot.y, slot.z);
        slot.rig.mesh.quaternion.identity();
        slot.rig.mesh.rotation.set(0, 0, 0);
        slot.ribbon.setBoostMode(false);
        slot.ribbon.reset(slot.x - slot.forwardVec.x * 1.4, slot.y + 0.35, slot.z - slot.forwardVec.z * 1.4);
      }
    }
  }

  /* 3) Lalu lintas ambient */
  const active = [];
  let spawnTimer = 0.6;
  let nearMisses = 0;

  function spawn(playerZ) {
    if (active.length >= TRAFFIC.poolSize) return;
    const type = pickType();
    const group = freeByType[type].pop();
    if (!group) return;

    const def = getVehicleDef(type);
    const lane = Math.floor(Math.random() * 3);
    const z = playerZ - TRAFFIC.safeSpawnAhead - rand(0, 30);
    const segType = getSegmentType(Math.floor(-z / TRACK.segmentLength));
    if (segType === 'loop' || segType === 'ramp' || segType === 'narrow' || segType === 'fork' || segType === 'skullTunnel') {
      freeByType[type].push(group);
      return;
    }
    for (const e of active) {
      if (Math.abs(e.z - z) < 9 && e.lane === lane) {
        freeByType[type].push(group);
        return;
      }
    }

    const cx = getTrackCenterX(z);
    const surf = getTrackSurfaceAt(cx + LANES[lane], z);
    const initX = surf.onTrack ? (cx + LANES[lane]) : surf.safeCenterX;
    const baseSpeed = PHYSICS.baseSpeed * TRAFFIC.speedFactor[type];
    const e = {
      group, type, def, lane,
      x: initX, targetX: initX, z, s: -z, latX: LANES[lane],
      speed: baseSpeed, baseSpeed,
      state: 'cruise',
      willNgetem: type === 'angkot' && Math.random() < TRAFFIC.ngetem.chance,
      ngetemAt: z - rand(20, 55),
      ngetemTimer: 0,
      phase: Math.random() * Math.PI * 2,
      passed: false,
      halfX: def.targetSize.x / 2, halfZ: def.targetSize.z / 2,
    };
    group.visible = true;
    if (!group.parent) scene.add(group);
    group.position.set(e.x, getTrackHeight(z), e.z);
    active.push(e);
  }

  function spawnSpline(playerS, track) {
    if (active.length >= 8) return;
    const type = pickType();
    const group = freeByType[type].pop();
    if (!group) return;

    const def = getVehicleDef(type);
    const lane = Math.floor(Math.random() * 3);
    const s = playerS + TRAFFIC.safeSpawnAhead + rand(0, 36);
    const surf = track.getTrackSurfaceAt(s, LANES[lane]);
    if (!surf.onTrack || surf.type === 'loop' || surf.type === 'ramp' || surf.type === 'fork') {
      freeByType[type].push(group);
      return;
    }
    for (const e of active) {
      if (Math.abs((e.s ?? 0) - s) < 11 && e.lane === lane) {
        freeByType[type].push(group);
        return;
      }
    }

    const initLat = LANES[lane];
    evalCircuitPose(s, initLat, _spPos, _spFwd, _spRight, _spUp);
    const baseSpeed = PHYSICS.baseSpeed * TRAFFIC.speedFactor[type];
    const e = {
      group, type, def, lane,
      s, latX: initLat, targetLatX: initLat,
      x: _spPos.x, z: _spPos.z,
      speed: baseSpeed, baseSpeed,
      state: 'cruise',
      willNgetem: type === 'angkot' && Math.random() < TRAFFIC.ngetem.chance,
      ngetemAtS: s + rand(22, 56),
      ngetemTimer: 0,
      phase: Math.random() * Math.PI * 2,
      passed: false,
      halfX: def.targetSize.x / 2, halfZ: def.targetSize.z / 2,
    };
    group.visible = true;
    if (!group.parent) scene.add(group);
    group.position.set(e.x, surf.groundY, e.z);
    active.push(e);
  }

  function despawn(idx) {
    const e = active[idx];
    e.group.visible = false;
    freeByType[e.type].push(e.group);
    active.splice(idx, 1);
  }

  /* ==================== Update 3 AI Racers pada Closed-Spline Mandalika ==================== */
  function updateSplineAIRacers(rawDt, playerS, t, playerType, remotePlayers, track, playerLatX = 0, lapGoal = 1500) {
    if (playerType && aiSlots[0]?.type === playerType) {
      assignAIRacers(playerType, false);
    }
    const totalLen = track.TOTAL_LEN || 1500;
    const activePeers = (remotePlayers || []).filter((p) => p.state === 'PLAYING' || p.state === 'PAUSED');
    const peerCount = activePeers.length;

    if (track?.getCollectibleTargets) {
      track.getCollectibleTargets(playerS - 30, playerS + 140, _targetsBuf);
    } else {
      _targetsBuf.length = 0;
    }

    for (let i = 0; i < aiSlots.length; i++) {
      const ai = aiSlots[i];
      const shouldActive = i >= peerCount;
      ai.active = shouldActive;
      if (!ai.rig) continue;

      if (!shouldActive) {
        ai.rig.root.visible = false;
        ai.ribbon.setVisible(false);
        continue;
      }

      ai.rig.root.visible = true;
      ai.ribbon.setVisible(true);
      const def = ai.rig.def;
      const wr = def.wheelRadius || 0.34;
      if (ai.turboTimer > 0) ai.turboTimer = Math.max(0, ai.turboTimer - rawDt);

      const gapToPlayer = playerS - ai.s; // positif = AI di belakang player

      if (ai.loopState) {
        const loopArc = track.LOOP_ARC_LEN || LOOP_ARC_LEN;
        const loopCx = track.LOOP_CENTER_X ?? LOOP_CENTER_X;
        const loopSpd = Math.max(ai.speed * 1.35, PHYSICS.baseSpeed * 1.55);
        ai.loopState.u += (loopSpd * rawDt) / loopArc;
        const uEval = Math.min(1, ai.loopState.u);
        track.evalLoopPoseAtS(ai.loopState.sStart, ai.loopState.sEnd, uEval, ai.loopState.latX, _lpPos, _lpQuat, _lpRight, _lpFwd);
        ai.x = _lpPos.x; ai.y = _lpPos.y; ai.z = _lpPos.z;
        ai.s = ai.loopState.lapBase + THREE.MathUtils.lerp(ai.loopState.sStart, ai.loopState.sEnd, uEval);
        ai.latX = loopCx + ai.loopState.latX;
        ai.rightVec.copy(_lpRight);
        ai.forwardVec.copy(_lpFwd);
        ai.rig.root.position.copy(_lpPos);
        ai.rig.mesh.quaternion.copy(_lpQuat);
        ai.score += loopSpd * rawDt;

        for (const w of ai.rig.mesh.userData.wheels || []) w.rotation.x -= (loopSpd / wr) * rawDt;
        const fl = ai.rig.mesh.userData.flames;
        if (fl?.group) {
          fl.group.visible = true;
          ai.flamePhase += rawDt * 42;
          for (let j = 0; j < fl.jets.length; j++) {
            const s = 0.9 + 0.4 * Math.abs(Math.sin(ai.flamePhase + j * 1.7));
            fl.jets[j].scale.set(s, s, 1.15);
          }
        }
        ai.ribbon.setBoostMode(true);
        ai.ribbon.update(
          ai.x - ai.forwardVec.x * 1.1, ai.y + 0.32, ai.z - ai.forwardVec.z * 1.1,
          ai.rightVec.x, ai.rightVec.y, ai.rightVec.z
        );

        if (ai.loopState.u >= 1) {
          ai.lastLoopLap = ai.loopState.lapIdx;
          ai.s = ai.loopState.lapBase + ai.loopState.sEnd + 0.1;
          ai.latX = loopCx + ai.loopState.latX;
          ai.loopState = null;
          ai.turboTimer = 1.4;
          ai.score += SCORE.loopBonus;
          if (!ai.finishTime && ai.s >= lapGoal) ai.finishTime = t || 1;
        }
        continue;
      }

      // Stagger target pace so the 3 AI racers spread naturally ahead/alongside/behind instead of bunching
      const slotGapTarget = (i - 1) * 14;
      const desiredSpd = (() => {
        let base = PHYSICS.maxSpeed * def.perf.speedMul * (0.84 + ai.skillBias);
        const relGap = gapToPlayer + slotGapTarget;
        if (relGap > 8) base += Math.min(10, (relGap - 8) * 0.28);
        else if (relGap < -18) base -= Math.min(7.5, (-relGap - 18) * 0.22);
        return THREE.MathUtils.clamp(base, 13, PHYSICS.maxSpeed * 1.15);
      })();
      ai.speed += (desiredSpd - ai.speed) * (1 - Math.exp(-2.8 * rawDt));

      const effSpd = ai.speed * (ai.turboTimer > 0 ? 1.42 : 1);
      ai.s += effSpd * rawDt;
      ai.score += effSpd * SCORE.distancePerUnit * rawDt;
      if (!ai.finishTime && ai.s >= lapGoal) ai.finishTime = t || 1;

      const lapIdx = Math.floor(ai.s / totalLen);
      const loopZone = track.getLoopZoneAtS?.(ai.s);
      if (!ai.airborne && loopZone && lapIdx !== ai.lastLoopLap && Math.abs(ai.latX - loopZone.centerLatX) <= loopZone.halfW + 0.4) {
        const ws = ((ai.s % totalLen) + totalLen) % totalLen;
        ai.loopState = {
          lapIdx,
          lapBase: lapIdx * totalLen,
          sStart: loopZone.sStart,
          sEnd: loopZone.sEnd,
          u: Math.max(0, Math.min(0.18, (ws - loopZone.sStart) / Math.max(1, loopZone.sEnd - loopZone.sStart))),
          latX: THREE.MathUtils.clamp(ai.latX - loopZone.centerLatX, -(loopZone.halfW - 0.85), loopZone.halfW - 0.85),
        };
        continue;
      }

      const lookS = ai.s + 14;
      const lookSurf = track.getTrackSurfaceAt(lookS, ai.latX);
      const curSurf = track.getTrackSurfaceAt(ai.s, ai.latX);

      let desiredLat = ai.prefLaneX + Math.sin(t * 0.42 + ai.slotIdx * 2.1) * 0.55;
      if (lookSurf.type === 'ramp') {
        const rSide = lookSurf.rampSide || 1;
        const takeJump = (ai.slotIdx % 2) === 0;
        desiredLat = takeJump ? rSide * 4.2 : -rSide * 4.2;
      } else if (lookSurf.type === 'loop') {
        const takeLoop = (ai.slotIdx % 2) === 0;
        desiredLat = takeLoop ? (LOOP_CENTER_X + (ai.slotIdx - 1) * 0.4) : (BYPASS_CENTER_X + (ai.slotIdx - 1) * 0.5);
      } else if (lookSurf.type === 'fork') {
        const takeUpper = (ai.slotIdx % 2) === 0;
        desiredLat = takeUpper ? -4.4 : 4.2;
      } else {
        const aiWrapS = ((ai.s % totalLen) + totalLen) % totalLen;
        let bestTarget = null;
        let bestWeight = 999;
        for (let k = 0; k < _targetsBuf.length; k++) {
          const tg = _targetsBuf[k];
          let ds = tg.s - aiWrapS;
          if (ds < 0) ds += totalLen;
          if (ds < 2.5 || ds > 22) continue;
          const laneDev = Math.abs(tg.latX - ai.prefLaneX);
          if (laneDev > 3.6) continue;
          const dLat = Math.abs(tg.latX - ai.latX);
          const bonusPri = tg.kind === 'gem' ? -4 : tg.kind === 'fruit' ? -2.5 : 0;
          const cost = ds * 0.45 + dLat * 1.1 + laneDev * 1.35 + bonusPri;
          if (cost < bestWeight) { bestWeight = cost; bestTarget = tg; }
        }
        if (bestTarget) desiredLat = bestTarget.latX;
      }

      const hazards = track.getUpcomingHazards?.(ai.s, 28);
      if (hazards && hazards.length > 0) {
        const hz = hazards[0];
        if (Math.abs(hz.laneX - desiredLat) < 2.6) {
          desiredLat = hz.laneX >= 0 ? Math.max(-6.4, hz.laneX - 4.4) : Math.min(6.4, hz.laneX + 4.4);
        }
      }
      for (const e of active) {
        const ds = (e.s ?? 0) - ai.s;
        if (ds > 1 && ds < 14 && Math.abs((e.latX ?? 0) - ai.latX) < 2.6) {
          desiredLat = (e.latX ?? 0) >= 0 ? Math.max(-6.4, (e.latX ?? 0) - 3.8) : Math.min(6.4, (e.latX ?? 0) + 3.8);
          break;
        }
      }

      for (let j = 0; j < aiSlots.length; j++) {
        if (j === i) continue;
        const peer = aiSlots[j];
        if (!peer.active || peer.loopState) continue;
        if (Math.abs(ai.s - peer.s) < 10.0 && Math.abs(ai.latX - peer.latX) < 3.8) {
          const dir = ai.latX !== peer.latX ? (ai.latX > peer.latX ? 1 : -1) : (i > j ? 1 : -1);
          desiredLat += dir * (3.8 - Math.abs(ai.latX - peer.latX)) * 1.25;
        }
      }
      if (Math.abs(ai.s - playerS) < 8.5 && Math.abs(ai.latX - playerLatX) < 3.6) {
        const dir = ai.latX >= playerLatX ? 1 : -1;
        desiredLat += dir * (3.6 - Math.abs(ai.latX - playerLatX)) * 1.05;
      }

      if (curSurf.type === 'fork' || curSurf.type === 'loop') {
        desiredLat = THREE.MathUtils.clamp(
          desiredLat,
          curSurf.safeCenterX - Math.max(0.4, curSurf.safeHalfW - 0.85),
          curSurf.safeCenterX + Math.max(0.4, curSurf.safeHalfW - 0.85)
        );
      } else if (curSurf.type === 'ramp' && curSurf.inGap) {
        desiredLat = curSurf.safeCenterX;
      } else {
        desiredLat = THREE.MathUtils.clamp(desiredLat, -6.8, 6.8);
      }

      const latLerp = 1 - Math.exp(-5.5 * rawDt);
      const prevLat = ai.latX;
      ai.latX += (desiredLat - ai.latX) * latLerp;
      ai.latVel = (ai.latX - prevLat) / Math.max(0.001, rawDt);

      const surfNow = track.getTrackSurfaceAt(ai.s, ai.latX);
      if (!ai.airborne) {
        if (!surfNow.onTrack) {
          ai.latX += (surfNow.safeCenterX - ai.latX) * Math.min(1, rawDt * 12);
        }
        ai.y = surfNow.groundY;
        const ramp = track.checkRampCollision(ai.s, ai.latX);
        if (ramp && effSpd > PHYSICS.ramp.minSpeed) {
          ai.airborne = true;
          ai.vy = ramp.launchVy + effSpd * 0.1;
          ai.rollAngle = 0;
          ai.targetRoll = (ai.slotIdx % 2 === 0 ? 1 : -1) * TWO_PI;
        }
        const boost = track.checkBoostCollision(ai.s, ai.latX);
        if (boost) {
          ai.turboTimer = 1.85;
          ai.score += SCORE.boostPadBonus;
        }
        ai.rollAngle += (0 - ai.rollAngle) * (1 - Math.exp(-10 * rawDt));
      } else {
        ai.vy += PHYSICS.gravity * rawDt;
        ai.y += ai.vy * rawDt;
        if (ai.targetRoll !== 0) {
          const stepRoll = Math.sign(ai.targetRoll) * PHYSICS.barrelRoll.speed * 0.88 * rawDt;
          if (Math.abs(ai.rollAngle + stepRoll) <= Math.abs(ai.targetRoll)) ai.rollAngle += stepRoll;
          else ai.rollAngle = ai.targetRoll;
        }
        if (ai.y <= surfNow.groundY && ai.vy < 0) {
          ai.y = surfNow.groundY;
          ai.airborne = false;
          ai.vy = 0;
          if (Math.abs(ai.rollAngle) >= TWO_PI * 0.85) {
            ai.turboTimer = 1.6;
            ai.score += SCORE.rollBonus;
          }
          ai.rollAngle = 0; ai.targetRoll = 0;
        }
      }

      const aiWrapNow = ((ai.s % totalLen) + totalLen) % totalLen;
      for (let k = 0; k < _targetsBuf.length; k++) {
        const tg = _targetsBuf[k];
        let ds = Math.abs(tg.s - aiWrapNow);
        if (ds > totalLen * 0.5) ds = totalLen - ds;
        if (ds < 1.2 && Math.abs(tg.latX - ai.latX) < 1.7 && Math.abs(tg.s - ai.lastCollectS) > 1.5) {
          ai.lastCollectS = tg.s;
          const cAdd = (tg.kind === 'ring' || tg.kind === 'gem') ? 5 : tg.kind === 'fruit' ? 2 : 1;
          const ptsAdd = tg.kind === 'ring' ? SCORE.ringBonus : tg.kind === 'gem' ? SCORE.gemBonus : tg.kind === 'fruit' ? SCORE.fruitBonus : SCORE.coinBonus;
          ai.coins += cAdd;
          ai.score += ptsAdd;
          if (tg.kind === 'ring') ai.turboTimer = 1.8;
        }
      }

      const meta = track.evalCircuitPose(ai.s, ai.latX, _spPos, _spFwd, _spRight, _spUp);
      ai.x = _spPos.x; ai.z = _spPos.z;
      ai.forwardVec.copy(_spFwd);

      ai.rig.root.position.set(ai.x, ai.y, ai.z);
      _spZAxis.copy(_spFwd).negate();
      _spMat.makeBasis(_spRight, _spUp, _spZAxis);
      ai.rig.mesh.quaternion.setFromRotationMatrix(_spMat);
      const extraSlope = surfNow.slope - _spFwd.y;
      _spEuler.set(
        ai.airborne ? 0 : Math.atan(extraSlope),
        ai.airborne ? 0 : THREE.MathUtils.clamp(-ai.latVel * 0.016, -0.22, 0.22),
        ai.airborne ? ai.rollAngle : (surfNow.bank ?? meta.bank)
      );
      _spQ.setFromEuler(_spEuler);
      ai.rig.mesh.quaternion.multiply(_spQ);
      ai.rightVec.set(1, 0, 0).applyQuaternion(ai.rig.mesh.quaternion);

      for (const w of ai.rig.mesh.userData.wheels || []) w.rotation.x -= (effSpd / wr) * rawDt;
      const fl = ai.rig.mesh.userData.flames;
      if (fl?.group) {
        const on = ai.turboTimer > 0;
        fl.group.visible = on;
        if (on) {
          ai.flamePhase += rawDt * 42;
          for (let j = 0; j < fl.jets.length; j++) {
            const s = 0.85 + 0.42 * Math.abs(Math.sin(ai.flamePhase + j * 1.7));
            fl.jets[j].scale.set(s, s, 1.05 + 0.45 * Math.sin(ai.flamePhase * 1.3 + j));
          }
        }
      }

      ai.ribbon.setBoostMode(ai.turboTimer > 0 || ai.airborne);
      ai.ribbon.update(
        ai.x - _spFwd.x * 1.3, ai.y + 0.34, ai.z - _spFwd.z * 1.3,
        ai.rightVec.x, ai.rightVec.y, ai.rightVec.z
      );
    }
  }

  function updateAIRacers(rawDt, playerZ, t, playerType, remotePlayers, track, playerX = 0, lapGoal = 1500) {
    if (playerType && aiSlots[0]?.type === playerType) {
      assignAIRacers(playerType, false);
    }
    const activePeers = (remotePlayers || []).filter((p) => p.state === 'PLAYING' || p.state === 'PAUSED');
    const peerCount = activePeers.length;

    if (track?.getCollectibleTargets) {
      track.getCollectibleTargets(playerZ - 140, playerZ + 40, _targetsBuf);
    } else {
      _targetsBuf.length = 0;
    }

    for (let i = 0; i < aiSlots.length; i++) {
      const ai = aiSlots[i];
      const shouldActive = i >= peerCount;
      ai.active = shouldActive;
      if (!ai.rig) continue;

      if (!shouldActive) {
        ai.rig.root.visible = false;
        ai.ribbon.setVisible(false);
        continue;
      }

      ai.rig.root.visible = true;
      ai.ribbon.setVisible(true);

      const def = ai.rig.def;
      const wr = def.wheelRadius || 0.34;
      if (ai.turboTimer > 0) ai.turboTimer = Math.max(0, ai.turboTimer - rawDt);

      const gapToPlayer = ai.z - playerZ; // positif = di belakang player

      if (ai.loopState) {
        const loopSpd = Math.max(ai.speed * 1.35, PHYSICS.baseSpeed * 1.55);
        ai.loopState.u += (loopSpd * rawDt) / LOOP_ARC_LEN;
        const uEval = Math.min(1, ai.loopState.u);
        evalLoopPose(
          ai.loopState.zStart, ai.loopState.zEnd, ai.loopState.y0, ai.loopState.y1,
          uEval, ai.loopState.latX, _lpPos, _lpQuat, _lpRight
        );
        ai.x = _lpPos.x;
        ai.y = _lpPos.y;
        ai.z = _lpPos.z;
        ai.s = -ai.z;
        ai.rightVec.copy(_lpRight);
        ai.rig.root.position.copy(_lpPos);
        ai.rig.mesh.quaternion.copy(_lpQuat);
        ai.score += loopSpd * rawDt;

        for (const w of ai.rig.mesh.userData.wheels || []) w.rotation.x -= (loopSpd / wr) * rawDt;
        const fl = ai.rig.mesh.userData.flames;
        if (fl?.group) {
          fl.group.visible = true;
          ai.flamePhase += rawDt * 42;
          for (let j = 0; j < fl.jets.length; j++) {
            const s = 0.9 + 0.4 * Math.abs(Math.sin(ai.flamePhase + j * 1.7));
            fl.jets[j].scale.set(s, s, 1.15);
          }
        }
        ai.ribbon.setBoostMode(true);
        ai.ribbon.update(ai.x, ai.y + 0.32, ai.z + 1.1, ai.rightVec.x, ai.rightVec.y, ai.rightVec.z);

        if (ai.loopState.u >= 1) {
          ai.lastLoopSeg = ai.loopState.segIndex;
          ai.z = ai.loopState.zEnd - 0.1;
          ai.s = -ai.z;
          ai.y = getTrackHeight(ai.z);
          ai.x = getTrackCenterX(ai.z) + LOOP_CENTER_X + ai.loopState.latX;
          ai.loopState = null;
          ai.turboTimer = 1.4;
          ai.score += SCORE.loopBonus;
          ai.rig.mesh.quaternion.identity();
          ai.rightVec.set(1, 0, 0);
          if (!ai.finishTime && -ai.z >= lapGoal) ai.finishTime = t || 1;
        }
        continue;
      }

      const slotGapTarget = (i - 1) * 14;
      let desiredSpd = PHYSICS.maxSpeed * def.perf.speedMul * (0.84 + ai.skillBias);
      const relGap = gapToPlayer + slotGapTarget;
      if (relGap > 8) desiredSpd += Math.min(10, (relGap - 8) * 0.28);
      else if (relGap < -18) desiredSpd -= Math.min(7.5, (-relGap - 18) * 0.22);
      desiredSpd = THREE.MathUtils.clamp(desiredSpd, 13, PHYSICS.maxSpeed * 1.15);
      ai.speed += (desiredSpd - ai.speed) * (1 - Math.exp(-2.8 * rawDt));

      const effSpd = ai.speed * (ai.turboTimer > 0 ? 1.42 : 1);
      const prevZ = ai.z;
      ai.z -= effSpd * rawDt;
      ai.s = -ai.z;
      const cxPrev = getTrackCenterX(prevZ);
      const cxNow = getTrackCenterX(ai.z);
      ai.x += cxNow - cxPrev;
      ai.score += effSpd * SCORE.distancePerUnit * rawDt;
      if (!ai.finishTime && -ai.z >= lapGoal) ai.finishTime = t || 1;

      const segIdx = Math.floor(-ai.z / TRACK.segmentLength);
      const loopWorldCx = cxNow + LOOP_CENTER_X;
      if (!ai.airborne && getSegmentType(segIdx) === 'loop' && segIdx !== ai.lastLoopSeg && Math.abs(ai.x - loopWorldCx) <= LOOP_HALF_W + 0.4) {
        const zStart = -segIdx * TRACK.segmentLength;
        const zEnd = -(segIdx + 1) * TRACK.segmentLength;
        ai.loopState = {
          segIndex: segIdx,
          zStart,
          zEnd,
          y0: getTrackHeight(zStart),
          y1: getTrackHeight(zEnd),
          u: Math.max(0, Math.min(0.18, (zStart - ai.z) / TRACK.segmentLength)),
          latX: THREE.MathUtils.clamp(ai.x - loopWorldCx, -(LOOP_HALF_W - 0.85), LOOP_HALF_W - 0.85),
        };
        continue;
      }

      const lookZ = ai.z - 12;
      const lookCx = getTrackCenterX(lookZ);
      const lookSeg = Math.floor(-lookZ / TRACK.segmentLength);
      const lookType = getSegmentType(lookSeg);
      const curSurf = getTrackSurfaceAt(ai.x, ai.z);

      let desiredX = lookCx + ai.prefLaneX + Math.sin(t * 0.45 + ai.slotIdx * 2.1) * 0.9;
      if (lookType === 'narrow') {
        desiredX = lookCx + THREE.MathUtils.clamp(ai.prefLaneX * 0.35, -1.9, 1.9);
      } else if (lookType === 'ramp') {
        const rSide = getRampSide(lookSeg);
        const takeJump = ((lookSeg + ai.slotIdx) % 3) === 0;
        desiredX = lookCx + (takeJump ? rSide * 4.0 : -rSide * 4.0);
      } else if (lookType === 'loop') {
        const takeLoop = ((lookSeg + ai.slotIdx) % 2) === 0;
        desiredX = lookCx + (takeLoop
          ? LOOP_CENTER_X + (ai.slotIdx - 1) * 0.4
          : BYPASS_CENTER_X + (ai.slotIdx - 1) * 0.5);
      } else if (lookType === 'fork') {
        const z0 = -lookSeg * TRACK.segmentLength;
        const ft = Math.min(1, Math.max(0, (z0 - lookZ) / TRACK.segmentLength));
        const fp = getForkProfile(ft);
        const takeLeft = ((lookSeg + ai.slotIdx) % 2) === 0;
        desiredX = lookCx + (takeLeft ? fp.cxL : fp.cxR);
      } else {
        let bestTarget = null;
        let bestWeight = 999;
        for (let k = 0; k < _targetsBuf.length; k++) {
          const tg = _targetsBuf[k];
          const dz = ai.z - tg.z;
          if (dz < 2.5 || dz > 22) continue;
          const dx = Math.abs(tg.x - ai.x);
          const laneDev = Math.abs(tg.x - (lookCx + ai.prefLaneX));
          if (laneDev > 3.6) continue;
          const bonusPri = tg.kind === 'gem' ? -5 : tg.kind === 'fruit' ? -3 : 0;
          const cost = dz * 0.45 + dx * 1.15 + laneDev * 1.1 + bonusPri;
          if (cost < bestWeight) {
            bestWeight = cost;
            bestTarget = tg;
          }
        }
        if (bestTarget) desiredX = bestTarget.x;
      }

      const hazards = track?.getUpcomingHazards?.(ai.z, 26);
      if (hazards && hazards.length > 0) {
        const hz = hazards[0];
        if (Math.abs(hz.laneX - desiredX) < 2.5) {
          desiredX = hz.laneX >= cxNow ? Math.max(cxNow - 6.2, hz.laneX - 4.4) : Math.min(cxNow + 6.2, hz.laneX + 4.4);
        }
      }
      for (const e of active) {
        const dz = ai.z - e.z;
        if (dz > 1 && dz < 13 && Math.abs(e.x - ai.x) < 2.6) {
          desiredX = e.x >= cxNow ? Math.max(cxNow - 6.2, e.x - 3.8) : Math.min(cxNow + 6.2, e.x + 3.8);
          break;
        }
      }

      for (let j = 0; j < aiSlots.length; j++) {
        if (j === i) continue;
        const peer = aiSlots[j];
        if (!peer.active || peer.loopState) continue;
        if (Math.abs(ai.z - peer.z) < 7.5 && Math.abs(ai.x - peer.x) < 3.4) {
          const dir = ai.x !== peer.x ? (ai.x > peer.x ? 1 : -1) : (i > j ? 1 : -1);
          desiredX += dir * (3.4 - Math.abs(ai.x - peer.x)) * 1.1;
        }
      }
      if (Math.abs(ai.z - playerZ) < 7.5 && Math.abs(ai.x - playerX) < 3.4) {
        const dir = ai.x >= playerX ? 1 : -1;
        desiredX += dir * (3.4 - Math.abs(ai.x - playerX)) * 0.95;
      }

      if (curSurf.type === 'narrow') {
        const lim = Math.max(0.4, curSurf.safeHalfW - 0.85);
        desiredX = THREE.MathUtils.clamp(desiredX, cxNow - lim, cxNow + lim);
      } else if (curSurf.type === 'fork' || curSurf.type === 'loop') {
        desiredX = THREE.MathUtils.clamp(
          desiredX,
          curSurf.safeCenterX - Math.max(0.4, curSurf.safeHalfW - 0.85),
          curSurf.safeCenterX + Math.max(0.4, curSurf.safeHalfW - 0.85)
        );
      } else if (curSurf.type === 'ramp' && curSurf.inGap) {
        desiredX = curSurf.safeCenterX;
      } else {
        desiredX = THREE.MathUtils.clamp(desiredX, cxNow - 6.4, cxNow + 6.4);
      }

      ai.targetX = desiredX;
      const latLerp = 1 - Math.exp(-5.5 * rawDt);
      const prevX = ai.x;
      ai.x += (ai.targetX - ai.x) * latLerp;
      ai.latVel = (ai.x - prevX) / Math.max(0.001, rawDt);

      const surfNow = getTrackSurfaceAt(ai.x, ai.z);

      if (!ai.airborne) {
        if (!surfNow.onTrack) {
          ai.x += (surfNow.safeCenterX - ai.x) * Math.min(1, rawDt * 12);
          ai.y = surfNow.groundY;
        } else {
          ai.y = surfNow.groundY;
        }

        const ramp = checkRampCollision(ai.x, ai.z);
        if (ramp && effSpd > PHYSICS.ramp.minSpeed) {
          ai.airborne = true;
          ai.vy = ramp.launchVy + effSpd * 0.1;
          ai.rollAngle = 0;
          ai.targetRoll = (ai.slotIdx % 2 === 0 ? 1 : -1) * TWO_PI;
        }
        const boost = checkBoostCollision(ai.x, ai.z);
        if (boost) {
          ai.turboTimer = 1.85;
          ai.score += SCORE.boostPadBonus;
        }
        ai.rollAngle += (0 - ai.rollAngle) * (1 - Math.exp(-10 * rawDt));
      } else {
        ai.vy += PHYSICS.gravity * rawDt;
        ai.y += ai.vy * rawDt;
        if (ai.targetRoll !== 0) {
          const stepRoll = Math.sign(ai.targetRoll) * PHYSICS.barrelRoll.speed * 0.88 * rawDt;
          if (Math.abs(ai.rollAngle + stepRoll) <= Math.abs(ai.targetRoll)) {
            ai.rollAngle += stepRoll;
          } else {
            ai.rollAngle = ai.targetRoll;
          }
        }
        if (ai.y <= surfNow.groundY && ai.vy < 0) {
          ai.y = surfNow.groundY;
          ai.airborne = false;
          ai.vy = 0;
          if (Math.abs(ai.rollAngle) >= TWO_PI * 0.85) {
            ai.turboTimer = 1.6;
            ai.score += SCORE.rollBonus;
          }
          ai.rollAngle = 0;
          ai.targetRoll = 0;
        }
      }

      for (let k = 0; k < _targetsBuf.length; k++) {
        const tg = _targetsBuf[k];
        if (Math.abs(tg.z - ai.z) < 0.75 && Math.abs(tg.x - ai.x) < 1.65 && Math.abs(tg.z - ai.lastCollectZ) > 0.9) {
          ai.lastCollectZ = tg.z;
          const cAdd = (tg.kind === 'ring' || tg.kind === 'gem') ? 5 : tg.kind === 'fruit' ? 2 : 1;
          const ptsAdd = tg.kind === 'ring' ? SCORE.ringBonus : tg.kind === 'gem' ? SCORE.gemBonus : tg.kind === 'fruit' ? SCORE.fruitBonus : SCORE.coinBonus;
          ai.coins += cAdd;
          ai.score += ptsAdd;
          if (tg.kind === 'ring') ai.turboTimer = 1.8;
        }
      }

      const slope = getTrackSlope(ai.z);
      const trackYaw = getTrackYaw(ai.z);
      const trackBank = getTrackBank(ai.z);
      ai.rig.root.position.set(ai.x, ai.y, ai.z);
      ai.rig.mesh.rotation.order = 'YXZ';
      ai.rig.mesh.rotation.x = ai.airborne ? 0 : Math.atan(-slope);
      ai.rig.mesh.rotation.z = ai.airborne ? ai.rollAngle : trackBank;
      ai.rig.mesh.rotation.y = trackYaw + (ai.airborne ? 0 : THREE.MathUtils.clamp(-ai.latVel * 0.016, -0.22, 0.22));

      ai.rightVec.set(1, 0, 0).applyEuler(ai.rig.mesh.rotation);

      for (const w of ai.rig.mesh.userData.wheels || []) w.rotation.x -= (effSpd / wr) * rawDt;
      const fl = ai.rig.mesh.userData.flames;
      if (fl?.group) {
        const on = ai.turboTimer > 0;
        fl.group.visible = on;
        if (on) {
          ai.flamePhase += rawDt * 42;
          for (let j = 0; j < fl.jets.length; j++) {
            const s = 0.85 + 0.42 * Math.abs(Math.sin(ai.flamePhase + j * 1.7));
            fl.jets[j].scale.set(s, s, 1.05 + 0.45 * Math.sin(ai.flamePhase * 1.3 + j));
          }
        }
      }

      ai.ribbon.setBoostMode(ai.turboTimer > 0 || ai.airborne);
      ai.ribbon.update(ai.x, ai.y + 0.34, ai.z + 1.3, ai.rightVec.x, ai.rightVec.y, ai.rightVec.z);
    }
  }

  function update(dt, playerZ, t = 0, playerX = 0, opts = {}) {
    if (opts.track?.isSplineCircuit) {
      const track = opts.track;
      const playerS = opts.playerS ?? 0;
      const playerLatX = opts.playerLatX ?? 0;
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnSpline(playerS, track);
        spawnTimer = rand(1.1, 2.0);
      }

      for (let i = active.length - 1; i >= 0; i--) {
        const e = active[i];
        if (e.type === 'angkot') {
          if (e.state === 'cruise' && e.willNgetem && e.s >= e.ngetemAtS) {
            e.state = 'ngetem';
            e.ngetemTimer = rand(TRAFFIC.ngetem.duration[0], TRAFFIC.ngetem.duration[1]);
            e.targetLatX = LANES[0];
          }
          if (e.state === 'ngetem') {
            e.ngetemTimer -= dt;
            e.speed += (0 - e.speed) * (1 - Math.exp(-6 * dt));
            if (e.ngetemTimer <= 0) { e.state = 'cruise'; e.willNgetem = false; e.targetLatX = LANES[e.lane]; }
          } else {
            e.speed += (e.baseSpeed - e.speed) * (1 - Math.exp(-2 * dt));
            e.targetLatX = LANES[e.lane];
          }
        } else if (e.type === 'ojol') {
          e.speed = e.baseSpeed;
          e.targetLatX = LANES[e.lane] + Math.sin(t * TRAFFIC.ojolWeave.freq + e.phase) * TRAFFIC.ojolWeave.amp;
        } else if (e.type === 'bemo') {
          e.speed = e.baseSpeed;
          e.targetLatX = LANES[e.lane] + Math.sin(t * 0.6 + e.phase) * 0.25;
        } else {
          e.speed = e.baseSpeed;
          e.targetLatX = LANES[e.lane];
        }

        e.s += e.speed * dt;
        const surf = track.getTrackSurfaceAt(e.s, e.latX);
        if (surf.type === 'loop' || surf.inGap || surf.type === 'fork') {
          despawn(i);
          continue;
        }
        const limMin = surf.safeCenterX - Math.max(0.6, surf.safeHalfW - 0.9);
        const limMax = surf.safeCenterX + Math.max(0.6, surf.safeHalfW - 0.9);
        const clampedTarget = THREE.MathUtils.clamp(e.targetLatX, limMin, limMax);
        e.latX += (clampedTarget - e.latX) * (1 - Math.exp(-5 * dt));
        e.latX = THREE.MathUtils.clamp(e.latX, limMin, limMax);

        const meta = track.evalCircuitPose(e.s, e.latX, _spPos, _spFwd, _spRight, _spUp);
        e.x = _spPos.x; e.z = _spPos.z;
        e.group.position.set(e.x, surf.groundY, e.z);
        _spZAxis.copy(_spFwd).negate();
        _spMat.makeBasis(_spRight, _spUp, _spZAxis);
        e.group.quaternion.setFromRotationMatrix(_spMat);
        _spEuler.set(0, (clampedTarget - e.latX) * -0.02, surf.bank ?? meta.bank);
        _spQ.setFromEuler(_spEuler);
        e.group.quaternion.multiply(_spQ);

        const wr = e.def.wheelRadius || 0.34;
        for (const w of e.group.userData.wheels || []) w.rotation.x -= (e.speed / wr) * dt;
        const blink = Math.sin(t * 10) > 0;
        const hazard = e.state === 'ngetem';
        for (const ind of e.group.userData.indicators || []) ind.material.emissiveIntensity = hazard && blink ? 1.8 : 0;
        for (const br of e.group.userData.brakes || []) br.material.emissiveIntensity = hazard ? 1.6 : 0.7;

        if (!e.passed && e.s < playerS) {
          e.passed = true;
          if (Math.abs(e.latX - playerLatX) < 2.3) nearMisses++;
        }
        if (playerS - e.s > TRAFFIC.despawnBehind) despawn(i);
      }

      if (opts.raceActive !== false) {
        const rawDt = opts.rawDt ?? dt;
        updateSplineAIRacers(rawDt, playerS, t, opts.playerType, opts.remotePlayers, track, playerLatX, opts.lapGoal || TRACK.lapDistance);
      }
      return;
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn(playerZ);
      spawnTimer = rand(TRAFFIC.spawnInterval[0], TRAFFIC.spawnInterval[1]);
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      const cxCur = getTrackCenterX(e.z);

      /* ---- AI lalu lintas ambient per tipe ---- */
      if (e.type === 'angkot') {
        if (e.state === 'cruise' && e.willNgetem && e.z <= e.ngetemAt) {
          e.state = 'ngetem';
          e.ngetemTimer = rand(TRAFFIC.ngetem.duration[0], TRAFFIC.ngetem.duration[1]);
          e.targetX = cxCur + LANES[0];
        }
        if (e.state === 'ngetem') {
          e.ngetemTimer -= dt;
          e.speed += (0 - e.speed) * (1 - Math.exp(-6 * dt));
          if (e.ngetemTimer <= 0) { e.state = 'cruise'; e.willNgetem = false; e.targetX = cxCur + LANES[e.lane]; }
        } else {
          e.speed += (e.baseSpeed - e.speed) * (1 - Math.exp(-2 * dt));
          e.targetX = cxCur + LANES[e.lane];
        }
      } else if (e.type === 'ojol') {
        e.speed = e.baseSpeed;
        e.targetX = cxCur + LANES[e.lane] + Math.sin(t * TRAFFIC.ojolWeave.freq + e.phase) * TRAFFIC.ojolWeave.amp;
      } else if (e.type === 'bemo') {
        e.speed = e.baseSpeed;
        e.targetX = cxCur + LANES[e.lane] + Math.sin(t * 0.6 + e.phase) * 0.25;
      } else {
        e.speed = e.baseSpeed;
        e.targetX = cxCur + LANES[e.lane];
      }

      e.z -= e.speed * dt;
      e.s = -e.z;
      const cxNext = getTrackCenterX(e.z);
      e.x += cxNext - cxCur;
      e.targetX += cxNext - cxCur;

      const surf = getTrackSurfaceAt(e.x, e.z);
      if (surf.type === 'loop' || surf.inGap) {
        despawn(i);
        continue;
      }
      const limMin = surf.safeCenterX - Math.max(0.6, surf.safeHalfW - 0.9);
      const limMax = surf.safeCenterX + Math.max(0.6, surf.safeHalfW - 0.9);
      const clampedTarget = THREE.MathUtils.clamp(e.targetX, limMin, limMax);

      e.x += (clampedTarget - e.x) * (1 - Math.exp(-5 * dt));
      e.x = THREE.MathUtils.clamp(e.x, limMin, limMax);

      const y = surf.groundY;
      const slope = surf.slope;
      e.group.position.set(e.x, y, e.z);
      e.group.rotation.order = 'YXZ';
      e.group.rotation.x = Math.atan(-slope);
      e.group.rotation.y = getTrackYaw(e.z) + (clampedTarget - e.x) * -0.02;
      e.group.rotation.z = getTrackBank(e.z);

      const wr = e.def.wheelRadius || 0.34;
      for (const w of e.group.userData.wheels || []) w.rotation.x -= (e.speed / wr) * dt;

      /* Sein & rem saat ngetem */
      const blink = Math.sin(t * 10) > 0;
      const hazard = e.state === 'ngetem';
      for (const ind of e.group.userData.indicators || []) ind.material.emissiveIntensity = hazard && blink ? 1.8 : 0;
      for (const br of e.group.userData.brakes || []) br.material.emissiveIntensity = hazard ? 1.6 : 0.7;

      /* Near-miss: tersalip ketat tanpa tabrakan */
      if (!e.passed && e.z > playerZ) {
        e.passed = true;
        if (Math.abs(e.x - playerX) < 2.3) nearMisses++;
      }

      if (e.z - playerZ > TRAFFIC.despawnBehind) despawn(i);
    }

    /* Update 3 Pembalap AI kompetitif jika berada di mode balapan */
    if (opts.raceActive !== false) {
      const rawDt = opts.rawDt ?? dt;
      updateAIRacers(rawDt, playerZ, t, opts.playerType, opts.remotePlayers, opts.track, playerX, opts.lapGoal || TRACK.lapDistance);
    }
  }

  /* AABB sederhana player vs lalu lintas */
  function checkCollision(pos, half = { x: 1.0, z: 2.2 }) {
    for (const e of active) {
      if (Math.abs(pos.x - e.x) < half.x + e.halfX &&
          Math.abs(pos.z - e.z) < half.z + e.halfZ &&
          Math.abs(pos.y - e.group.position.y) < 2.6) {
        return e;
      }
    }
    return null;
  }

  const _aiSnapCache = [];
  function getAIRacersSnapshot(out = null) {
    const dst = out || [];
    let count = 0;
    for (let i = 0; i < aiSlots.length; i++) {
      const ai = aiSlots[i];
      if (!ai.active) continue;
      let rec = out ? (_aiSnapCache[count] || (_aiSnapCache[count] = {
        id: '', name: '', type: 'bemo', x: 0, z: 0, s: 0, coins: 0, score: 0, finishTime: 0, slotColor: '', isAI: true,
      })) : {};
      rec.id = ai.id;
      rec.name = ai.name;
      rec.type = ai.type;
      rec.x = ai.x;
      rec.z = ai.z;
      rec.s = ai.s;
      rec.coins = Math.round(ai.coins);
      rec.score = Math.round(ai.score);
      rec.finishTime = ai.finishTime || 0;
      rec.slotColor = ai.slotColor;
      rec.isAI = true;
      dst[count++] = rec;
    }
    dst.length = count;
    return dst;
  }

  function consumeNearMisses() { const n = nearMisses; nearMisses = 0; return n; }

  function reset(playerType = 'angkot') {
    for (let i = active.length - 1; i >= 0; i--) despawn(i);
    spawnTimer = 0.6; nearMisses = 0;
    for (const rig of Object.values(aiRigs)) rig.root.visible = false;
    for (const slot of aiSlots) slot.ribbon.setVisible(false);
    assignAIRacers(playerType, true);
  }

  function dispose() {
    for (let i = active.length - 1; i >= 0; i--) despawn(i);
    for (const g of allGroups) scene.remove(g);
    for (const type of VEHICLE_TYPES) freeByType[type].length = 0;
    for (const slot of aiSlots) slot.ribbon.dispose();
    for (const rig of Object.values(aiRigs)) {
      scene.remove(rig.root);
      rig.plate?.userData?.tex?.dispose();
      rig.plate?.userData?.mat?.dispose();
    }
  }

  return {
    update, checkCollision, consumeNearMisses, getAIRacersSnapshot, reset, dispose,
    get activeCount() { return active.length; },
  };
}
