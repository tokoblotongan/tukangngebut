/* =====================================================================
   trafficManager.js — Spawner & AI lalu lintas Nusantara dengan pooling.
   Perilaku: Angkot NGETEM (menepi, berhenti, sein berkedip), Bemo
   pelan bergoyang, L300 stabil, Ojol ngebut menyalip (weave).
   Semua instance di-preload saat init (tanpa kloning runtime) agar
   referensi roda/lampu per-instance tetap valid.
   API: update(dt, playerZ, t, playerX), checkCollision(pos, half),
        reset(), dispose(), activeCount, consumeNearMisses().
   ===================================================================== */
import * as THREE from 'three';
import { TRAFFIC, PHYSICS, TRACK, VEHICLE_TYPES, getVehicleDef } from '../config/gameConfig.js';
import { loadVehicle } from './assetFactory.js';
import { getTrackHeight, getTrackSlope } from '../world/trackGenerator.js';

const rand = (a, b) => a + Math.random() * (b - a);
const LANE_W = TRACK.width / TRACK.lanes;
const LANES = [-LANE_W, 0, LANE_W];
const WEIGHTS = [['angkot', 0.3], ['bemo', 0.2], ['l300', 0.25], ['ojol', 0.25]];

function pickType() {
  let r = Math.random(), acc = 0;
  for (const [t, w] of WEIGHTS) { acc += w; if (r <= acc) return t; }
  return 'angkot';
}

export async function createTrafficManager(scene) {
  /* Preload pool tetap: 4 instance per tipe (16 ≥ poolSize 14) */
  const freeByType = {};
  const allGroups = [];
  for (const type of VEHICLE_TYPES) {
    freeByType[type] = [];
    for (let k = 0; k < 4; k++) {
      const g = await loadVehicle(type);
      g.visible = false;
      scene.add(g);
      freeByType[type].push(g);
      allGroups.push(g);
    }
  }

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
    /* Hindari tumpang tindih dengan yang sudah aktif */
    for (const e of active) if (Math.abs(e.z - z) < 9 && e.lane === lane) { freeByType[type].push(group); return; }

    const baseSpeed = PHYSICS.baseSpeed * TRAFFIC.speedFactor[type];
    const e = {
      group, type, def, lane,
      x: LANES[lane], targetX: LANES[lane], z,
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
    group.position.set(e.x, getTrackHeight(z), e.z);
    active.push(e);
  }

  function despawn(idx) {
    const e = active[idx];
    e.group.visible = false;
    scene.remove(e.group);
    freeByType[e.type].push(e.group);
    active.splice(idx, 1);
  }

  function update(dt, playerZ, t = 0, playerX = 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawn(playerZ); spawnTimer = rand(TRAFFIC.spawnInterval[0], TRAFFIC.spawnInterval[1]); }

    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];

      /* ---- AI per tipe ---- */
      if (e.type === 'angkot') {
        if (e.state === 'cruise' && e.willNgetem && e.z <= e.ngetemAt) {
          e.state = 'ngetem';
          e.ngetemTimer = rand(TRAFFIC.ngetem.duration[0], TRAFFIC.ngetem.duration[1]);
          e.targetX = LANES[0];
        }
        if (e.state === 'ngetem') {
          e.ngetemTimer -= dt;
          e.speed += (0 - e.speed) * (1 - Math.exp(-6 * dt));
          if (e.ngetemTimer <= 0) { e.state = 'cruise'; e.willNgetem = false; e.targetX = LANES[e.lane]; }
        } else {
          e.speed += (e.baseSpeed - e.speed) * (1 - Math.exp(-2 * dt));
        }
      } else if (e.type === 'ojol') {
        e.speed = e.baseSpeed;
        e.targetX = LANES[e.lane] + Math.sin(t * TRAFFIC.ojolWeave.freq + e.phase) * TRAFFIC.ojolWeave.amp;
      } else if (e.type === 'bemo') {
        e.speed = e.baseSpeed;
        e.targetX = LANES[e.lane] + Math.sin(t * 0.6 + e.phase) * 0.25;
      } else {
        e.speed = e.baseSpeed;
        e.targetX = LANES[e.lane];
      }

      e.x += (e.targetX - e.x) * (1 - Math.exp(-4 * dt));
      e.x = THREE.MathUtils.clamp(e.x, -PHYSICS.steer.maxX, PHYSICS.steer.maxX);
      e.z -= e.speed * dt;

      const y = getTrackHeight(e.z);
      const slope = getTrackSlope(e.z);
      e.group.position.set(e.x, y, e.z);
      e.group.rotation.order = 'YXZ';
      e.group.rotation.x = Math.atan(-slope);
      e.group.rotation.y = (e.targetX - e.x) * -0.02;

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

  function consumeNearMisses() { const n = nearMisses; nearMisses = 0; return n; }

  function reset() {
    for (let i = active.length - 1; i >= 0; i--) despawn(i);
    spawnTimer = 0.6; nearMisses = 0;
  }

  function dispose() {
    reset();
    for (const g of allGroups) scene.remove(g);
    for (const type of VEHICLE_TYPES) freeByType[type].length = 0;
  }

  return {
    update, checkCollision, consumeNearMisses, reset, dispose,
    get activeCount() { return active.length; },
  };
}
