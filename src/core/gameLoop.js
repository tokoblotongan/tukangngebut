/* =====================================================================
   gameLoop.js — Satu loop render (renderer.setAnimationLoop), state
   machine MENU / PLAYING / PAUSED / GAMEOVER, dt clamp, skor & jarak,
   nyawa, combo rantai stunt, checkpoint 500 m, tabrakan lalu lintas,
   pita neon P1-P4, klasemen langsung 4 pembalap, & pemulihan jurang.
   ===================================================================== */
import * as THREE from 'three';
import { STATES, PHYSICS, SCORE, SLOT_COLORS, getVehicleDef } from '../config/gameConfig.js';
import { createNeonRibbonTrail } from '../entities/assetFactory.js';
import { getTrackHeight, getTrackSurfaceAt } from '../world/trackGenerator.js';

const BEST_KEY = 'jg_best';
const MENU_Z = -72; // spot etalase: Pasar Raya II tepat di depan
const DIFF = {
  santai: { hearts: 5, mult: 0.8, pressure: 0.75 },
  normal: { hearts: 3, mult: 1.0, pressure: 1.0 },
  ngebut: { hearts: 2, mult: 1.35, pressure: 1.3 },
};

export function createGameLoop({ ctx, track, landmarks, player, traffic, hud, network, difficulty = 'normal' }) {
  const clock = new THREE.Clock();
  const keys = new Set();
  let state = STATES.MENU;
  let diff = DIFF[difficulty] ? difficulty : 'normal';
  let hearts = DIFF[diff].hearts;
  let score = 0, distance = 0, best = loadBest();
  let coins = 0, coinStreak = 0, coinStreakTimer = 0;
  let combo = 1, comboTimer = 0, rollsTotal = 0;
  let nextCheckpoint = 500, invuln = 0, elapsed = 0;
  let running = false, airHintShown = false, firstRun = true;
  let menuAngle = 0.6;
  const camTarget = new THREE.Vector3();
  const _tailOff = new THREE.Vector3();

  const playerRibbon = createNeonRibbonTrail(ctx.scene, SLOT_COLORS[0], 0.56);
  playerRibbon.setVisible(false);

  function loadBest() { const v = parseFloat(localStorage.getItem(BEST_KEY)); return Number.isFinite(v) ? v : 0; }
  function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(Math.round(v))); } catch {} }

  function buildStandings(ps) {
    const list = [];
    const pName = network?.identity?.name || 'Kamu';
    list.push({
      id: network?.identity?.id || 'player',
      name: pName,
      type: ps.type,
      z: ps.pos.z,
      score: Math.round(score),
      slotColor: SLOT_COLORS[0],
      isPlayer: true,
    });
    for (const p of network?.getRemotePlayers?.() || []) {
      if (p.state === 'PLAYING' || p.state === 'PAUSED') {
        list.push({
          id: p.id,
          name: p.name || 'Juragan',
          type: p.vehicleType || 'angkot',
          z: p.z || 0,
          score: Math.round(p.score || 0),
          slotColor: SLOT_COLORS[1],
          isRemote: true,
        });
      }
    }
    for (const ai of traffic.getAIRacersSnapshot?.() || []) {
      list.push(ai);
    }
    list.sort((a, b) => (a.z - b.z) || (b.score - a.score));
    return list.slice(0, 4);
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
      if (state === STATES.PLAYING) pause();
      else if (state === STATES.PAUSED) resume();
    } else if (c === 'KeyR') {
      if (state !== STATES.MENU) start();
    } else if (c === 'Enter' || c === 'Space') {
      if (state === STATES.MENU) start();
      else if (state === STATES.GAMEOVER) start();
      else if (state === STATES.PAUSED) resume();
    }
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onVisibility = () => { if (document.hidden && state === STATES.PLAYING) pause(); };

  function readInput() {
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
    nextCheckpoint = 500; invuln = 0; airHintShown = false;
    player.reset();
    const pType = player.getState().type;
    traffic.reset(pType);
    track.resetCollectibles?.();
    const pos = player.getState().pos;
    playerRibbon.reset(pos.x, pos.y + 0.34, pos.z + 1.4);
    playerRibbon.setVisible(true);
    track.updateTrack(pos.z, elapsed);
    landmarks.update(pos.z);
    ctx.snapCamera(pos);
    ctx.setAnchor(pos.x, pos.y, pos.z);
    hud.hideMenu(); hud.hideGameOver(); hud.setPaused(false); hud.showHUD();
    hud.sfx.resume();
    state = STATES.PLAYING;
    if (firstRun) {
      firstRun = false;
      hud.toast('Hajar ramp & loop 360°, tahan ←/→ di udara! 🌀', 'good');
    }
    hud.toast(`${getVehicleDef(pType).label} meluncur! 🏁`, 'good');
  }

  function pause() {
    if (state !== STATES.PLAYING) return;
    state = STATES.PAUSED;
    hud.setPaused(true);
    hud.sfx.setEngine(false);
  }
  function resume() {
    if (state !== STATES.PAUSED) return;
    state = STATES.PLAYING;
    hud.setPaused(false);
    hud.sfx.resume();
    clock.getDelta();
  }
  function toMenu() {
    state = STATES.MENU;
    coins = 0; coinStreak = 0; coinStreakTimer = 0;
    player.reset();
    traffic.reset(player.getState().type);
    playerRibbon.setVisible(false);
    track.resetCollectibles?.();
    hud.hideGameOver(); hud.setPaused(false); hud.hideHUD();
    hud.showMenu(best);
    hud.sfx.setEngine(false);
    track.updateTrack(MENU_Z, elapsed);
    landmarks.update(MENU_Z);
  }
  function gameOver() {
    state = STATES.GAMEOVER;
    if (player.group) player.group.visible = true;
    const newRecord = score > best;
    if (newRecord) { best = score; saveBest(best); }
    const standings = buildStandings(player.getState());
    const rank = Math.max(1, standings.findIndex((r) => r.isPlayer) + 1);
    hud.sfx.setEngine(false);
    hud.sfx.gameover();
    ctx.addShake(0.9);
    hud.showGameOver({
      score, distance, rolls: rollsTotal, coins, best, newRecord,
      rank, totalRacers: standings.length, standings,
    });
  }

  function onAbyssFall(kind) {
    if (state !== STATES.PLAYING) return;
    hearts = Math.max(0, hearts - 1);
    invuln = 2.4;
    combo = 1;
    comboTimer = 0;
    ctx.addShake(0.9);
    hud.flashCrash();
    const label = kind === 'ramp' ? 'Terjun ke jurang lompatan!' : 'Keluar jalur melayang!';
    hud.toast(hearts > 0 ? `${label} Sisa ${hearts} nyawa 💥` : `${label} Nyawa habis! 💥`, 'bad');
  }

  function onAbyssRecover() {
    if (state !== STATES.PLAYING) return;
    invuln = Math.max(invuln, 1.8);
    if (hearts <= 0) {
      gameOver();
      return;
    }
    hud.toast('Kembali ke tengah trek! Gas terus! 🏁', 'warn');
  }

  function onLoopComplete() {
    if (state !== STATES.PLAYING) return;
    hud.showStunt('LOOP 360°!', SCORE.loopBonus);
    hud.toast('Putaran 360° Sempurna! +300 TURBO 🔥', 'good');
  }

  function addRolls(n) { if (n > 0) rollsTotal += n; }
  function setDifficulty(id) { if (DIFF[id]) { diff = id; if (state === STATES.MENU) hearts = DIFF[id].hearts; } }
  function setVehicleLabel() { /* label dibaca langsung dari player state */ }

  /* ---------------- Simulasi PLAYING ---------------- */
  function stepPlaying(dt) {
    const d = DIFF[diff];
    const input = readInput();
    const res = player.updatePlayer(dt, input, track);
    const pos = res.pos;

    track.updateTrack(pos.z, elapsed);
    landmarks.update(pos.z);

    const pressure = d.pressure * (1 + Math.min(0.55, distance / 3500));
    traffic.update(dt * pressure, pos.z, elapsed, pos.x, {
      rawDt: dt,
      playerType: player.getState().type,
      remotePlayers: network.getRemotePlayers(),
      track,
      raceActive: true,
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
    const pickups = track.collectNearby?.(pos);
    if (pickups && pickups.length > 0) {
      const FRUIT_LABELS = {
        strawberry: '🍓 Stroberi Segar!',
        melon: '🍉 Semangka Manis!',
        banana: '🍌 Pisang Ngebut!',
        orange: '🍊 Jeruk Segar!',
      };
      for (const item of pickups) {
        if (item.kind === 'gem') {
          coins += 5;
          const pts = Math.round(SCORE.gemBonus * combo * d.mult);
          score += pts;
          coinStreak = Math.min(12, coinStreak + 2);
          coinStreakTimer = 1.5;
          ctx.spawnSparkles?.(item.x, item.y, item.z, 'gem');
          hud.sfx.gem?.();
          hud.toast(`Permata Pelangi! +5 Koin • +${pts} 💎`, 'good');
        } else if (item.kind === 'fruit') {
          coins += 2;
          const pts = Math.round((SCORE.fruitBonus || 95) * combo * d.mult);
          score += pts;
          coinStreak = Math.min(12, coinStreak + 1);
          coinStreakTimer = 1.4;
          ctx.spawnSparkles?.(item.x, item.y, item.z, item.fruitType || 'orange');
          hud.sfx.fruit?.(coinStreak);
          const lbl = FRUIT_LABELS[item.fruitType] || '🍎 Buah Segar!';
          hud.toast(`${lbl} +2 Koin • +${pts}`, 'good');
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

    /* Nyaris tersalip */
    const nm = traffic.consumeNearMisses();
    if (nm > 0) {
      score += nm * SCORE.nearMissBonus * d.mult;
      hud.sfx.nearMiss();
      hud.toast(`Nyaris! +${Math.round(nm * SCORE.nearMissBonus * d.mult)} 💨`, 'good');
    }

    /* Checkpoint */
    if (distance >= nextCheckpoint) {
      const bonus = Math.round(200 * d.mult);
      score += bonus;
      hud.sfx.milestone();
      hud.toast(`Checkpoint ${nextCheckpoint} m! +${bonus} 🎯`, 'good');
      nextCheckpoint += 500;
    }

    /* Tabrakan */
    invuln = Math.max(0, invuln - dt);
    if (player.group) {
      player.group.visible = invuln <= 0 || Math.sin(elapsed * 28) > -0.35;
    }
    if (invuln <= 0 && !res.airborne && !res.inLoop && !res.falling && !res.respawning) {
      const def = getVehicleDef(player.getState().type);
      const hit = traffic.checkCollision(pos, { x: def.targetSize.x * 0.4, z: def.targetSize.z * 0.4 });
      if (hit && player.hitObstacle()) {
        hearts--; invuln = 1.5; combo = 1; comboTimer = 0;
        ctx.addShake(0.85);
        hud.flashCrash(); hud.sfx.crash();
        if (hearts > 0) hud.toast(`Aduh! Sisa ${hearts} nyawa 💥`, 'bad');
        if (hearts <= 0) { gameOver(); return; }
      }
    }

    /* Pita neon P1 */
    if (res.falling) {
      playerRibbon.setVisible(false);
    } else {
      playerRibbon.setVisible(true);
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

    /* Petunjuk udara sekali per lompatan pertama */
    if (res.airborne && !res.falling && !res.respawning && !airHintShown) { airHintShown = true; }
    hud.setAirHint(res.airborne && !res.falling && !res.respawning && Math.abs(res.rollAngle) < 0.4);

    /* Kamera & atmosphere */
    const surf = getTrackSurfaceAt(pos.x, pos.z);
    ctx.setAnchor(pos.x, pos.y, pos.z);
    ctx.followCamera(pos, dt, {
      speedRatio: res.speed / PHYSICS.maxSpeed,
      turbo: res.turbo,
      inLoop: res.inLoop,
      loopCenterZ: res.loopCenterZ,
      falling: res.falling,
    });
    ctx.updateContactShadow(
      pos.x, surf.groundY, pos.z,
      Math.max(0, pos.y - surf.groundY),
      3.4,
      !res.inLoop && !res.falling && surf.onTrack
    );

    const standings = buildStandings(player.getState());
    const rank = Math.max(1, standings.findIndex((r) => r.isPlayer) + 1);

    hud.updateHUD({
      score, distance, coins, hearts, maxHearts: d.hearts, combo,
      speed: res.speed, speedRatio: res.speed / (PHYSICS.maxSpeed * PHYSICS.turbo.multiplier),
      turbo: player.getState().turboTimer / PHYSICS.turbo.duration,
      nextCheckpoint, invuln, rank, totalRacers: standings.length,
    });
    hud.sfx.setEngine(true, res.speed / PHYSICS.maxSpeed, res.turbo);
  }

  /* ---------------- Kamera sinematik non-playing ---------------- */
  function stepIdle(dt, spotZ, radius, elev, spin) {
    menuAngle += dt * spin;
    const y = getTrackHeight(spotZ);
    camTarget.set(0, y + 1.9, spotZ);
    ctx.camera.position.set(
      Math.sin(menuAngle) * radius,
      y + 1.9 + Math.sin(elev) * radius,
      spotZ + Math.cos(menuAngle) * radius
    );
    ctx.camera.up.set(0, 1, 0);
    ctx.camera.lookAt(camTarget);
    ctx.setAnchor(0, y, spotZ);
    return y;
  }

  /* ---------------- Loop tunggal ---------------- */
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    if (state === STATES.PLAYING) {
      stepPlaying(dt);
    } else if (state === STATES.MENU) {
      const g = player.group;
      const y = stepIdle(dt, MENU_Z, 10.2, 0.40, 0.16);
      if (g) {
        g.position.set(0, y + 0.06 + Math.sin(elapsed * 1.6) * 0.05, MENU_Z);
        g.rotation.set(0, elapsed * 0.32, 0);
        for (const w of g.userData.wheels || []) w.rotation.x -= dt * 2.2;
      }
      track.updateTrack(MENU_Z, elapsed);
      landmarks.update(MENU_Z);
      ctx.updateContactShadow(0, y, MENU_Z, 0.1, 3.4);
      hud.sfx.setEngine(false);
    } else if (state === STATES.PAUSED) {
      const pos = player.getState().pos;
      ctx.setAnchor(pos.x, pos.y, pos.z);
      hud.sfx.setEngine(false);
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
    track.updateTrack(MENU_Z, 0);
    landmarks.update(MENU_Z);
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
    init, start, pause, resume, toMenu, dispose, setDifficulty, setVehicleLabel, addRolls,
    onAbyssFall, onAbyssRecover, onLoopComplete,
    get state() { return state; },
    get best() { return best; },
    get stats() { return { score, distance, coins, hearts, combo, rollsTotal, difficulty: diff }; },
  };
}
