/* =====================================================================
   main.js — Penghubung utama seluruh modul Juragan Ngebut.
   Urutan: HUD → scene terkunci → preload aset dual-mode → Arena Salatiga
   & Nusantara Skyway → landmark → player → lalu lintas → jaringan → loop.
   ===================================================================== */
import * as THREE from 'three';
import { createSceneContext } from './core/sceneSetup.js';
import { createGameLoop } from './core/gameLoop.js';
import { preloadAll, loadVehicle, setVehicleUnderglow } from './entities/assetFactory.js';
import { createPlayerController } from './entities/playerController.js';
import { createTrafficManager } from './entities/trafficManager.js';
import { createTrackGenerator } from './world/trackGenerator.js';
import { createFantasyTrack } from './world/fantasyTrack.js';
import { createMandalikaTrack } from './world/mandalikaFantasyTrack.js';
import { setActiveArena } from './world/activeTrack.js';
import { createLandmarkManager } from './world/salatigaLandmark.js';
import { createHUD } from './ui/hudManager.js';
import { createMultiplayerHook } from './network/multiplayerHook.js';
import { GAME, VEHICLES, ARENAS, SLOT_COLORS } from './config/gameConfig.js';

const LOAD_LINES = [
  'Merakit angkot…', 'Memanaskan bemo…', 'Mengisi bak L300…', 'Memarkir ojol…',
  'Mengecat Koperasi Merah Putih…', 'Menata Pasar Raya II…',
  'Membangun Nusantara Skyway…', 'Membentuk Mandalika Sky Circuit…',
];

let hud = null, ctx = null, track = null, skywayTrack = null, mandalikaTrack = null, landmarks = null;
let salatigaRoot = null, skywayRoot = null, mandalikaRoot = null;
let player = null, traffic = null, network = null, loop = null;
let vehicleSwapToken = 0;

init().catch((err) => {
  console.error('[Juragan] Gagal memulai:', err);
  if (hud) hud.showFatal('Gagal merakit diorama: ' + (err?.message || 'kesalahan tak terduga') + '. Pastikan browser mendukung WebGL dan halaman disajikan lewat server (bukan file://).');
});

async function init() {
  /* ---------- 1. HUD lebih dulu agar layar muat langsung tampil ---------- */
  hud = createHUD({
    onStart: () => loop?.start(),
    onPause: () => loop?.pause(),
    onResume: () => loop?.resume(),
    onContinue: () => loop?.continueLap(),
    onRestart: () => loop?.start(),
    onMenu: () => loop?.toMenu(),
    onDifficulty: (id) => loop?.setDifficulty(id),
    onSelectArena: (arenaId) => {
      loop?.setArena(arenaId);
      const def = ARENAS[arenaId];
      if (def) hud.toast(`Arena dipilih: ${def.emoji} ${def.label}`, 'good');
    },
    onSelectVehicle: (key) => swapVehicle(key),
    onRoomChange: (roomId) => {
      const s = network?.joinRoom(roomId);
      if (network) hud.setNetworkStatus(s || network.status, network.room, network.onlineCount);
      hud.toast(`Pindah ke kamar ${roomId.toUpperCase()} 🌐`, 'good');
    },
    onNameChange: (name) => {
      const saved = network?.setName(name);
      if (saved) hud.toast(`Nama Juragan: ${saved} ✨`, 'good');
    },
    onQuality: (high) => ctx?.setQuality(high),
  });
  hud.setLoading(0.02, 'Menyalakan golden hour…');

  /* ---------- 2. Scene terkunci (ACES, fog, cahaya hangat) ---------- */
  const canvas = document.getElementById('scene-canvas');
  if (!canvas) throw new Error('Canvas #scene-canvas tidak ditemukan');
  ctx = createSceneContext(canvas);
  ctx.contactShadow.visible = false;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop?.pause();
    hud.showFatal('Konteks WebGL hilang di tengah jalan. Muat ulang untuk melanjutkan balapan.');
  });

  /* ---------- 3. Pipeline aset dual-mode (GLB → prosedural) ---------- */
  hud.setLoading(0.06, 'Mencari berkas .glb di public/assets…');
  await preloadAll((i, total, label) => {
    hud.setLoading(0.06 + (i / total) * 0.65, LOAD_LINES[i - 1] || `Merakit ${label}…`);
  });

  /* ---------- 4. Tiga Arena Dunia (Salatiga Klasik + Nusantara Skyway + Mandalika Sky) ---------- */
  setActiveArena(hud.arena);
  salatigaRoot = new THREE.Group();
  skywayRoot = new THREE.Group();
  mandalikaRoot = new THREE.Group();
  ctx.scene.add(salatigaRoot, skywayRoot, mandalikaRoot);

  hud.setLoading(0.73, 'Menggelar Sirkuit Kota Salatiga…');
  track = createTrackGenerator(salatigaRoot, { maxAnisotropy: ctx.maxAnisotropy });
  hud.setLoading(0.79, 'Menanam landmark Salatiga…');
  landmarks = await createLandmarkManager(salatigaRoot);

  hud.setLoading(0.84, 'Merakit Nusantara Skyway & Garuda Emas…');
  skywayTrack = createFantasyTrack(skywayRoot, { maxAnisotropy: ctx.maxAnisotropy });

  hud.setLoading(0.89, 'Membentuk 17 Tikungan Mandalika Sky Circuit…');
  mandalikaTrack = createMandalikaTrack(mandalikaRoot, { maxAnisotropy: ctx.maxAnisotropy });

  /* ---------- 5. Player ---------- */
  hud.setLoading(0.92, 'Menyiapkan armada juragan…');
  let type = hud.vehicle;
  if (!VEHICLES[type]) type = 'angkot';
  const vehicle = await loadVehicle(type);
  player = createPlayerController({
    scene: ctx.scene, vehicle, type, audio: hud.sfx,
    callbacks: {
      onLaunch: () => { hud.sfx.launch(); ctx.addShake(0.18); },
      onRollStart: () => hud.sfx.roll(),
      onBoost: () => { hud.sfx.boost(); ctx.addShake(0.3); },
      onLand: (rolls) => {
        ctx.addShake(rolls > 0 ? 0.55 : 0.22);
        if (rolls > 0) {
          loop?.addRolls?.(rolls);
          hud.sfx.stunt(rolls);
          hud.toast(rolls > 1 ? `🔥 BARREL ROLL ×${rolls}!` : '🔥 BARREL ROLL → TURBO!', 'good');
        } else hud.sfx.land();
      },
      onCrash: () => {},
      onAbyssFall: (kind) => loop?.onAbyssFall?.(kind),
      onAbyssRecover: () => loop?.onAbyssRecover?.(),
      onLoopComplete: () => loop?.onLoopComplete?.(),
    },
  });

  /* ---------- 6. Lalu lintas & jaringan ---------- */
  hud.setLoading(0.96, 'Memanggil angkot, bemo, L300 & ojol…');
  traffic = await createTrafficManager(ctx.scene);
  network = createMultiplayerHook({
    scene: ctx.scene,
    room: hud.room,
    onStatusChange: ({ status, room, onlineCount }) => hud.setNetworkStatus(status, room, onlineCount),
    onLobbyChange: (counts) => hud.setLobbyCounts(counts),
  });
  setVehicleUnderglow(vehicle, SLOT_COLORS[0]);
  ctx.refineSceneTextures?.(ctx.scene);
  hud.setPlayerName(network.identity.name);
  hud.setActiveRoom(network.room);
  hud.setLobbyCounts(network.lobbyCounts);

  /* ---------- 7. Loop & state MENU ---------- */
  loop = createGameLoop({
    ctx,
    track,
    salatigaTrack: track,
    skywayTrack,
    mandalikaTrack,
    salatigaRoot,
    skywayRoot,
    mandalikaRoot,
    landmarks,
    player,
    traffic,
    hud,
    network,
    difficulty: hud.difficulty,
    arena: hud.arena,
  });
  loop.init();

  hud.setLoading(1, 'Siap ngebut, Juragan! 🏁');
  setTimeout(() => hud.hideLoading(), 320);

  /* ---------- 8. Ganti armada dari menu (async, aman dari race) ---------- */
  async function swapVehicle(key) {
    if (!VEHICLES[key] || !player) return;
    const token = ++vehicleSwapToken;
    try {
      const g = await loadVehicle(key);
      if (token !== vehicleSwapToken) return;
      setVehicleUnderglow(g, SLOT_COLORS[0]);
      ctx.refineSceneTextures?.(g);
      player.setVehicle(g, key);
      hud.toast(`${VEHICLES[key].label} siap di garis start! ${VEHICLES[key].tagline}`, 'good');
    } catch (err) {
      console.warn('[Juragan] Gagal ganti armada:', err);
      hud.toast('Armada gagal dimuat, tetap pakai yang lama.', 'warn');
    }
  }

  /* ---------- 9. Teardown bersih ---------- */
  window.addEventListener('pagehide', () => {
    try {
      loop?.dispose(); network?.dispose(); traffic?.dispose();
      landmarks?.dispose(); track?.dispose(); skywayTrack?.dispose(); mandalikaTrack?.dispose();
      player?.dispose(); ctx?.dispose(); hud?.dispose();
    } catch {}
  }, { once: true });

  window.__JURAGAN__ = {
    version: GAME.version,
    get state() { return loop?.state; },
    get arena() { return loop?.arena; },
    get stats() { return loop?.stats; },
    connectSupabase: (client, room) => {
      const s = network.connectSupabase(client, room);
      hud.setNetworkStatus(network.status, network.room, network.onlineCount);
      return s;
    },
    modules: { ctx, track, skywayTrack, mandalikaTrack, landmarks, player, traffic, network, loop, hud },
  };
}
