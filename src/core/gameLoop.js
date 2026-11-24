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

function safeGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(key, String(val));
    return true;
  } catch {
    return false;
  }
}

export function createGameLoop({
  ctx, track, salatigaTrack = null, skywayTrack = null, mandalikaTrack = null,
  salatigaRoot = null, skywayRoot = null, mandalikaRoot = null,
  landmarks, player, traffic, hud, network,
  difficulty = 'santai', arena = 'salatiga', noGameOver = false,
}) {
  const clock = new THREE.Clock();
  const keys = new Set();
  let state = STATES.MENU;
  let diff = DIFF[difficulty] ? difficulty : 'santai';
  let noOver = !!noGameOver;
  let currentArenaId = setActiveArena(arena);
  let activeTrack = currentArenaId === 'mandalika' && mandalikaTrack
    ? mandalikaTrack
    : (currentArenaId === 'skyway' && skywayTrack) ? skywayTrack : (salatigaTrack || track);
  let hearts = DIFF[diff].hearts;
  let score = 0, distance = 0, best = loadBest();
  let coins = 0, coinStreak = 0, coinStreakTimer = 0;
  let combo = 1, comboTimer = 0, rollsTotal = 0;
  let nextCheckpoint = 500, invuln = 0, elapsed = 0, raceTimer = 0;
  let countdownTimer = 0, countdownStage = '';
  let standingsTimer = 0;
  let cachedRank = 1;
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
  const _lookPos = new THREE.Vector3();
  const _menuPos = new THREE.Vector3();
  const _overheadProj = { x: 0, y: 0, visible: false };
  const _circuitPreviewPts = [];
  const _radarPreviewPts = [];
  const _remoteBuf = [];
  const _aiSnapBuf = [];

  /* Pool objek zero-GC untuk klasemen, penanda progres, minimap, HUD, & sinkronisasi jaringan */
  const _standingsPool = Array.from({ length: 12 }, () => ({
    id: '', name: '', type: 'angkot',
    x: 0, z: 0, s: 0, coins: 0, score: 0, finishTime: 0,
    slotColor: SLOT_COLORS[0], isPlayer: false, isRemote: false, isAI: false,
  }));
  const _standingsWork = [];
  const _standingsOut = [];
  const _racerMarkersPool = Array.from({ length: 4 }, () => ({
    id: '', color: SLOT_COLORS[0], isPlayer: false, frac: 0,
  }));
  const _racerMarkersOut = [];
  const _minimapRacersPool = Array.from({ length: 4 }, () => ({
    x: 0, z: 0, color: SLOT_COLORS[0], isPlayer: false,
  }));
  const _minimapRacersOut = [];
  const _hitbox = { x: 0, z: 0 };
  const _trafficOpts = {
    rawDt: 0, playerType: 'angkot', playerS: 0, playerLatX: 0,
    remotePlayers: _remoteBuf, track: null, raceActive: true, lapGoal: LAP_DIST,
  };
  const _camOpts = {
    speedRatio: 0, turbo: false, inLoop: false, loopCenterZ: 0,
    falling: false, aimOffsetX: 0, trackSlope: 0, forwardVec: null, arenaId: 'salatiga', introProgress: 1,
  };
  const _hudOverhead = { x: 0, y: 0, visible: false, coins: 0, isFirst: false };
  const _hudPayload = {
    score: 0, distance: 0, lapGoal: LAP_DIST, lapNumber: 1, raceTime: 0, arenaId: 'salatiga',
    coins: 0, hearts: 5, maxHearts: 5, noGameOver: false, combo: 1,
    speed: 0, speedRatio: 0, turbo: 0, nextCheckpoint: 500, invuln: 0,
    rank: 1, totalRacers: 1, standings: _standingsOut, racerMarkers: _racerMarkersOut,
    minimapMode: 'radar', minimapPts: _radarPreviewPts, minimapRacers: _minimapRacersOut,
    playerPos: null, overhead: _hudOverhead,
  };
  const _syncPayload = {
    vehicleType: 'angkot', vehicle: 'angkot',
    x: 0, z: 0, s: 0, latX: 0, yaw: 0, rollAngle: 0, speed: 0,
    score: 0, coins: 0, turbo: false, state: STATES.MENU,
  };

  const playerRibbon = createNeonRibbonTrail(ctx.scene, SLOT_COLORS[0], 0.56);
  playerRibbon.setVisible(false);

  function loadBest() {
    const v = parseFloat(safeGet(BEST_KEY, '0'));
    return Number.isFinite(v) ? v : 0;
  }
  function saveBest(v) {
    safeSet(BEST_KEY, String(Math.round(v)));
  }

  function applyArenaVisibility(id) {
    currentArenaId = setActiveArena(id);
    activeTrack = currentArenaId === 'mandalika' && mandalikaTrack
      ? mandalikaTrack
      : (currentArenaId === 'skyway' && skywayTrack) ? skywayTrack : (salatigaTrack || track);
    if (salatigaRoot) salatigaRoot.visible = (currentArenaId === 'salatiga');
    if (skywayRoot) skywayRoot.visible = (currentArenaId === 'skyway');
    if (mandalikaRoot) mandalikaRoot.visible = (currentArenaId === 'mandalika');
    ctx.setAtmosphere?.(currentArenaId);
  }
  applyArenaVisibility(currentArenaId);

  function setArena(id) {
    applyArenaVisibility(id);
    if (activeTrack?.isSplineCircuit) {
      const previewS = state === STATES.MENU ? 14 : (player.getState().s ?? 0);
      activeTrack.updateTrack(previewS, elapsed);
      if (state === STATES.MENU) {
        activeTrack.evalCircuitPose(previewS, 0, _menuPos);
        if (player.group) player.group.position.set(_menuPos.x, _menuPos.y + 0.06, _menuPos.z);
        ctx.setAnchor(_menuPos.x, _menuPos.y, _menuPos.z);
      }
      return;
    }
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

  function sortPodium(a, b) {
    const af = a.finishTime > 0 ? 0 : 1;
    const bf = b.finishTime > 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    if (a.finishTime > 0 && b.finishTime > 0) {
      const dtFin = a.finishTime - b.finishTime;
      if (Math.abs(dtFin) > 0.01) return dtFin;
    }
    return ((b.coins || 0) - (a.coins || 0)) || (b.score - a.score) || ((b.s ?? -b.z) - (a.s ?? -a.z));
  }

  function sortLive(a, b) {
    return ((b.s ?? -b.z) - (a.s ?? -a.z)) || ((b.coins || 0) - (a.coins || 0)) || (b.score - a.score);
  }

  function buildStandings(ps, forPodium = false) {
    let poolIdx = 0;
    _standingsWork.length = 0;

    const pSlot = _standingsPool[poolIdx++];
    pSlot.id = network?.identity?.id || 'player';
    pSlot.name = network?.identity?.name || 'Kamu';
    pSlot.type = ps.type;
    pSlot.x = ps.pos.x;
    pSlot.z = ps.pos.z;
    pSlot.s = ps.s ?? (-ps.pos.z);
    pSlot.coins = Math.round(coins);
    pSlot.score = Math.round(score);
    pSlot.finishTime = playerFinishTime || 0;
    pSlot.slotColor = SLOT_COLORS[0];
    pSlot.isPlayer = true;
    pSlot.isRemote = false;
    pSlot.isAI = false;
    _standingsWork.push(pSlot);

    const remotes = network?.getRemotePlayers?.(_remoteBuf) || _remoteBuf;
    for (let i = 0; i < remotes.length && poolIdx < _standingsPool.length; i++) {
      const p = remotes[i];
      if (p.state === 'PLAYING' || p.state === 'PAUSED') {
        const slot = _standingsPool[poolIdx++];
        slot.id = p.id;
        slot.name = p.name || 'Juragan';
        slot.type = p.vehicleType || 'angkot';
        slot.x = p.x || 0;
        slot.z = p.z || 0;
        slot.s = p.s ?? (-p.z || 0);
        slot.coins = Math.round(p.coins || 0);
        slot.score = Math.round(p.score || 0);
        slot.finishTime = p.finishTime || 0;
        slot.slotColor = SLOT_COLORS[1];
        slot.isPlayer = false;
        slot.isRemote = true;
        slot.isAI = false;
        _standingsWork.push(slot);
      }
    }

    const aiList = traffic.getAIRacersSnapshot?.(_aiSnapBuf) || _aiSnapBuf;
    for (let i = 0; i < aiList.length && poolIdx < _standingsPool.length; i++) {
      const ai = aiList[i];
      const slot = _standingsPool[poolIdx++];
      slot.id = ai.id;
      slot.name = ai.name;
      slot.type = ai.type;
      slot.x = ai.x;
      slot.z = ai.z;
      slot.s = ai.s;
      slot.coins = ai.coins;
      slot.score = ai.score;
      slot.finishTime = ai.finishTime;
      slot.slotColor = ai.slotColor;
      slot.isPlayer = false;
      slot.isRemote = false;
      slot.isAI = true;
      _standingsWork.push(slot);
    }

    _standingsWork.sort(forPodium ? sortPodium : sortLive);
    const count = Math.min(4, _standingsWork.length);
    _standingsOut.length = count;
    for (let i = 0; i < count; i++) _standingsOut[i] = _standingsWork[i];
    return _standingsOut;
  }

  function refreshStandingsAndMarkers(ps) {
    const standings = buildStandings(ps, false);
    let rank = 1;
    const lapStart = lapGoal - LAP_DIST;
    _racerMarkersOut.length = standings.length;
    _minimapRacersOut.length = standings.length;
    for (let i = 0; i < standings.length; i++) {
      const r = standings[i];
      if (r.isPlayer) rank = i + 1;
      const mk = _racerMarkersPool[i];
      mk.id = r.id;
      mk.color = r.slotColor || SLOT_COLORS[0];
      mk.isPlayer = !!r.isPlayer;
      mk.frac = THREE.MathUtils.clamp(((r.s ?? (-r.z)) - lapStart) / LAP_DIST, 0, 1);
      _racerMarkersOut[i] = mk;

      const mr = _minimapRacersPool[i];
      mr.x = r.x ?? 0;
      mr.z = r.z ?? 0;
      mr.color = r.slotColor || SLOT_COLORS[0];
      mr.isPlayer = !!r.isPlayer;
      _minimapRacersOut[i] = mr;
    }
    cachedRank = rank;
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
    if ((c === 'Enter' || c === 'Space') && t && t.tagName === 'BUTTON') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(c)) e.preventDefault();
    keys.add(c);
    if (c === 'KeyM') hud.toggleAudio();
    else if (c === 'KeyH') {
      if (state === STATES.PLAYING && countdownTimer <= 0) hud.triggerTelolet?.();
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
    if (finishing || countdownTimer > 0) return { left: false, right: false };
    return {
      left: keys.has('ArrowLeft') || keys.has('KeyA') || hud.input.left,
      right: keys.has('ArrowRight') || keys.has('KeyD') || hud.input.right,
    };
  }

  function pushHudUpdate(ps, pos, speed, speedRatio, turboNorm, falling, isSpline) {
    const previewBuf = isSpline ? _circuitPreviewPts : _radarPreviewPts;
    getTrackPreviewPoints(pos.z + 24, pos.z - 150, 26, previewBuf);

    const pDef = getVehicleDef(ps.type);
    ctx.projectToScreen?.(
      pos.x,
      pos.y + (pDef.targetSize?.y || 2.8) + 0.92,
      pos.z,
      _overheadProj
    );

    _hudOverhead.x = _overheadProj.x;
    _hudOverhead.y = _overheadProj.y;
    _hudOverhead.visible = _overheadProj.visible && !falling;
    _hudOverhead.coins = coins;
    _hudOverhead.isFirst = cachedRank === 1;

    _hudPayload.score = score;
    _hudPayload.distance = distance;
    _hudPayload.lapGoal = lapGoal;
    _hudPayload.lapNumber = lapNumber;
    _hudPayload.raceTime = raceTimer;
    _hudPayload.arenaId = currentArenaId;
    _hudPayload.coins = coins;
    _hudPayload.hearts = hearts;
    _hudPayload.maxHearts = DIFF[diff].hearts;
    _hudPayload.noGameOver = noOver;
    _hudPayload.combo = combo;
    _hudPayload.speed = speed;
    _hudPayload.speedRatio = speedRatio;
    _hudPayload.turbo = turboNorm;
    _hudPayload.nextCheckpoint = nextCheckpoint;
    _hudPayload.invuln = invuln;
    _hudPayload.rank = cachedRank;
    _hudPayload.totalRacers = _standingsOut.length;
    _hudPayload.standings = _standingsOut;
    _hudPayload.racerMarkers = _racerMarkersOut;
    _hudPayload.minimapMode = isSpline ? 'circuit' : 'radar';
    _hudPayload.minimapPts = previewBuf;
    _hudPayload.minimapRacers = _minimapRacersOut;
    _hudPayload.playerPos = pos;

    hud.updateHUD(_hudPayload);
  }

  /* ---------------- Transisi state ---------------- */
  function start() {
    const d = DIFF[diff];
    hearts = d.hearts;
    score = 0; distance = 0; coins = 0; coinStreak = 0; coinStreakTimer = 0;
    combo = 1; comboTimer = 0; rollsTotal = 0;
    nextCheckpoint = 500; invuln = 0; raceTimer = 0;
    countdownTimer = 3.0; countdownStage = '3';
    standingsTimer = 0; cachedRank = 1;
    introSweepTimer = (currentArenaId === 'skyway' || currentArenaId === 'mandalika') ? 0.001 : INTRO_SWEEP_DUR;
    lapGoal = LAP_DIST; lapNumber = 1; lapPaused = false;
    finishing = false; finishTimer = 0; fireworkCooldown = 0; playerFinishTime = 0;
    smoothAimOffsetX = 0; smoothSpeedRatio = PHYSICS.baseSpeed / PHYSICS.maxSpeed;
    applyArenaVisibility(currentArenaId);
    player.reset();
    const ps0 = player.getState();
    traffic.reset(ps0.type);
    activeTrack.resetCollectibles?.();
    const pos = ps0.pos;
    playerRibbon.setBoostMode(false);
    playerRibbon.reset(pos.x, pos.y + 0.34, pos.z + 1.4);
    playerRibbon.setVisible(true);
    activeTrack.updateTrack(activeTrack.isSplineCircuit ? (ps0.s ?? 0) : pos.z, elapsed);
    if (currentArenaId === 'salatiga') landmarks.update(pos.z);
    ctx.snapCamera(pos, ps0.forwardVec);
    ctx.setAnchor(pos.x, pos.y, pos.z);
    refreshStandingsAndMarkers(ps0);
    hud.hideMenu(); hud.hideGameOver(); hud.setPaused(false);
    hud.setWarnings?.([]); hud.setAirHint?.(false); hud.showHUD();
    hud.sfx.resume();
    hud.setInputLocked?.(true);
    hud.showCountdown?.('3');
    hud.sfx.countdown?.('3');
    state = STATES.PLAYING;
    clock.getDelta();
  }

  function pause() {
    if (state !== STATES.PLAYING) return;
    state = STATES.PAUSED;
    hud.hideCountdown?.();
    hud.setInputLocked?.(false);
    hud.setPaused(true);
    hud.sfx.setEngine(false);
  }
  function resume() {
    if (state !== STATES.PAUSED) return;
    lapPaused = false;
    standingsTimer = 0;
    state = STATES.PLAYING;
    hud.setPaused(false);
    hud.hideGameOver();
    hud.showHUD();
    hud.sfx.resume();
    if (countdownTimer > 0) {
      hud.setInputLocked?.(true);
      if (countdownStage) hud.showCountdown?.(countdownStage);
    } else {
      hud.setInputLocked?.(false);
    }
    clock.getDelta();
  }
  function continueLap() {
    if (state !== STATES.PAUSED || !lapPaused) return;
    lapPaused = false;
    finishing = false;
    finishTimer = 0;
    playerFinishTime = 0;
    countdownTimer = 0;
    countdownStage = '';
    standingsTimer = 0;
    lapGoal += LAP_DIST;
    lapNumber += 1;
    if (activeTrack?.isSplineCircuit) activeTrack.resetCollectibles?.();
    hud.hideGameOver();
    hud.hideCountdown?.();
    hud.setInputLocked?.(false);
    hud.showHUD();
    state = STATES.PLAYING;
    hud.sfx.resume();
    clock.getDelta();
  }
  function toMenu() {
    state = STATES.MENU;
    coins = 0; coinStreak = 0; coinStreakTimer = 0; raceTimer = 0;
    countdownTimer = 0; countdownStage = '';
    lapGoal = LAP_DIST; lapNumber = 1; lapPaused = false;
    finishing = false; finishTimer = 0; playerFinishTime = 0;
    player.reset();
    traffic.reset(player.getState().type);
    playerRibbon.setVisible(false);
    activeTrack.resetCollectibles?.();
    hud.setWarnings?.([]);
    hud.setAirHint?.(false);
    hud.hideCountdown?.();
    hud.setInputLocked?.(false);
    hud.hideGameOver(); hud.setPaused(false); hud.hideHUD();
    hud.showMenu(best);
    hud.sfx.setEngine(false);
    if (activeTrack?.isSplineCircuit) {
      activeTrack.updateTrack(14, elapsed);
    } else {
      const previewZ = currentArenaId === 'skyway' ? -18 : MENU_Z;
      activeTrack.updateTrack(previewZ, elapsed);
      if (currentArenaId === 'salatiga') landmarks.update(previewZ);
    }
  }
  function finishLap() {
    lapPaused = true;
    state = STATES.PAUSED;
    countdownTimer = 0; countdownStage = '';
    hud.hideCountdown?.();
    hud.setInputLocked?.(false);
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
    countdownTimer = 0; countdownStage = '';
    hud.hideCountdown?.();
    hud.setInputLocked?.(false);
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
      if (noOver) {
        invuln = Math.max(invuln, 2.0);
        hud.toast?.('🛡️ Mode Anak: Lanjut ke Finish!', 'good');
      } else {
        gameOver();
      }
    }
  }

  function onLoopComplete() {}
  function addRolls(n) { if (n > 0) rollsTotal += n; }
  function setDifficulty(id) { if (DIFF[id]) { diff = id; if (state === STATES.MENU) hearts = DIFF[id].hearts; } }
  function setNoGameOver(on) { noOver = !!on; }
  function setVehicleLabel() {}

  /* ---------------- Simulasi PLAYING ---------------- */
  function stepPlaying(dt) {
    const d = DIFF[diff];
    const isSpline = !!activeTrack.isSplineCircuit;

    /* Countdown 3-2-1-GO! sebelum balapan dimulai */
    if (countdownTimer > 0) {
      countdownTimer = Math.max(0, countdownTimer - dt);
      const nextStage = countdownTimer > 2 ? '3' : countdownTimer > 1 ? '2' : countdownTimer > 0 ? '1' : 'GO!';
      if (nextStage !== countdownStage) {
        countdownStage = nextStage;
        hud.showCountdown?.(nextStage);
        hud.sfx.countdown?.(nextStage);
      }
      if (countdownTimer > 0) {
        if (introSweepTimer < INTRO_SWEEP_DUR) {
          introSweepTimer = Math.min(INTRO_SWEEP_DUR, introSweepTimer + dt);
        }
        const introProgress = introSweepTimer / INTRO_SWEEP_DUR;
        const ps0 = player.getState();
        const pos = ps0.pos;
        activeTrack.updateTrack(isSpline ? (ps0.s ?? 0) : pos.z, elapsed);
        if (currentArenaId === 'salatiga') landmarks.update(pos.z);

        const surf = isSpline
          ? activeTrack.getTrackSurfaceAt(ps0.s ?? 0, ps0.latX ?? 0)
          : getTrackSurfaceAt(pos.x, pos.z);
        ctx.setAnchor(pos.x, pos.y, pos.z);
        _camOpts.speedRatio = 0;
        _camOpts.turbo = false;
        _camOpts.inLoop = false;
        _camOpts.loopCenterZ = 0;
        _camOpts.falling = false;
        _camOpts.aimOffsetX = 0;
        _camOpts.trackSlope = surf?.slope ?? 0;
        _camOpts.forwardVec = isSpline ? ps0.forwardVec : null;
        _camOpts.arenaId = currentArenaId;
        _camOpts.introProgress = introProgress;
        ctx.followCamera(pos, dt, _camOpts);
        ctx.updateContactShadow(pos.x, surf.groundY, pos.z, Math.max(0, pos.y - surf.groundY), 3.4, surf.onTrack);

        standingsTimer -= dt;
        if (standingsTimer <= 0) {
          standingsTimer = 0.1;
          refreshStandingsAndMarkers(ps0);
        }
        pushHudUpdate(ps0, pos, 0, 0, 0, false, isSpline);
        hud.sfx.setEngine(false);
        return;
      }
      hud.setInputLocked?.(false);
    }

    raceTimer += dt;
    if (introSweepTimer < INTRO_SWEEP_DUR) {
      introSweepTimer = Math.min(INTRO_SWEEP_DUR, introSweepTimer + dt);
    }
    const introProgress = introSweepTimer / INTRO_SWEEP_DUR;

    const input = readInput();
    const res = player.updatePlayer(dt, input, activeTrack);
    const pos = res.pos;
    const ps = player.getState();

    activeTrack.updateTrack(isSpline ? (res.s ?? 0) : pos.z, elapsed);
    if (currentArenaId === 'salatiga') landmarks.update(pos.z);

    const pressure = d.pressure * (1 + Math.min(0.55, distance / 3500));
    _trafficOpts.rawDt = dt;
    _trafficOpts.playerType = ps.type;
    _trafficOpts.playerS = res.s ?? (-pos.z);
    _trafficOpts.playerLatX = res.latX ?? 0;
    _trafficOpts.remotePlayers = network.getRemotePlayers(_remoteBuf);
    _trafficOpts.track = activeTrack;
    _trafficOpts.raceActive = true;
    _trafficOpts.lapGoal = lapGoal;
    traffic.update(dt * pressure, pos.z, elapsed, pos.x, _trafficOpts);

    /* Jarak & skor dasar */
    const newDist = Math.max(distance, isSpline ? (res.s ?? 0) : (-pos.z));
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
      for (let i = 0; i < pickups.length; i++) {
        const item = pickups[i];
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
      const def = getVehicleDef(ps.type);
      _hitbox.x = def.targetSize.x * 0.4;
      _hitbox.z = def.targetSize.z * 0.4;
      const hitTraffic = traffic.checkCollision(pos, _hitbox);
      const hitHazard = hitTraffic ? null : activeTrack.checkHazardCollision?.(pos, _hitbox);
      if ((hitTraffic || hitHazard) && player.hitObstacle()) {
        hearts = Math.max(0, hearts - 1);
        invuln = 1.5; combo = 1; comboTimer = 0;
        ctx.addShake(0.85);
        hud.flashCrash(); hud.sfx.crash();
        if (hearts <= 0) {
          if (noOver) {
            invuln = 2.0;
            hud.toast?.('🛡️ Mode Anak: Lanjut ke Finish!', 'good');
          } else {
            gameOver();
            return;
          }
        }
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
    const surf = isSpline
      ? activeTrack.getTrackSurfaceAt(res.s ?? 0, res.latX ?? 0)
      : getTrackSurfaceAt(pos.x, pos.z);
    const camPosFocus = res.camAnchor || pos;
    let rawAimOffsetX = 0;
    if (!res.inLoop && !res.falling) {
      if (isSpline && res.rightVec) {
        activeTrack.evalCircuitPose((res.s ?? 0) + 14, 0, _lookPos);
        rawAimOffsetX = (
          (_lookPos.x - camPosFocus.x) * res.rightVec.x +
          (_lookPos.z - camPosFocus.z) * res.rightVec.z
        ) * 0.45;
      } else {
        rawAimOffsetX = (getTrackCenterX(camPosFocus.z - 12) - camPosFocus.x) * 0.52;
      }
    }
    const rawSpeedRatio = res.speed / PHYSICS.maxSpeed;
    smoothAimOffsetX += (rawAimOffsetX - smoothAimOffsetX) * (1 - Math.exp(-7.2 * dt));
    smoothSpeedRatio += (rawSpeedRatio - smoothSpeedRatio) * (1 - Math.exp(-5.8 * dt));
    ctx.setAnchor(pos.x, pos.y, pos.z);
    _camOpts.speedRatio = smoothSpeedRatio;
    _camOpts.turbo = res.turbo;
    _camOpts.inLoop = res.inLoop;
    _camOpts.loopCenterZ = res.loopCenterZ;
    _camOpts.falling = res.falling;
    _camOpts.aimOffsetX = smoothAimOffsetX;
    _camOpts.trackSlope = surf?.slope ?? 0;
    _camOpts.forwardVec = isSpline ? res.forwardVec : null;
    _camOpts.arenaId = currentArenaId;
    _camOpts.introProgress = introProgress;
    ctx.followCamera(camPosFocus, dt, _camOpts);
    ctx.updateContactShadow(
      pos.x, surf.groundY, pos.z,
      Math.max(0, pos.y - surf.groundY),
      3.4,
      !res.inLoop && !res.falling && surf.onTrack
    );

    standingsTimer -= dt;
    if (standingsTimer <= 0) {
      standingsTimer = 0.1;
      refreshStandingsAndMarkers(ps);
    }

    pushHudUpdate(
      ps,
      pos,
      res.speed,
      res.speed / (PHYSICS.maxSpeed * PHYSICS.turbo.multiplier),
      ps.turboTimer / PHYSICS.turbo.duration,
      res.falling,
      isSpline
    );
    hud.sfx.setEngine(true, res.speed / PHYSICS.maxSpeed, res.turbo);
  }

  /* ---------------- Kamera sinematik non-playing ---------------- */
  function stepIdleWorld(dt, cx, y, spotZ, radius, elev, spin) {
    menuAngle += dt * spin;
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

  function stepIdle(dt, spotZ, radius, elev, spin) {
    return stepIdleWorld(dt, getTrackCenterX(spotZ), getTrackHeight(spotZ), spotZ, radius, elev, spin);
  }

  /* ---------------- Loop tunggal ---------------- */
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    if (state === STATES.PLAYING) {
      stepPlaying(dt);
    } else if (state === STATES.MENU) {
      const g = player.group;
      if (activeTrack?.isSplineCircuit) {
        const previewS = 14;
        activeTrack.evalCircuitPose(previewS, 0, _menuPos);
        stepIdleWorld(dt, _menuPos.x, _menuPos.y, _menuPos.z, 12.2, 0.40, 0.16);
        if (g) {
          g.position.set(_menuPos.x, _menuPos.y + 0.06 + Math.sin(elapsed * 1.6) * 0.05, _menuPos.z);
          g.rotation.set(0, elapsed * 0.32, 0);
          const wheels = g.userData.wheels || [];
          for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x -= dt * 2.2;
        }
        activeTrack.updateTrack(previewS, elapsed);
        ctx.updateContactShadow(_menuPos.x, _menuPos.y, _menuPos.z, 0.1, 3.4);
      } else {
        const previewZ = currentArenaId === 'skyway' ? -18 : MENU_Z;
        const y = stepIdle(dt, previewZ, currentArenaId === 'skyway' ? 12.2 : 10.2, 0.40, 0.16);
        if (g) {
          g.position.set(0, y + 0.06 + Math.sin(elapsed * 1.6) * 0.05, previewZ);
          g.rotation.set(0, elapsed * 0.32, 0);
          const wheels = g.userData.wheels || [];
          for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x -= dt * 2.2;
        }
        activeTrack.updateTrack(previewZ, elapsed);
        if (currentArenaId === 'salatiga') landmarks.update(previewZ);
        ctx.updateContactShadow(0, y, previewZ, 0.1, 3.4);
      }
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
      const psOver = player.getState();
      const pos = psOver.pos;
      if (activeTrack?.isSplineCircuit) {
        const surf = activeTrack.getTrackSurfaceAt(psOver.s ?? 0, psOver.latX ?? 0);
        stepIdleWorld(dt, pos.x, pos.y, pos.z, 13.5, 0.5, 0.1);
        ctx.updateContactShadow(pos.x, surf.groundY, pos.z, 0, 3.4);
      } else {
        stepIdle(dt, pos.z, 13.5, 0.5, 0.1);
        ctx.updateContactShadow(pos.x, getTrackHeight(pos.z), pos.z, 0, 3.4);
      }
      hud.sfx.setEngine(false);
    }

    /* Jaringan (Supabase Realtime / Solo fallback) */
    const ps = player.getState();
    const yaw = Math.atan2(-(ps.forwardVec?.x || 0), -(ps.forwardVec?.z ?? -1));
    _syncPayload.vehicleType = ps.type;
    _syncPayload.vehicle = ps.type;
    _syncPayload.x = ps.pos.x;
    _syncPayload.z = ps.pos.z;
    _syncPayload.s = ps.s ?? (-ps.pos.z);
    _syncPayload.latX = ps.latX ?? 0;
    _syncPayload.yaw = yaw;
    _syncPayload.rollAngle = ps.rollAngle;
    _syncPayload.speed = ps.speed;
    _syncPayload.score = score;
    _syncPayload.coins = coins;
    _syncPayload.turbo = ps.turboTimer > 0;
    _syncPayload.state = state;
    network.syncLocalState(_syncPayload);
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
    if (activeTrack?.isSplineCircuit) {
      activeTrack.updateTrack(14, 0);
    } else {
      const previewZ = currentArenaId === 'skyway' ? -18 : MENU_Z;
      activeTrack.updateTrack(previewZ, 0);
      if (currentArenaId === 'salatiga') landmarks.update(previewZ);
    }
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
    setDifficulty, setNoGameOver, setArena, setVehicleLabel, addRolls,
    onAbyssFall, onAbyssRecover, onLoopComplete,
    get state() { return state; },
    get arena() { return currentArenaId; },
    get best() { return best; },
    get stats() { return { score, distance, coins, hearts, combo, rollsTotal, difficulty: diff, arena: currentArenaId }; },
  };
}
