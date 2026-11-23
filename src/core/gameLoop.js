/* =====================================================================
   gameLoop.js — Satu loop render (renderer.setAnimationLoop), state
   machine MENU / PLAYING / PAUSED / GAMEOVER, dual-arena switching
   (Sirkuit Kota Salatiga vs Nusantara Skyway), intro skyline sweep,
   misi garis finis 1.500 m + kembang api perayaan 3D + Podium 1st-4th,
   proyeksi penghitung koin di atas kendaraan player, data minimap, &
   pita neon P1-P4.
   ===================================================================== */
import * as THREE from 'three';
import { STATES, PHYSICS, SCORE, TRACK, SLOT_COLORS, getVehicleDef } from '../config/gameConfig.js';
import { createNeonRibbonTrail } from '../entities/assetFactory.js';
import {
  setActiveArena, getActiveArenaId, getTrackHeight, getTrackCenterX,
  getTrackSurfaceAt, getTrackPreviewPoints,
} from '../world/activeTrack.js';

const BEST_KEY = 'jg_best';
const MENU_Z = -72;
const DIFF = {
  santai: { hearts: 5, mult: 0.8, pressure: 0.75 },
  normal: { hearts: 3, mult: 1.0, pressure: 1.0 },
  ngebut: { hearts: 2, mult: 1.35, pressure: 1.3 },
};
const FRUIT_LABELS = {
  strawberry: '🍓 Stroberi',
  melon: '🍈 Melon',
  banana: '🍌 Pisang',
  orange: '🍊 Jeruk',
};

export function createGameLoop({
  ctx, track, salatigaTrack = null, skywayTrack = null,
  salatigaRoot = null, skywayRoot = null,
  landmarks, player, traffic, hud, network,
  difficulty = 'normal', arena = 'salatiga',
}) {
  const clock = new THREE.Clock();
  const keys = new Set();
  let state = STATES.MENU;
  let diff = DIFF[difficulty] ? difficulty : 'normal';
  let currentArenaId = setActiveArena(arena);
  let activeTrack = (currentArenaId === 'skyway' && skywayTrack) ? skywayTrack : (salatigaTrack || track);
  let hearts = DIFF[diff].hearts;
  let score = 0, distance = 0, best = loadBest();
  let coins = 0, coinStreak = 0, coinStreakTimer = 0;
  let combo = 1, comboTimer = 0, rollsTotal = 0;
  let nextCheckpoint = 500, invuln = 0, elapsed = 0, raceTimer = 0;
  let introSweepTimer = 0;
  const INTRO_SWEEP_DUR = 1.35;
  const LAP_DIST = TRACK.lapDistance || 1500;
  let lapGoal = LAP_DIST, lapNumber = 1, lapPaused = false;
  let finishing = false, finishTimer = 0, fireworkCooldown = 0, playerFinishTime = 0;
  let running = false;
  let menuAngle = 0.6;
  let smoothAimOffsetX = 0;
  let smoothSpeedRatio = 0;
  const camTarget = new THREE.Vector3();
  const _tailOff = new THREE.Vector3();
  const _overheadProj = { x: 0, y: 0, visible: false };
  const _minimapPts = [];
  const _minimapRacers = [];

  const playerRibbon = createNeonRibbonTrail(ctx.scene, SLOT_COLORS[0], 0.56);
  playerRibbon.setVisible(false);

  function loadBest() { const v = parseFloat(localStorage.getItem(BEST_KEY)); return Number.isFinite(v) ? v : 0; }
  function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(Math.round(v))); } catch {} }

  function applyArenaVisibility(id) {
    currentArenaId = setActiveArena(id);
    activeTrack = (currentArenaId === 'skyway' && skywayTrack) ? skywayTrack : (salatigaTrack || track);
    if (salatigaRoot) salatigaRoot.visible = (currentArenaId === 'salatiga');
    if (skywayRoot) skywayRoot.visible = (currentArenaId === 'skyway');
    ctx.setAtmosphere?.(currentArenaId);
  }
  applyArenaVisibility(currentArenaId);

  function setArena(id) {
    applyArenaVisibility(id);
    const previewZ = state === STATES.MENU ? (currentArenaId === 'skyway' ? -18 : MENU_Z) : player.getState().pos.z;
    activeTrack.updateTrack(previewZ, elapsed);
    if (currentArenaId === 'salatiga') landmarks.update(previewZ);
    if (state === STATES.MENU) {
      const y = getTrackHeight(previewZ);
      const cx = getTrackCenterX(previewZ);
      if (player.group) player.group.position.set(cx, y + 0.06, previewZ);
      ctx.setAnchor(cx, y, previewZ);
    }
  }

  function buildStandings(ps, forPodium = false) {
    const list = [];
    const pName = network?.identity?.name || 'Kamu';
    list.push({
      id: network?.identity?.id || 'player',
      name: pName,
      type: ps.type,
      x: ps.pos.x,
      z: ps.pos.z,
      coins: Math.round(coins),
      score: Math.round(score),
      finishTime: playerFinishTime || 0,
      slotColor: SLOT_COLORS[0],
      isPlayer: true,
    });
    for (const p of network?.getRemotePlayers?.() || []) {
      if (p.state === 'PLAYING' || p.state === 'PAUSED') {
        list.push({
          id: p.id,
          name: p.name || 'Juragan',
          type: p.vehicleType || 'angkot',
          x: p.x || 0,
          z: p.z || 0,
          coins: Math.round(p.coins || 0),
          score: Math.round(p.score || 0),
          finishTime: p.finishTime || 0,
          slotColor: SLOT_COLORS[1],
          isRemote: true,
        });
      }
    }
    for (const ai of traffic.getAIRacersSnapshot?.() || []) {
      list.push(ai);
    }
    if (forPodium) {
      list.sort((a, b) => {
        const af = a.finishTime > 0 ? 0 : 1;
        const bf = b.finishTime > 0 ? 0 : 1;
        if (af !== bf) return af - bf;
        if (a.finishTime > 0 && b.finishTime > 0) {
          const dtFin = a.finishTime - b.finishTime;
          if (Math.abs(dtFin) > 0.01) return dtFin;
        }
        return ((b.coins || 0) - (a.coins || 0)) || (b.score - a.score) || (a.z - b.z);
      });
    } else {
      list.sort((a, b) => (a.z - b.z) || ((b.coins || 0) - (a.coins || 0)) || (b.score - a.score));
    }
    return list.slice(0, 4);
  }

  function spawnVictoryBurst(px, py, pz) {
    const ox = (Math.random() - 0.5) * 14;
    const oy = 4.5 + Math.random() * 5.0;
    const oz = (Math.random() - 0.5) * 8 - 8;
    ctx.spawnFireworks?.(px + ox, py + oy, pz + oz);
  }

  /* ---------------- Input ---------------- */
  const onKeyDown = (e) => {
    const t = /** @type {HTMLElement | null} */ (e.target);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const c = e.code;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(c)) e.preventDefault();
    keys.add(c);
    if (c === 'KeyM') hud.toggleAudio();
    else if (c === 'KeyH') {
      if (state === STATES.PLAYING) hud.triggerTelolet?.();
    } else if (c === 'KeyP' || c === 'Escape') {
      if (state === STATES.PLAYING && !finishing) pause();
      else if (state === STATES.PAUSED && !lapPaused) resume();
    } else if (c === 'KeyR') {
      if (state !== STATES.MENU) start();
    } else if (c === 'Enter' || c === 'Space') {
      if (state === STATES.MENU) start();
      else if (state === STATES.GAMEOVER) start();
      else if (state === STATES.PAUSED) {
        if (lapPaused) continueLap();
        else resume();
      }
    }
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onVisibility = () => { if (document.hidden && state === STATES.PLAYING && !finishing) pause(); };

  function readInput() {
    if (finishing) return { left: false, right: false };
    return {
      left: keys.has('ArrowLeft') || keys.has('KeyA') || hud.input.left,
      right: keys.has('ArrowRight') || keys.has('KeyD') || hud.input.right,
    };
  }

  /* ---------------- Transisi state ---------------- */
  function start() {
    const d = DIFF[diff];
    hearts = d.hearts;
    score = 0; distance = 0; coins = 0; coinStreak = 0; coinStreakTimer = 0;
    combo = 1; comboTimer = 0; rollsTotal = 0;
    nextCheckpoint = 500; invuln = 0; raceTimer = 0;
    introSweepTimer = currentArenaId === 'skyway' ? 0.001 : INTRO_SWEEP_DUR;
    lapGoal = LAP_DIST; lapNumber = 1; lapPaused = false;
    finishing = false; finishTimer = 0; fireworkCooldown = 0; playerFinishTime = 0;
    smoothAimOffsetX = 0; smoothSpeedRatio = PHYSICS.baseSpeed / PHYSICS.maxSpeed;
    applyArenaVisibility(currentArenaId);
    player.reset();
    const pType = player.getState().type;
    traffic.reset(pType);
    activeTrack.resetCollectibles?.();
    const pos = player.getState().pos;
    playerRibbon.setBoostMode(false);
    playerRibbon.reset(pos.x, pos.y + 0.34, pos.z + 1.4);
    playerRibbon.setVisible(true);
    activeTrack.updateTrack(pos.z, elapsed);
    if (currentArenaId === 'salatiga') landmarks.update(pos.z);
    ctx.snapCamera(pos);
    ctx.setAnchor(pos.x, pos.y, pos.z);
    hud.hideMenu(); hud.hideGameOver(); hud.setPaused(false);
    hud.setWarnings?.([]); hud.setAirHint?.(false); hud.showHUD();
    hud.sfx.resume();
    state = STATES.PLAYING;
  }

  function pause() {
    if (state !== STATES.PLAYING) return;
    state = STATES.PAUSED;
    hud.setPaused(true);
    hud.sfx.setEngine(false);
  }
  function resume() {
    if (state !== STATES.PAUSED) return;
    lapPaused = false;
    state = STATES.PLAYING;
    hud.setPaused(false);
    hud.hideGameOver();
    hud.showHUD();
    hud.sfx.resume();
    clock.getDelta();
  }
  function continueLap() {
    if (state !== STATES.PAUSED || !lapPaused) return;
    lapPaused = false;
    finishing = false;
    finishTimer = 0;
    playerFinishTime = 0;
    lapGoal += LAP_DIST;
    lapNumber += 1;
    hud.hideGameOver();
    hud.showHUD();
    state = STATES.PLAYING;
    hud.sfx.resume();
    clock.getDelta();
  }
  function toMenu() {
    state = STATES.MENU;
    coins = 0; coinStreak = 0; coinStreakTimer = 0; raceTimer = 0;
    lapGoal = LAP_DIST; lapNumber = 1; lapPaused = false;
    finishing = false; finishTimer = 0; playerFinishTime = 0;
    player.reset();
    traffic.reset(player.getState().type);
    playerRibbon.setVisible(false);
    activeTrack.resetCollectibles?.();
    hud.setWarnings?.([]);
    hud.setAirHint?.(false);
    hud.hideGameOver(); hud.setPaused(false); hud.hideHUD();
    hud.showMenu(best);
    hud.sfx.setEngine(false);
    const previewZ = currentArenaId === 'skyway' ? -18 : MENU_Z;
    activeTrack.updateTrack(previewZ, elapsed);
    if (currentArenaId === 'salatiga') landmarks.update(previewZ);
  }
  function finishLap() {
    lapPaused = true;
    state = STATES.PAUSED;
    const bonus = Math.round(450 * DIFF[diff].mult);
    score += bonus;
    const newRecord = score > best;
    if (newRecord) { best = score; saveBest(best); }
    const podiumStandings = buildStandings(player.getState(), true);
    const rank = Math.max(1, podiumStandings.findIndex((r) => r.isPlayer) + 1);
    hud.sfx.setEngine(false);
    hud.setWarnings?.([]);
    hud.setAirHint?.(false);
    hud.showGameOver({
      score, distance, rolls: rollsTotal, coins, best, newRecord,
      rank, totalRacers: podiumStandings.length, standings: podiumStandings,
      isLapFinish: true, lapNumber, arenaId: currentArenaId,
    });
  }
  function gameOver() {
    state = STATES.GAMEOVER;
    lapPaused = false;
    finishing = false;
    if (player.group) player.group.visible = true;
    const newRecord = score > best;
    if (newRecord) { best = score; saveBest(best); }
    const podiumStandings = buildStandings(player.getState(), true);
    const rank = Math.max(1, podiumStandings.findIndex((r) => r.isPlayer) + 1);
    hud.sfx.setEngine(false);
    hud.sfx.gameover();
    hud.setWarnings?.([]);
    hud.setAirHint?.(false);
    ctx.addShake(0.9);
    hud.showGameOver({
      score, distance, rolls: rollsTotal, coins, best, newRecord,
      rank, totalRacers: podiumStandings.length, standings: podiumStandings,
      isLapFinish: false, lapNumber, arenaId: currentArenaId,
    });
  }

  function onAbyssFall() {
    if (state !== STATES.PLAYING || finishing) return;
    hearts = Math.max(0, hearts - 1);
    invuln = 2.4;
    combo = 1;
    comboTimer = 0;
    ctx.addShake(0.9);
    hud.flashCrash();
  }

  function onAbyssRecover() {
    if (state !== STATES.PLAYING) return;
    invuln = Math.max(invuln, 1.8);
    if (hearts <= 0) {
      gameOver();
    }
  }

  function onLoopComplete() {}
  function addRolls(n) { if (n > 0) rollsTotal += n; }
  function setDifficulty(id) { if (DIFF[id]) { diff = id; if (state === STATES.MENU) hearts = DIFF[id].hearts; } }
  function setVehicleLabel() {}

  /* ---------------- Simulasi PLAYING ---------------- */
  function stepPlaying(dt) {
    const d = DIFF[diff];
    raceTimer += dt;
    if (introSweepTimer < INTRO_SWEEP_DUR) {
      introSweepTimer = Math.min(INTRO_SWEEP_DUR, introSweepTimer + dt);
    }
    const introProgress = introSweepTimer / INTRO_SWEEP_DUR;

    const input = readInput();
    const res = player.updatePlayer(dt, input, activeTrack);
    const pos = res.pos;

    activeTrack.updateTrack(pos.z, elapsed);
    if (currentArenaId === 'salatiga') landmarks.update(pos.z);

    const pressure = d.pressure * (1 + Math.min(0.55, distance / 3500));
    traffic.update(dt * pressure, pos.z, elapsed, pos.x, {
      rawDt: dt,
      playerType: player.getState().type,
      remotePlayers: network.getRemotePlayers(),
      track: activeTrack,
      raceActive: true,
      lapGoal,
    });

    /* Jarak & skor dasar */
    const newDist = Math.max(distance, -pos.z);
    const gained = newDist - distance;
    distance = newDist;
    score += gained * SCORE.distancePerUnit * d.mult;

    /* Rantai stunt */
    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 1; }
    if (res.stuntBonus > 0) {
      score += res.stuntBonus * combo * d.mult;
      combo = Math.min(8, combo + 1);
      comboTimer = SCORE.comboWindow;
    }

    /* Koin, Buah & Permata Pelangi */
    if (coinStreakTimer > 0) {
      coinStreakTimer = Math.max(0, coinStreakTimer - dt);
      if (coinStreakTimer <= 0) coinStreak = 0;
    }
    const pickups = activeTrack.collectNearby?.(pos);
    if (pickups && pickups.length > 0) {
      for (const item of pickups) {
        if (item.kind === 'ring') {
          coins += 5;
          score += Math.round((SCORE.ringBonus || 150) * combo * d.mult);
          coinStreak = Math.min(12, coinStreak + 2);
          coinStreakTimer = 1.6;
          player.triggerBoostSurge?.(2.6, 5);
          ctx.spawnSparkles?.(item.x, item.y, item.z, 'gem');
          hud.sfx.fireRing?.();
          hud.toast?.('🔥 Cincin Api +5 🪙', 'good');
        } else if (item.kind === 'gem') {
          coins += 5;
          score += Math.round(SCORE.gemBonus * combo * d.mult);
          coinStreak = Math.min(12, coinStreak + 2);
          coinStreakTimer = 1.5;
          ctx.spawnSparkles?.(item.x, item.y, item.z, 'gem');
          hud.sfx.gem?.();
          hud.toast?.('💎 Permata +5 🪙', 'good');
        } else if (item.kind === 'fruit') {
          coins += 2;
          score += Math.round((SCORE.fruitBonus || 95) * combo * d.mult);
          coinStreak = Math.min(12, coinStreak + 1);
          coinStreakTimer = 1.4;
          ctx.spawnSparkles?.(item.x, item.y, item.z, item.fruitType || 'orange');
          hud.sfx.fruit?.(coinStreak);
          hud.toast?.(`${FRUIT_LABELS[item.fruitType] || '🍊 Buah'} +2 🪙`, 'good');
        } else {
          coins += 1;
          score += SCORE.coinBonus * combo * d.mult;
          coinStreak = Math.min(12, coinStreak + 1);
          coinStreakTimer = 1.15;
          ctx.spawnSparkles?.(item.x, item.y, item.z, 'coin');
          hud.sfx.coin?.(coinStreak);
        }
      }
    }

    /* Menabrak tong / kerucut mainan */
    if (!res.falling && !res.respawning && !res.inLoop) {
      const smashed = activeTrack.checkPropSmash?.(pos);
      if (smashed && smashed.length > 0) {
        score += Math.round((SCORE.smashBonus || 15) * smashed.length * d.mult);
        player.bounceProp?.();
        ctx.addShake(0.14);
        hud.sfx.smashProp?.();
      }
    }

    /* Nyaris tersalip */
    const nm = traffic.consumeNearMisses();
    if (nm > 0) {
      score += nm * SCORE.nearMissBonus * d.mult;
      hud.sfx.nearMiss();
    }

    /* Checkpoint 500 m */
    if (distance >= nextCheckpoint && distance < lapGoal) {
      score += Math.round(200 * d.mult);
      hud.sfx.milestone();
      nextCheckpoint += 500;
    }

    /* Garis Finis 1.500 m */
    if (!finishing && distance >= lapGoal) {
      finishing = true;
      finishTimer = 0;
      fireworkCooldown = 0;
      playerFinishTime = raceTimer;
      hud.sfx.victory?.();
      ctx.spawnFireworks?.(pos.x - 5.5, pos.y + 6.5, pos.z - 6);
      ctx.spawnFireworks?.(pos.x + 5.5, pos.y + 6.5, pos.z - 6);
      ctx.spawnFireworks?.(pos.x, pos.y + 8.5, pos.z - 10);
    }
    if (finishing) {
      finishTimer += dt;
      fireworkCooldown -= dt;
      if (fireworkCooldown <= 0) {
        fireworkCooldown = 0.24;
        spawnVictoryBurst(pos.x, pos.y, pos.z);
      }
      if (finishTimer >= 1.25) {
        finishing = false;
        finishLap();
        return;
      }
    }

    /* Tabrakan lalu lintas & bahaya trek (tengkorak / bola energi) */
    invuln = Math.max(0, invuln - dt);
    if (player.group) {
      player.group.visible = invuln <= 0 || Math.sin(elapsed * 28) > -0.35;
    }
    if (!finishing && invuln <= 0 && !res.airborne && !res.inLoop && !res.falling && !res.respawning) {
      const def = getVehicleDef(player.getState().type);
      const hitTraffic = traffic.checkCollision(pos, { x: def.targetSize.x * 0.4, z: def.targetSize.z * 0.4 });
      const hitHazard = hitTraffic ? null : activeTrack.checkHazardCollision?.(pos, { x: def.targetSize.x * 0.4, z: def.targetSize.z * 0.4 });
      if ((hitTraffic || hitHazard) && player.hitObstacle()) {
        hearts--; invuln = 1.5; combo = 1; comboTimer = 0;
        ctx.addShake(0.85);
        hud.flashCrash(); hud.sfx.crash();
        if (hearts <= 0) { gameOver(); return; }
      }
    }

    /* Pita neon P1 */
    if (res.falling) {
      playerRibbon.setVisible(false);
    } else {
      playerRibbon.setVisible(true);
      playerRibbon.setBoostMode(!!res.inBoost);
      _tailOff.set(0, 0.34, 1.32);
      if (player.group) _tailOff.applyQuaternion(player.group.quaternion);
      const rv = res.rightVec;
      playerRibbon.update(
        pos.x + _tailOff.x,
        pos.y + _tailOff.y,
        pos.z + _tailOff.z,
        rv.x, rv.y, rv.z
      );
    }

    /* Kamera chase ramah mata dengan damping eksponensial halus */
    const surf = getTrackSurfaceAt(pos.x, pos.z);
    const camPosFocus = res.camAnchor || pos;
    const rawAimOffsetX = (!res.inLoop && !res.falling)
      ? (getTrackCenterX(camPosFocus.z - 12) - camPosFocus.x) * 0.52
      : 0;
    const rawSpeedRatio = res.speed / PHYSICS.maxSpeed;
    smoothAimOffsetX += (rawAimOffsetX - smoothAimOffsetX) * (1 - Math.exp(-7.2 * dt));
    smoothSpeedRatio += (rawSpeedRatio - smoothSpeedRatio) * (1 - Math.exp(-5.8 * dt));
    ctx.setAnchor(pos.x, pos.y, pos.z);
    ctx.followCamera(camPosFocus, dt, {
      speedRatio: smoothSpeedRatio,
      turbo: res.turbo,
      inLoop: res.inLoop,
      loopCenterZ: res.loopCenterZ,
      falling: res.falling,
      aimOffsetX: smoothAimOffsetX,
      arenaId: currentArenaId,
      introProgress,
    });
    ctx.updateContactShadow(
      pos.x, surf.groundY, pos.z,
      Math.max(0, pos.y - surf.groundY),
      3.4,
      !res.inLoop && !res.falling && surf.onTrack
    );

    const standings = buildStandings(player.getState(), false);
    const rank = Math.max(1, standings.findIndex((r) => r.isPlayer) + 1);
    const lapStart = lapGoal - LAP_DIST;
    const racerMarkers = standings.map((r) => ({
      id: r.id,
      color: r.slotColor || SLOT_COLORS[0],
      isPlayer: !!r.isPlayer,
      frac: THREE.MathUtils.clamp(((-r.z) - lapStart) / LAP_DIST, 0, 1),
    }));

    getTrackPreviewPoints(pos.z + 24, pos.z - 150, 26, _minimapPts);
    _minimapRacers.length = 0;
    for (let i = 0; i < standings.length; i++) {
      const r = standings[i];
      _minimapRacers.push({
        x: r.x ?? 0,
        z: r.z ?? 0,
        color: r.slotColor || SLOT_COLORS[0],
        isPlayer: !!r.isPlayer,
      });
    }

    const pDef = getVehicleDef(player.getState().type);
    ctx.projectToScreen?.(
      pos.x,
      pos.y + (pDef.targetSize?.y || 2.8) + 0.92,
      pos.z,
      _overheadProj
    );

    hud.updateHUD({
      score, distance, lapGoal, lapNumber, raceTime: raceTimer, arenaId: currentArenaId,
      coins, hearts, maxHearts: d.hearts, combo,
      speed: res.speed, speedRatio: res.speed / (PHYSICS.maxSpeed * PHYSICS.turbo.multiplier),
      turbo: player.getState().turboTimer / PHYSICS.turbo.duration,
      nextCheckpoint, invuln, rank, totalRacers: standings.length,
      standings, racerMarkers,
      minimapPts: _minimapPts,
      minimapRacers: _minimapRacers,
      playerPos: pos,
      overhead: {
        x: _overheadProj.x,
        y: _overheadProj.y,
        visible: _overheadProj.visible && !res.falling,
        coins,
        isFirst: rank === 1,
      },
    });
    hud.sfx.setEngine(true, res.speed / PHYSICS.maxSpeed, res.turbo);
  }

  /* ---------------- Kamera sinematik non-playing ---------------- */
  function stepIdle(dt, spotZ, radius, elev, spin) {
    menuAngle += dt * spin;
    const y = getTrackHeight(spotZ);
    const cx = getTrackCenterX(spotZ);
    camTarget.set(cx, y + 1.9, spotZ);
    ctx.camera.position.set(
      cx + Math.sin(menuAngle) * radius,
      y + 1.9 + Math.sin(elev) * radius,
      spotZ + Math.cos(menuAngle) * radius
    );
    ctx.camera.up.set(0, 1, 0);
    ctx.camera.lookAt(camTarget);
    ctx.setAnchor(cx, y, spotZ);
    return y;
  }

  /* ---------------- Loop tunggal ---------------- */
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    if (state === STATES.PLAYING) {
      stepPlaying(dt);
    } else if (state === STATES.MENU) {
      const previewZ = currentArenaId === 'skyway' ? -18 : MENU_Z;
      const g = player.group;
      const y = stepIdle(dt, previewZ, currentArenaId === 'skyway' ? 12.2 : 10.2, 0.40, 0.16);
      if (g) {
        g.position.set(0, y + 0.06 + Math.sin(elapsed * 1.6) * 0.05, previewZ);
        g.rotation.set(0, elapsed * 0.32, 0);
        for (const w of g.userData.wheels || []) w.rotation.x -= dt * 2.2;
      }
      activeTrack.updateTrack(previewZ, elapsed);
      if (currentArenaId === 'salatiga') landmarks.update(previewZ);
      ctx.updateContactShadow(0, y, previewZ, 0.1, 3.4);
      hud.sfx.setEngine(false);
    } else if (state === STATES.PAUSED) {
      const pos = player.getState().pos;
      ctx.setAnchor(pos.x, pos.y, pos.z);
      hud.sfx.setEngine(false);
      if (lapPaused) {
        fireworkCooldown -= dt;
        if (fireworkCooldown <= 0) {
          fireworkCooldown = 0.46;
          spawnVictoryBurst(pos.x, pos.y + 1.0, pos.z);
        }
      }
    } else if (state === STATES.GAMEOVER) {
      const pos = player.getState().pos;
      stepIdle(dt, pos.z, 13.5, 0.5, 0.1);
      ctx.updateContactShadow(pos.x, getTrackHeight(pos.z), pos.z, 0, 3.4);
      hud.sfx.setEngine(false);
    }

    /* Jaringan (Supabase Realtime / Solo fallback) */
    const ps = player.getState();
    network.syncLocalState({
      vehicleType: ps.type,
      vehicle: ps.type,
      x: ps.pos.x,
      y: ps.pos.y,
      z: ps.pos.z,
      rollAngle: ps.rollAngle,
      speed: ps.speed,
      score,
      coins,
      turbo: ps.turboTimer > 0,
      state,
    });
    network.update(dt);

    ctx.update(dt, elapsed);
    ctx.render();
  }

  function init() {
    if (running) return;
    running = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    const previewZ = currentArenaId === 'skyway' ? -18 : MENU_Z;
    activeTrack.updateTrack(previewZ, 0);
    if (currentArenaId === 'salatiga') landmarks.update(previewZ);
    hud.showMenu(best);
    hud.setNetworkStatus(network.status, network.room, network.onlineCount);
    clock.getDelta();
    ctx.renderer.setAnimationLoop(frame);
  }

  function dispose() {
    running = false;
    ctx.renderer.setAnimationLoop(null);
    playerRibbon.dispose();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return {
    init, start, pause, resume, continueLap, toMenu, dispose,
    setDifficulty, setArena, setVehicleLabel, addRolls,
    onAbyssFall, onAbyssRecover, onLoopComplete,
    get state() { return state; },
    get arena() { return currentArenaId; },
    get best() { return best; },
    get stats() { return { score, distance, coins, hearts, combo, rollsTotal, difficulty: diff, arena: currentArenaId }; },
  };
}
