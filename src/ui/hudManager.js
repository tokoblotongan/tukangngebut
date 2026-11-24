/* =====================================================================
   hudManager.js — Antarmuka Juragan Ngebut: layar muat, menu Start
   terpusat (Armada, Kamar Mabar Supabase, Tingkat Ngebut), HUD balapan
   ultra-bersih (Klasemen 1st–4th ikonik + badge koin kiri-atas, rail
   START→FINISH kanan, counter melayang di atas kendaraan, audio/pause
   minimal), Podium Juara animasi, dan mesin audio WebAudio + Telolet Basuri.
   ===================================================================== */
import { VEHICLES, ARENAS, GAME, PALETTE as P } from '../config/gameConfig.js';
import { PUBLIC_ROOMS, normalizeRoomId } from '../network/multiplayerHook.js';
import { createTeloletSynthesizer } from '../audio/soundManager.js';
import { createBackgroundMusic } from '../audio/backgroundMusic.js';

const EMOJI = { angkot: '🚐', bemo: '🛺', l300: '🛻', ojol: '🏍️' };
const DIFFS = [
  { id: 'santai', label: 'Santai', note: '5 nyawa • skor ×0.8', emoji: '🌤️' },
  { id: 'normal', label: 'Normal', note: '3 nyawa • skor ×1.0', emoji: '🔥' },
  { id: 'ngebut', label: 'Ngebut', note: '2 nyawa • skor ×1.35', emoji: '⚡' },
];

function safeGet(key, fallback = null) {
  try {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val;
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

const PROFANITY_SUBSTR = [
  'anjing', 'bangsat', 'bajingan', 'kontol', 'memek', 'jembut', 'ngentot',
  'pepek', 'pelacur', 'jancok', 'jancuk', 'cukimai', 'pukimak', 'goblok',
  'tolol', 'pantek', 'kimak', 'keparat', 'brengsek', 'kampret', 'fuck',
  'bitch', 'nigger', 'nigga', 'cunt', 'penis', 'vagina', 'whore', 'slut',
  'asshole', 'bastard', 'motherfucker',
];
const PROFANITY_WORD_RE = /\b(asu|babi|bego|perek|lonte|setan|tai|taik|cok|idiot|shit|fuck|dick|cock|pussy|porn|sex|slut|ass)\b/i;
const ALLOWED_NAME_RE = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\uFE0F\u200D ]+$/u;

export function isValidPlayerName(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 18) return false;
  if (!ALLOWED_NAME_RE.test(s)) return false;
  const low = s.toLowerCase();
  const compact = low.replace(/[\s0-9]+/g, '');
  if (PROFANITY_WORD_RE.test(low)) return false;
  for (let i = 0; i < PROFANITY_SUBSTR.length; i++) {
    if (low.includes(PROFANITY_SUBSTR[i]) || compact.includes(PROFANITY_SUBSTR[i])) return false;
  }
  return true;
}

const VEHICLE_SVG_PATHS = {
  angkot: (col) => `
    <svg viewBox="0 0 44 24" class="jg-vsvg" aria-hidden="true">
      <rect x="4" y="5" width="33" height="12" rx="3.5" fill="${col}" stroke="#18181b" stroke-width="1.8"/>
      <rect x="9" y="2.2" width="18" height="2.6" rx="1.2" fill="#ffbe0b" stroke="#18181b" stroke-width="1.1"/>
      <path d="M25 7.2h8.5l2.2 4.3H25z" fill="#e0f2fe" stroke="#18181b" stroke-width="1.2"/>
      <rect x="8" y="7.5" width="7" height="4" rx="1" fill="#e0f2fe" stroke="#18181b" stroke-width="1.1"/>
      <rect x="16.5" y="7.5" width="6.5" height="4" rx="1" fill="#e0f2fe" stroke="#18181b" stroke-width="1.1"/>
      <circle cx="12" cy="18.2" r="4" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
      <circle cx="31" cy="18.2" r="4" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
    </svg>`,
  bemo: (col) => `
    <svg viewBox="0 0 44 24" class="jg-vsvg" aria-hidden="true">
      <path d="M7 6h19c3 0 6 2 8 6.2l2.5 4.3H7z" fill="${col}" stroke="#18181b" stroke-width="1.8" stroke-linejoin="round"/>
      <rect x="10" y="8" width="9" height="4.2" rx="1" fill="#fef08a" stroke="#18181b" stroke-width="1.1"/>
      <path d="M21 8h5.5l2.8 4.2H21z" fill="#e0f2fe" stroke="#18181b" stroke-width="1.1"/>
      <circle cx="13" cy="18.2" r="3.9" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
      <circle cx="32.5" cy="18.2" r="3.9" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
    </svg>`,
  l300: (col) => `
    <svg viewBox="0 0 44 24" class="jg-vsvg" aria-hidden="true">
      <rect x="4" y="10.5" width="18" height="6.5" rx="1.5" fill="${col}" stroke="#18181b" stroke-width="1.8"/>
      <path d="M22 5.2h10.5l4.2 5.3V17H22z" fill="${col}" stroke="#18181b" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M24.2 7.2h6.8l2.6 3.5h-9.4z" fill="#e0f2fe" stroke="#18181b" stroke-width="1.1"/>
      <circle cx="12" cy="18.2" r="4" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
      <circle cx="32" cy="18.2" r="4" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
    </svg>`,
  ojol: (col) => `
    <svg viewBox="0 0 44 24" class="jg-vsvg" aria-hidden="true">
      <path d="M10 15.5l8-4.5h9l6 4.5" fill="none" stroke="${col}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 15.5l8-4.5h9l6 4.5" fill="none" stroke="#18181b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="21" cy="6.2" r="3.6" fill="#2ec4b6" stroke="#18181b" stroke-width="1.4"/>
      <path d="M18 11.2l4.5-2.6" stroke="#18181b" stroke-width="3" stroke-linecap="round"/>
      <circle cx="11.5" cy="17.8" r="4.1" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
      <circle cx="32.5" cy="17.8" r="4.1" fill="#18181b" stroke="#fff8eb" stroke-width="1.3"/>
    </svg>`,
};

function vehicleSvg(type, color = '#ff6b00') {
  const fn = VEHICLE_SVG_PATHS[type] || VEHICLE_SVG_PATHS.angkot;
  return fn(color);
}

export function createHUD(opts = {}) {
  injectStyles();
  const root = document.body;
  const wrap = document.createElement('div');
  wrap.id = 'jg-root';
  wrap.innerHTML = TEMPLATE();
  root.appendChild(wrap);

  const $ = (id) => wrap.querySelector(`#${id}`);
  const el = {
    loader: $('jg-loader'), loadFill: $('jg-load-fill'), loadStatus: $('jg-load-status'),
    fatal: $('jg-fatal'), fatalMsg: $('jg-fatal-msg'),
    menu: $('jg-menu'), arenas: $('jg-arenas'), arenaBadge: $('jg-arena-badge'),
    fleet: $('jg-fleet'), diffs: $('jg-diffs'), diffNote: $('jg-diff-note'),
    rooms: $('jg-rooms'), roomActive: $('jg-room-active'),
    roomInput: /** @type {HTMLInputElement | null} */ ($('jg-room-input')),
    roomJoin: $('jg-room-join'),
    nameInput: /** @type {HTMLInputElement | null} */ ($('jg-name-input')),
    bestMenu: $('jg-best-menu'), btnStart: $('jg-start'),
    kidModeToggle: /** @type {HTMLInputElement | null} */ ($('jg-kid-mode')),
    noOverToggle: /** @type {HTMLInputElement | null} */ ($('jg-no-gameover')),
    noOverWrap: $('jg-no-gameover-wrap'),
    hud: $('jg-hud'),
    coins: $('jg-coins'), coinsWrap: $('jg-coins-wrap'),
    hearts: $('jg-hearts'),
    countdown: $('jg-countdown'),
    lapTimer: $('jg-lap-timer'),
    lb: $('jg-lb'),
    minimap: /** @type {HTMLCanvasElement | null} */ ($('jg-minimap')),
    speedVal: $('jg-speed-val'), speedArc: $('jg-speed-arc'), boostFill: $('jg-boost-fill'), boostWrap: $('jg-boost-wrap'),
    overhead: $('jg-overhead'), overheadCrown: $('jg-overhead-crown'), overheadCoins: $('jg-overhead-coins'),
    toasts: $('jg-toasts'), netMenu: $('jg-net-menu'),
    pause: $('jg-pause'), over: $('jg-over'), podium: $('jg-podium'),
    progressDots: $('jg-progress-dots'),
    overScore: $('jg-over-score'), overDist: $('jg-over-dist'), overRolls: $('jg-over-rolls'),
    overCoins: $('jg-over-coins'), overBest: $('jg-over-best'), overRecord: $('jg-over-record'), overTitle: $('jg-over-title'),
    btnOverContinue: $('jg-over-continue'), btnOverRestart: $('jg-over-restart'),
    btnAudio: $('jg-audio'), btnAudioMenu: $('jg-audio-menu'), btnAudioPause: $('jg-audio-pause'),
    btnMusicMenu: $('jg-music-menu'), btnMusicPause: $('jg-music-pause'),
    btnHelpMenu: $('jg-help-menu'), btnHelpHud: $('jg-help-btn'),
    btnQuality: $('jg-quality'), qualityGroup: $('jg-quality-group'), qualityBadge: $('jg-quality-badge'), btnPause: $('jg-pause-btn'),
    padL: $('jg-pad-l'), padR: $('jg-pad-r'), telolet: $('jg-telolet'), crashFlash: $('jg-crash'),
    speedLines: /** @type {HTMLCanvasElement | null} */ ($('jg-speedlines')),
  };

  /* Prebuild 4 baris klasemen kiri-atas agar update frame zero-thrash */
  const lbRows = [];
  if (el.lb) {
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'jg-lb-row';
      row.innerHTML = `<span class="jg-lb-pos"></span><span class="jg-lb-ico"></span><span class="jg-lb-name"></span>`;
      row.style.display = 'none';
      el.lb.appendChild(row);
      lbRows.push({
        row,
        pos: row.querySelector('.jg-lb-pos'),
        ico: row.querySelector('.jg-lb-ico'),
        name: row.querySelector('.jg-lb-name'),
        lastSig: '',
      });
    }
  }

  /* ---------- Edge Speed Lines Canvas & Reduced Motion ---------- */
  const motionQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
  const speedCtx = el.speedLines?.getContext('2d') || null;
  const speedStreaks = Array.from({ length: 34 }, (_, i) => ({
    angle: (i / 34) * Math.PI * 2 + (i % 3) * 0.05,
    offset: Math.random(),
    speed: 1.8 + (i % 5) * 0.45,
    width: 1.5 + (i % 3) * 1.1,
    hot: i % 2 === 0,
  }));
  function resizeSpeedLines() {
    if (!el.speedLines) return;
    el.speedLines.width = window.innerWidth;
    el.speedLines.height = window.innerHeight;
  }
  function clearSpeedLines() {
    if (!speedCtx || !el.speedLines) return;
    speedCtx.clearRect(0, 0, el.speedLines.width, el.speedLines.height);
  }
  function drawSpeedLines(intensity, isTurbo) {
    if (!speedCtx || !el.speedLines) return;
    if (!appliedHd || motionQuery?.matches) { clearSpeedLines(); return; }
    const w = el.speedLines.width, h = el.speedLines.height;
    if (!w || !h || intensity <= 0.02) { clearSpeedLines(); return; }
    speedCtx.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.48;
    const maxR = Math.hypot(cx, cy);
    const innerR = Math.min(w, h) * (isTurbo ? 0.37 : 0.43);
    const t = performance.now() * 0.001;
    for (let i = 0; i < speedStreaks.length; i++) {
      const st = speedStreaks[i];
      const prog = (st.offset + t * st.speed * (isTurbo ? 2.1 : 1.15)) % 1;
      const r0 = innerR + prog * (maxR - innerR) * 0.55;
      const r1 = r0 + (45 + prog * 140) * (isTurbo ? 1.35 : 0.85);
      const cos = Math.cos(st.angle), sin = Math.sin(st.angle);
      const alpha = intensity * (1 - prog * 0.6) * (isTurbo ? 0.58 : 0.34);
      speedCtx.strokeStyle = st.hot
        ? (isTurbo ? `rgba(255, 190, 11, ${alpha})` : `rgba(255, 255, 255, ${alpha * 0.8})`)
        : (isTurbo ? `rgba(255, 107, 0, ${alpha})` : `rgba(144, 224, 239, ${alpha * 0.85})`);
      speedCtx.lineWidth = st.width * (isTurbo ? 1.4 : 1);
      speedCtx.beginPath();
      speedCtx.moveTo(cx + cos * r0, cy + sin * r0);
      speedCtx.lineTo(cx + cos * r1, cy + sin * r1);
      speedCtx.stroke();
    }
  }
  resizeSpeedLines();

  const minimapCtx = el.minimap?.getContext('2d') || null;
  let minimapCssW = 120;
  let minimapCssH = 120;
  function resizeMinimap() {
    if (!el.minimap || !minimapCtx) return;
    const rect = el.minimap.getBoundingClientRect();
    const cssW = Math.round(rect.width) || (window.innerWidth <= 720 ? 96 : 120);
    const cssH = Math.round(rect.height) || cssW;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (el.minimap.width !== bw || el.minimap.height !== bh) {
      el.minimap.width = bw;
      el.minimap.height = bh;
    }
    minimapCssW = cssW;
    minimapCssH = cssH;
    minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeMinimap();
  const onWindowResize = () => {
    resizeSpeedLines();
    resizeMinimap();
  };
  window.addEventListener('resize', onWindowResize);

  function drawMinimap(pts, racers, playerPos, mode = 'radar') {
    if (!minimapCtx || !el.minimap) return;
    const w = minimapCssW, h = minimapCssH;
    const cx = w * 0.5, cy = h * 0.5, rad = w * 0.46;
    minimapCtx.clearRect(0, 0, w, h);

    minimapCtx.save();
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, rad, 0, Math.PI * 2);
    minimapCtx.fillStyle = 'rgba(15, 23, 42, 0.58)';
    minimapCtx.fill();
    minimapCtx.lineWidth = 2;
    minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    minimapCtx.stroke();
    minimapCtx.clip();

    // Subtle radar crosshair
    minimapCtx.strokeStyle = 'rgba(255,255,255,0.09)';
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx, 6); minimapCtx.lineTo(cx, h - 6);
    minimapCtx.moveTo(6, cy); minimapCtx.lineTo(w - 6, cy);
    minimapCtx.stroke();

    let mapX, mapY;
    if (mode === 'circuit' && Array.isArray(pts) && pts.length > 2) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
      const spanX = Math.max(10, maxX - minX);
      const spanZ = Math.max(10, maxZ - minZ);
      const midX = (minX + maxX) * 0.5;
      const midZ = (minZ + maxZ) * 0.5;
      const s = (rad * 1.48) / Math.max(spanX, spanZ);
      mapX = (wx) => cx + (wx - midX) * s;
      mapY = (wz) => cy + (wz - midZ) * s;

      minimapCtx.lineCap = 'round';
      minimapCtx.lineJoin = 'round';

      // Dark backing outline
      minimapCtx.beginPath();
      minimapCtx.moveTo(mapX(pts[0].x), mapY(pts[0].z));
      for (let i = 1; i < pts.length; i++) minimapCtx.lineTo(mapX(pts[i].x), mapY(pts[i].z));
      minimapCtx.closePath();
      minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
      minimapCtx.lineWidth = 6.2;
      minimapCtx.stroke();

      // Colored sectors around the 17-turn loop
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % pts.length];
        const zn = p0.zone || '';
        minimapCtx.strokeStyle = zn === 'boost'
          ? 'rgba(56, 189, 248, 0.95)'
          : zn === 'banked'
            ? 'rgba(253, 224, 71, 0.94)'
            : zn === 'bridgeSplit'
              ? 'rgba(251, 146, 60, 0.95)'
              : 'rgba(255, 107, 0, 0.92)';
        minimapCtx.lineWidth = 3.6;
        minimapCtx.beginPath();
        minimapCtx.moveTo(mapX(p0.x), mapY(p0.z));
        minimapCtx.lineTo(mapX(p1.x), mapY(p1.z));
        minimapCtx.stroke();
      }

      // Start/Finish marker
      const sx = mapX(pts[0].x), sy = mapY(pts[0].z);
      minimapCtx.fillStyle = '#ffffff';
      minimapCtx.fillRect(sx - 3, sy - 3, 6, 6);
      minimapCtx.fillStyle = '#111827';
      minimapCtx.fillRect(sx - 2, sy - 2, 2, 2);
      minimapCtx.fillRect(sx, sy, 2, 2);
    } else {
      const px = playerPos?.x ?? 0;
      const pz = playerPos?.z ?? 0;
      const scale = 0.58;
      mapX = (wx) => cx + (wx - px) * scale;
      mapY = (wz) => (h * 0.72) + (wz - pz) * scale;

      if (Array.isArray(pts) && pts.length > 1) {
        minimapCtx.lineCap = 'round';
        minimapCtx.lineJoin = 'round';
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1], p1 = pts[i];
          const isLower = (p1.y ?? 0) < 2.5;
          minimapCtx.strokeStyle = isLower ? 'rgba(255, 190, 11, 0.85)' : 'rgba(56, 189, 248, 0.88)';
          minimapCtx.lineWidth = 5.5;
          minimapCtx.beginPath();
          minimapCtx.moveTo(mapX(p0.x), mapY(p0.z));
          minimapCtx.lineTo(mapX(p1.x), mapY(p1.z));
          minimapCtx.stroke();
        }
      }
    }

    if (Array.isArray(racers)) {
      for (let i = 0; i < racers.length; i++) {
        const r = racers[i];
        const rx = Math.max(8, Math.min(w - 8, mapX(r.x ?? 0)));
        const ry = Math.max(8, Math.min(h - 8, mapY(r.z ?? 0)));
        minimapCtx.beginPath();
        minimapCtx.arc(rx, ry, r.isPlayer ? 5.0 : 3.6, 0, Math.PI * 2);
        minimapCtx.fillStyle = r.color || '#ff2a4b';
        minimapCtx.fill();
        minimapCtx.lineWidth = r.isPlayer ? 2 : 1.2;
        minimapCtx.strokeStyle = '#ffffff';
        minimapCtx.stroke();
      }
    }
    minimapCtx.restore();
  }

  const input = { left: false, right: false };
  const sfx = createAudioEngine(() => pulseTeloletBtn());
  let muted = safeGet('jg_muted') === '1';
  let musicEnabled = safeGet('tn_music', '1') !== '0';
  let hd = safeGet('tn_quality') === 'normal';
  let appliedHd = hd;
  let inputLocked = false;
  let selectedArena = safeGet('jg_arena') || 'salatiga';
  if (!ARENAS[selectedArena]) selectedArena = 'salatiga';
  let selectedVehicle = safeGet('jg_vehicle') || 'angkot';
  if (!VEHICLES[selectedVehicle]) selectedVehicle = 'angkot';
  let selectedDiff = safeGet('jg_diff') || 'santai';
  if (!DIFFS.some((d) => d.id === selectedDiff)) selectedDiff = 'santai';
  let kidMode = safeGet('jg_kid_mode', '1') !== '0';
  let noGameOver = safeGet('jg_no_gameover', kidMode ? '1' : '0') === '1';
  let selectedRoom = normalizeRoomId(safeGet('jg_room') || 'salatiga-1');
  let lobbyCounts = {};

  /* ---------- Kartu Arena ---------- */
  for (const [key, def] of Object.entries(ARENAS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jg-arena-card';
    b.dataset.key = key;
    b.innerHTML = `
      <span class="jg-arena-em">${def.emoji}</span>
      <span class="jg-arena-meta">
        <span class="jg-arena-top"><strong>${def.label}</strong><em class="jg-arena-badge ${key === 'mandalika' ? 'new-hot' : key === 'skyway' ? 'new' : ''}">${def.badge}</em></span>
        <span class="jg-arena-desc">${def.desc}</span>
      </span>
      <span class="jg-card-check">✓</span>`;
    b.addEventListener('click', () => {
      selectedArena = key;
      safeSet('jg_arena', key);
      paintArenas(); sfx.ui();
      opts.onSelectArena?.(key);
    });
    el.arenas?.appendChild(b);
  }
  function paintArenas() {
    el.arenas?.querySelectorAll('.jg-arena-card').forEach((c) => {
      const node = /** @type {HTMLElement} */ (c);
      node.classList.toggle('on', node.dataset.key === selectedArena);
    });
    if (el.arenaBadge) {
      const def = ARENAS[selectedArena] || ARENAS.salatiga;
      el.arenaBadge.textContent = `${def.emoji} ${def.shortLabel}`;
    }
  }
  paintArenas();

  /* ---------- Kartu armada ---------- */
  for (const [key, def] of Object.entries(VEHICLES)) {
    const b = document.createElement('button');
    b.className = 'jg-card';
    b.dataset.key = key;
    b.innerHTML = `
      <span class="jg-card-em">${EMOJI[key]}</span>
      <span class="jg-card-name">${def.label}</span>
      <span class="jg-card-tag">${def.tagline}</span>
      <span class="jg-bars">
        ${bar('KCP', def.stats.speed, 'var(--jg-red)')}
        ${bar('AKS', def.stats.accel, 'var(--jg-orange)')}
        ${bar('GRP', def.stats.grip, 'var(--jg-green)')}
      </span>
      <span class="jg-card-check">✓</span>`;
    b.addEventListener('click', () => {
      selectedVehicle = key;
      safeSet('jg_vehicle', key);
      paintFleet(); sfx.ui();
      opts.onSelectVehicle?.(key);
    });
    el.fleet.appendChild(b);
  }
  function bar(lbl, v, col) {
    return `<span class="jg-bar"><i>${lbl}</i><b><u style="width:${v * 10}%;background:${col}"></u></b></span>`;
  }
  function paintFleet() {
    el.fleet.querySelectorAll('.jg-card').forEach((c) => c.classList.toggle('on', c.dataset.key === selectedVehicle));
  }

  /* ---------- Difficulty ---------- */
  for (const d of DIFFS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jg-diff'; b.dataset.key = d.id;
    b.innerHTML = `<span>${d.emoji}</span>${d.label}`;
    b.addEventListener('click', () => {
      selectedDiff = d.id;
      safeSet('jg_diff', d.id);
      paintDiff(); sfx.ui();
      opts.onDifficulty?.(d.id);
    });
    el.diffs.appendChild(b);
  }
  function paintDiff() {
    el.diffs.querySelectorAll('.jg-diff').forEach((c) => c.classList.toggle('on', c.dataset.key === selectedDiff));
    el.diffNote.textContent = DIFFS.find((d) => d.id === selectedDiff).note;
  }
  paintFleet(); paintDiff();

  /* ---------- Mode Anak & Tanpa Game Over ---------- */
  function paintKidMode() {
    if (el.kidModeToggle) el.kidModeToggle.checked = kidMode;
    if (el.noOverToggle) el.noOverToggle.checked = noGameOver;
    if (el.noOverWrap) el.noOverWrap.classList.toggle('dim', !kidMode);
  }
  el.kidModeToggle?.addEventListener('change', () => {
    kidMode = !!el.kidModeToggle?.checked;
    safeSet('jg_kid_mode', kidMode ? '1' : '0');
    if (kidMode) {
      selectedDiff = 'santai';
      safeSet('jg_diff', 'santai');
      paintDiff();
      opts.onDifficulty?.('santai');
      noGameOver = true;
    } else {
      noGameOver = false;
    }
    safeSet('jg_no_gameover', noGameOver ? '1' : '0');
    paintKidMode();
    sfx.setMusicKidsMode(kidMode);
    sfx.ui();
    opts.onKidModeChange?.({ kidMode, noGameOver });
  });
  el.noOverToggle?.addEventListener('change', () => {
    noGameOver = !!el.noOverToggle?.checked;
    safeSet('jg_no_gameover', noGameOver ? '1' : '0');
    paintKidMode();
    sfx.setMusicKidsMode(kidMode);
    sfx.ui();
    opts.onKidModeChange?.({ kidMode, noGameOver });
  });
  paintKidMode();

  /* ---------- Kamar Mabar (Public & Private Room + Nama Juragan) ---------- */
  for (const rm of PUBLIC_ROOMS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jg-room-btn';
    b.dataset.room = rm.id;
    b.innerHTML = `<span class="jg-room-name">${rm.label} <small>(${rm.tag})</small></span><span class="jg-room-cnt">0 pemain</span>`;
    b.addEventListener('click', () => {
      selectRoom(rm.id);
      sfx.ui();
    });
    el.rooms?.appendChild(b);
  }
  function paintRooms() {
    el.rooms?.querySelectorAll('.jg-room-btn').forEach((btn) => {
      const node = /** @type {HTMLElement} */ (btn);
      const rid = node.dataset.room || '';
      node.classList.toggle('on', rid === selectedRoom);
      const cntNode = node.querySelector('.jg-room-cnt');
      const cnt = lobbyCounts[rid] || 0;
      if (cntNode) cntNode.textContent = cnt > 0 ? `${cnt} online` : 'Kosong';
    });
    const isPublic = PUBLIC_ROOMS.some((r) => r.id === selectedRoom);
    if (el.roomActive) {
      el.roomActive.textContent = `${isPublic ? '🌐' : '🔒'} ${selectedRoom.toUpperCase()}`;
    }
  }
  function selectRoom(rawId) {
    selectedRoom = normalizeRoomId(rawId);
    safeSet('jg_room', selectedRoom);
    paintRooms();
    opts.onRoomChange?.(selectedRoom);
  }
  function joinPrivateRoom() {
    const val = el.roomInput?.value || '';
    if (!val.trim()) return;
    selectRoom(val);
    sfx.ui();
    if (el.roomInput) el.roomInput.value = '';
  }
  el.roomJoin?.addEventListener('click', joinPrivateRoom);
  el.roomInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); joinPrivateRoom(); }
  });

  let lastValidName = '';
  if (el.nameInput) {
    const savedName = safeGet('jg_player_name', '');
    if (savedName && isValidPlayerName(savedName)) {
      el.nameInput.value = savedName.trim().slice(0, 18);
      lastValidName = el.nameInput.value;
    }
    const commitName = () => {
      const raw = (el.nameInput?.value || '').trim().slice(0, 18);
      if (!raw) {
        if (lastValidName && el.nameInput) el.nameInput.value = lastValidName;
        return;
      }
      if (!isValidPlayerName(raw)) {
        api.toast('Nama tidak boleh dipakai', 'bad');
        if (el.nameInput) el.nameInput.value = lastValidName;
        return;
      }
      lastValidName = raw;
      opts.onNameChange?.(raw);
    };
    el.nameInput.addEventListener('change', commitName);
    el.nameInput.addEventListener('blur', commitName);
    el.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.nameInput?.blur(); }
    });
  }
  paintRooms();

  /* ---------- Tombol ---------- */
  el.btnStart.addEventListener('click', () => { sfx.resume(); sfx.ui(); opts.onStart?.(); });
  el.btnPause.addEventListener('click', () => { sfx.ui(); opts.onPause?.(); });
  $('jg-resume').addEventListener('click', () => { sfx.ui(); opts.onResume?.(); });
  $('jg-pause-restart').addEventListener('click', () => { sfx.ui(); opts.onRestart?.(); });
  $('jg-pause-menu').addEventListener('click', () => { sfx.ui(); opts.onMenu?.(); });
  $('jg-over-continue')?.addEventListener('click', () => { sfx.ui(); opts.onContinue?.(); });
  $('jg-over-restart').addEventListener('click', () => { sfx.ui(); opts.onRestart?.(); });
  $('jg-over-menu').addEventListener('click', () => { sfx.ui(); opts.onMenu?.(); });
  $('jg-fatal-reload').addEventListener('click', () => location.reload());

  function paintAudio() {
    const icon = muted ? '🔇' : '🔊';
    for (const b of [el.btnAudio, el.btnAudioMenu, el.btnAudioPause]) {
      if (!b) continue;
      b.textContent = icon;
      b.setAttribute('aria-pressed', String(!muted));
      b.title = muted ? 'Nyalakan suara (M)' : 'Bisukan suara (M)';
    }
  }
  function toggleAudio() {
    muted = !muted;
    safeSet('jg_muted', muted ? '1' : '0');
    if (!muted) sfx.resume();
    sfx.setMuted(muted); paintAudio();
    if (!muted) sfx.ui();
    opts.onAudio?.(!muted);
  }
  for (const b of [el.btnAudio, el.btnAudioMenu, el.btnAudioPause]) b?.addEventListener('click', toggleAudio);
  function paintMusic() {
    if (el.btnMusicMenu) {
      el.btnMusicMenu.textContent = musicEnabled ? '🎵 Musik' : '🎵 Musik Off';
      el.btnMusicMenu.setAttribute('aria-pressed', String(musicEnabled));
      el.btnMusicMenu.title = musicEnabled ? 'Matikan musik latar' : 'Nyalakan musik latar';
    }
    if (el.btnMusicPause) {
      el.btnMusicPause.textContent = musicEnabled ? '🎵 Musik: ON' : '🎵 Musik: OFF';
      el.btnMusicPause.setAttribute('aria-pressed', String(musicEnabled));
      el.btnMusicPause.title = musicEnabled ? 'Matikan musik latar' : 'Nyalakan musik latar';
    }
  }
  function toggleMusic() {
    musicEnabled = !musicEnabled;
    safeSet('tn_music', musicEnabled ? '1' : '0');
    if (musicEnabled) sfx.resume();
    sfx.setMusicEnabled(musicEnabled);
    paintMusic();
    sfx.ui();
  }
  for (const b of [el.btnMusicMenu, el.btnMusicPause]) b?.addEventListener('click', toggleMusic);
  for (const b of [el.btnHelpMenu, el.btnHelpHud]) b?.addEventListener('click', () => { sfx.ui(); opts.onHelp?.(); });
  sfx.setMuted(muted); paintAudio();
  sfx.setMusicEnabled(musicEnabled); sfx.setMusicKidsMode(kidMode); paintMusic();

  function paintQualityUI() {
    if (el.btnQuality) {
      el.btnQuality.textContent = hd ? '✨ Grafik: Normal' : '🌿 Grafik: ECO (Ringan)';
      el.btnQuality.setAttribute('aria-pressed', String(!hd));
    }
    if (el.qualityBadge) {
      el.qualityBadge.textContent = hd ? '✨ Normal' : '🌿 ECO (Ringan)';
    }
    el.qualityGroup?.querySelectorAll('.jg-quality-btn').forEach((btn) => {
      const node = /** @type {HTMLElement} */ (btn);
      const isActive = (node.dataset.quality === 'normal') === hd;
      node.classList.toggle('on', isActive);
      node.setAttribute('aria-pressed', String(isActive));
    });
  }
  function selectQuality(isHigh) {
    hd = !!isHigh;
    safeSet('tn_quality', hd ? 'normal' : 'eco');
    paintQualityUI();
    sfx.ui();
    opts.onQuality?.(hd);
  }
  el.btnQuality?.addEventListener('click', () => selectQuality(!hd));
  el.qualityGroup?.querySelectorAll('.jg-quality-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const node = /** @type {HTMLElement} */ (btn);
      selectQuality(node.dataset.quality === 'normal');
    });
  });
  paintQualityUI();

  /* ---------- Kontrol sentuh ---------- */
  function bindPad(node, side) {
    const on = (e) => { e.preventDefault(); input[side] = true; node.classList.add('on'); node.setPointerCapture?.(e.pointerId); sfx.resume(); };
    const off = () => { input[side] = false; node.classList.remove('on'); };
    node.addEventListener('pointerdown', on);
    node.addEventListener('pointerup', off);
    node.addEventListener('pointercancel', off);
    node.addEventListener('pointerleave', off);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindPad(el.padL, 'left'); bindPad(el.padR, 'right');

  function pulseTeloletBtn() {
    if (!el.telolet) return;
    el.telolet.classList.remove('honk');
    void el.telolet.offsetWidth;
    el.telolet.classList.add('honk');
  }
  function triggerTelolet() {
    if (inputLocked) return false;
    sfx.resume();
    return sfx.playTeloletHorn();
  }
  el.telolet?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    triggerTelolet();
  });
  el.telolet?.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      triggerTelolet();
    }
  });
  el.telolet?.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- Cache nilai agar tidak thrash DOM ---------- */
  const last = {};
  function setText(node, key, val) { if (node && last[key] !== val) { last[key] = val; node.textContent = val; } }

  let toastSeq = 0;
  let countdownTimeout = null;
  let prevHearts = null;

  function renderHearts(heartsVal, maxHeartsVal, noOver) {
    if (!el.hearts) return;
    const maxH = Math.max(1, Math.round(maxHeartsVal || 5));
    const curH = Math.max(0, Math.min(maxH, Math.round(heartsVal ?? maxH)));
    const sig = `${curH}|${maxH}|${noOver ? 1 : 0}`;
    if (last.heartsSig === sig) return;

    const decreased = prevHearts !== null && curH < prevHearts;
    prevHearts = curH;
    last.heartsSig = sig;

    while (el.hearts.children.length < maxH) {
      const sp = document.createElement('span');
      sp.className = 'jg-heart';
      sp.textContent = '❤️';
      el.hearts.appendChild(sp);
    }
    while (el.hearts.children.length > maxH) {
      el.hearts.lastChild?.remove();
    }
    for (let i = 0; i < maxH; i++) {
      const sp = /** @type {HTMLElement} */ (el.hearts.children[i]);
      const alive = i < curH;
      sp.classList.toggle('lost', !alive);
      sp.textContent = alive ? '❤️' : (noOver ? '🛡️' : '🤍');
    }
    if (decreased) {
      el.hearts.classList.remove('hurt');
      void el.hearts.offsetWidth;
      el.hearts.classList.add('hurt');
    }
  }

  const api = {
    input, sfx, triggerTelolet,
    get arena() { return selectedArena; },
    get vehicle() { return selectedVehicle; },
    get difficulty() { return selectedDiff; },
    get room() { return selectedRoom; },
    get kidMode() { return kidMode; },
    get noGameOver() { return noGameOver; },

    setQualityUI(isHigh) {
      hd = !!isHigh;
      paintQualityUI();
    },
    setAppliedQuality(isHigh) {
      appliedHd = !!isHigh;
      if (!appliedHd) clearSpeedLines();
    },
    setInputLocked(locked) {
      inputLocked = !!locked;
      if (inputLocked) {
        input.left = false;
        input.right = false;
        el.padL?.classList.remove('on');
        el.padR?.classList.remove('on');
      }
      el.telolet?.classList.toggle('locked', inputLocked);
    },
    showCountdown(label) {
      if (!el.countdown) return;
      if (countdownTimeout) {
        clearTimeout(countdownTimeout);
        countdownTimeout = null;
      }
      el.countdown.textContent = String(label || '');
      el.countdown.classList.toggle('go', label === 'GO!');
      el.countdown.classList.remove('show', 'anim');
      void el.countdown.offsetWidth;
      el.countdown.classList.add('show', 'anim');
      const dur = label === 'GO!' ? 720 : 940;
      countdownTimeout = setTimeout(() => {
        el.countdown?.classList.remove('show', 'anim');
        countdownTimeout = null;
      }, dur);
    },
    hideCountdown() {
      if (countdownTimeout) {
        clearTimeout(countdownTimeout);
        countdownTimeout = null;
      }
      el.countdown?.classList.remove('show', 'anim', 'go');
    },

    setLoading(ratio, text) {
      el.loadFill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
      if (text) el.loadStatus.textContent = text;
    },
    hideLoading() {
      el.loader.classList.add('done');
      setTimeout(() => el.loader.remove(), 800);
    },
    showFatal(msg) {
      el.fatalMsg.textContent = msg;
      el.fatal.classList.add('show');
      el.loader.classList.add('done');
    },

    showMenu(best) {
      clearSpeedLines();
      api.hideCountdown();
      api.setInputLocked(false);
      prevHearts = null;
      el.menu.classList.add('show');
      el.hud.classList.remove('show');
      el.toasts?.classList.remove('in-race');
      el.pause.classList.remove('show');
      el.over.classList.remove('show');
      if (el.overhead) el.overhead.classList.remove('show');
      el.bestMenu.textContent = `🏆 Rekor: ${Math.round(best).toLocaleString('id-ID')}`;
      paintArenas();
      paintFleet();
    },
    hideMenu() { el.menu.classList.remove('show'); },
    showHUD() {
      el.hud.classList.add('show');
      el.toasts?.classList.add('in-race');
      resizeMinimap();
    },
    hideHUD() {
      clearSpeedLines();
      api.hideCountdown();
      if (el.overhead) el.overhead.classList.remove('show');
      el.hud.classList.remove('show');
      el.toasts?.classList.remove('in-race');
    },

    updateHUD(s) {
      /* 1. Badge Koin / Buah, Nyawa ❤️ & Lap/Timer Kompak di Kiri-Atas */
      const coinVal = Math.round(s.coins ?? 0);
      if (last.coinsNum !== coinVal) {
        if (last.coinsNum !== undefined && coinVal > last.coinsNum && el.coinsWrap) {
          el.coinsWrap.classList.remove('pop');
          void el.coinsWrap.offsetWidth;
          el.coinsWrap.classList.add('pop');
        }
        last.coinsNum = coinVal;
      }
      setText(el.coins, 'coins', coinVal.toLocaleString('id-ID'));

      renderHearts(s.hearts, s.maxHearts, s.noGameOver);

      if (el.lapTimer) {
        const lapNo = s.lapNumber || 1;
        const distM = Math.min(s.lapGoal || 1500, Math.round(s.distance || 0));
        const goalM = Math.round(s.lapGoal || 1500);
        const rt = Math.max(0, s.raceTime || 0);
        const mins = Math.floor(rt / 60);
        const secs = (rt % 60).toFixed(1).padStart(4, '0');
        const txt = `LAP ${lapNo} · ${distM}/${goalM}m · ${String(mins).padStart(2, '0')}:${secs}`;
        setText(el.lapTimer, 'lapTimer', txt);
      }

      /* 2. Klasemen Langsung 1st–4th dengan ikon kendaraan & mahkota P1 */
      const standings = Array.isArray(s.standings) ? s.standings : [];
      for (let i = 0; i < lbRows.length; i++) {
        const slot = lbRows[i];
        const r = standings[i];
        if (!r) {
          slot.row.style.display = 'none';
          continue;
        }
        slot.row.style.display = '';
        const posNum = i + 1;
        const posLabel = posNum === 1 ? '👑' : `${posNum}`;
        const shortName = r.isPlayer ? 'KAMU' : String(r.name || 'AI').replace(/^AI\s*•\s*/i, '').slice(0, 10);
        const sig = `${posNum}|${r.type}|${r.slotColor}|${shortName}|${!!r.isPlayer}`;
        if (slot.lastSig !== sig) {
          slot.lastSig = sig;
          slot.row.className = `jg-lb-row pos-${posNum}${r.isPlayer ? ' me' : ''}`;
          if (slot.pos) slot.pos.textContent = posLabel;
          if (slot.ico) slot.ico.innerHTML = vehicleSvg(r.type, r.slotColor || '#ff6b00');
          if (slot.name) slot.name.textContent = shortName;
        }
      }

      /* 3. Speedometer Digital Melengkung + Bar Boost di Kanan-Bawah */
      const kmh = Math.round((s.speed || 0) * 4.4);
      setText(el.speedVal, 'speedVal', String(kmh));
      const arcFill = Math.max(0, Math.min(1, s.speedRatio || 0));
      if (el.speedArc) {
        const maxDash = 118;
        el.speedArc.style.strokeDashoffset = String((maxDash * (1 - arcFill)).toFixed(1));
      }
      const turboFrac = Math.max(0, Math.min(1, s.turbo || 0));
      if (el.boostFill) {
        el.boostFill.style.width = `${Math.round((turboFrac > 0 ? turboFrac : arcFill * 0.55) * 100)}%`;
      }
      el.boostWrap?.classList.toggle('turbo', turboFrac > 0);

      /* 4. Minimap Bundar Transparan di Kiri-Bawah */
      if (s.minimapPts && s.minimapRacers) {
        drawMinimap(s.minimapPts, s.minimapRacers, s.playerPos, s.minimapMode || 'radar');
      }

      /* 5. Penghitung koin/buah & mahkota melayang tepat di atas kendaraan player */
      const ov = s.overhead;
      if (el.overhead && ov && ov.visible) {
        el.overhead.classList.add('show');
        el.overhead.classList.toggle('first', !!ov.isFirst);
        el.overhead.style.transform = `translate3d(${Math.round(ov.x)}px, ${Math.round(ov.y)}px, 0) translate(-50%, -100%)`;
        if (el.overheadCrown) el.overheadCrown.style.display = ov.isFirst ? '' : 'none';
        setText(el.overheadCoins, 'ovCoins', String(Math.round(ov.coins ?? coinVal)));
      } else if (el.overhead) {
        el.overhead.classList.remove('show');
      }

      /* 6. Rel Progress Vertikal START -> FINISH di tepi kanan */
      if (el.progressDots && Array.isArray(s.racerMarkers)) {
        const markers = s.racerMarkers;
        while (el.progressDots.children.length < markers.length) {
          const dot = document.createElement('span');
          dot.className = 'jg-prog-dot';
          el.progressDots.appendChild(dot);
        }
        while (el.progressDots.children.length > markers.length) {
          el.progressDots.lastChild?.remove();
        }
        for (let k = 0; k < markers.length; k++) {
          const mk = markers[k];
          const dot = /** @type {HTMLElement} */ (el.progressDots.children[k]);
          dot.style.bottom = `${(Math.max(0, Math.min(1, mk.frac)) * 100).toFixed(1)}%`;
          dot.style.background = mk.color || '#ff2a4b';
          dot.classList.toggle('me', !!mk.isPlayer);
        }
      }

      el.hud.classList.toggle('invuln', s.invuln > 0);
      const isTurbo = s.turbo > 0;
      const lineStrength = isTurbo ? 1 : Math.max(0, (s.speedRatio - 0.72) / 0.28);
      drawSpeedLines(lineStrength, isTurbo);
    },

    setWarnings() {},
    setAirHint() {},
    showStunt() {},

    flashCrash() {
      el.crashFlash.classList.remove('on');
      void el.crashFlash.offsetWidth;
      el.crashFlash.classList.add('on');
    },

    toast(msg, tone = 'info') {
      const t = document.createElement('div');
      t.className = `jg-toast ${tone}`;
      t.textContent = msg;
      el.toasts.appendChild(t);
      const id = ++toastSeq;
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2400);
      while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
      return id;
    },

    setPaused(on) { el.pause.classList.toggle('show', on); },

    showGameOver(r) {
      el.overScore.textContent = Math.round(r.score).toLocaleString('id-ID');
      el.overDist.textContent = `${Math.round(r.distance)} m`;
      el.overRolls.textContent = String(r.rolls);
      el.overCoins.textContent = Math.round(r.coins ?? 0).toLocaleString('id-ID');
      el.overBest.textContent = Math.round(r.best).toLocaleString('id-ID');
      el.overRecord.classList.toggle('show', !!r.newRecord);
      const rank = r.rank || 1;
      if (r.isLapFinish) {
        el.overTitle.textContent = rank === 1
          ? `🏁 JUARA 1 GARIS FINIS!`
          : `🏁 FINIS BABAK ${r.lapNumber || 1} • POSISI #${rank}`;
        if (el.btnOverContinue) {
          el.btnOverContinue.style.display = '';
          el.btnOverContinue.textContent = 'Balapan Berikutnya 🏁';
        }
        el.btnOverRestart?.classList.remove('primary');
      } else {
        el.overTitle.textContent = r.newRecord
          ? 'REKOR BARU, JURAGAN!'
          : rank === 1
            ? (r.arenaId === 'mandalika'
              ? 'JUARA 1 DI MANDALIKA SKY CIRCUIT!'
              : r.arenaId === 'skyway' ? 'JUARA 1 DI NUSANTARA SKYWAY!' : 'JUARA 1 DI SALATIGA!')
            : `FINIS POSISI #${rank}!`;
        if (el.btnOverContinue) el.btnOverContinue.style.display = 'none';
        el.btnOverRestart?.classList.add('primary');
      }
      renderPodium(el.podium, r.standings || []);
      el.over.classList.add('show');
      clearSpeedLines();
      if (el.overhead) el.overhead.classList.remove('show');
      el.hud.classList.remove('show');
    },
    hideGameOver() { el.over.classList.remove('show'); },

    setPlayerName(name) {
      if (el.nameInput && name && !el.nameInput.value && isValidPlayerName(name)) {
        el.nameInput.value = name;
        lastValidName = name;
      }
    },
    setActiveRoom(roomId) {
      selectedRoom = normalizeRoomId(roomId);
      paintRooms();
    },
    setLobbyCounts(counts) {
      lobbyCounts = counts || {};
      paintRooms();
    },
    setNetworkStatus(status, room = selectedRoom, onlineCount = 1) {
      const count = Math.max(1, Math.round(onlineCount || 1));
      const roomLabel = String(room || selectedRoom || 'salatiga-1').toUpperCase();
      const map = {
        solo: [`SOLO • ${roomLabel} (AI)`, 'solo'],
        connecting: [`MENYAMBUNG • ${roomLabel}…`, 'warn'],
        live: [`ONLINE • ${roomLabel} (${count} PEMAIN)`, 'live'],
        offline: [`OFFLINE • ${roomLabel}`, 'warn'],
      };
      const [label, cls] = map[status] || map.solo;
      if (el.netMenu) {
        el.netMenu.className = `jg-net ${cls}`;
        el.netMenu.textContent = `● ${label}`;
      }
      if (room) {
        selectedRoom = normalizeRoomId(room);
        paintRooms();
      }
    },

    setMuted(m) { muted = m; sfx.setMuted(m); paintAudio(); },
    toggleAudio,
    setMusicEnabled(on) {
      musicEnabled = !!on;
      safeSet('tn_music', musicEnabled ? '1' : '0');
      sfx.setMusicEnabled(musicEnabled);
      paintMusic();
    },
    toggleMusic,

    dispose() {
      if (countdownTimeout) clearTimeout(countdownTimeout);
      window.removeEventListener('resize', onWindowResize);
      sfx.dispose();
      wrap.remove();
    },
  };
  return api;
}

/* ==================== Audio sintetis (WebAudio, tanpa file) ==================== */
function createAudioEngine(onHorn) {
  let ac = null, master = null, muted = false, musicEnabled = true;
  let engOsc = null, engSub = null, engGain = null, engFilter = null, roadGain = null, noiseBuf = null;

  const telolet = createTeloletSynthesizer({
    ensureContext: () => (ensure() ? ac : null),
    getMaster: () => master,
    isMuted: () => muted,
  });
  const bgm = createBackgroundMusic({
    ensureContext: () => (ensure() ? ac : null),
    getMaster: () => master,
    isMuted: () => muted || !musicEnabled,
    isMusicEnabled: () => musicEnabled,
  });

  function ensure() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ac = null; return false; }
    return true;
  }
  function resume() { if (ensure() && ac.state === 'suspended') ac.resume().catch(() => {}); }

  function startEngine() {
    if (!ensure() || engOsc) return;
    engFilter = ac.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 620; engFilter.Q.value = 3;
    engGain = ac.createGain(); engGain.gain.value = 0;
    engOsc = ac.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 62;
    engSub = ac.createOscillator(); engSub.type = 'square'; engSub.frequency.value = 31;
    const subG = ac.createGain(); subG.gain.value = 0.35;
    engOsc.connect(engFilter); engSub.connect(subG); subG.connect(engFilter);
    engFilter.connect(engGain); engGain.connect(master);
    const road = ac.createBufferSource(); road.buffer = noiseBuf; road.loop = true;
    const rf = ac.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 900; rf.Q.value = 0.7;
    roadGain = ac.createGain(); roadGain.gain.value = 0;
    road.connect(rf); rf.connect(roadGain); roadGain.connect(master);
    engOsc.start(); engSub.start(); road.start();
  }

  function setEngine(active, ratio = 0, turbo = false) {
    if (active && !engOsc) startEngine();
    if (!ac || !engGain) return;
    const t = ac.currentTime;
    const r = Math.max(0, Math.min(1.4, ratio));
    const f = 58 + r * 128 + (turbo ? 46 : 0);
    engOsc.frequency.setTargetAtTime(f, t, 0.08);
    engSub.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    engFilter.frequency.setTargetAtTime(520 + r * 900 + (turbo ? 500 : 0), t, 0.1);
    engGain.gain.setTargetAtTime(active ? 0.055 + r * 0.05 : 0, t, 0.12);
    roadGain.gain.setTargetAtTime(active ? 0.012 + r * 0.03 : 0, t, 0.15);
  }

  function tone(freq, dur, type = 'sine', vol = 0.25, slideTo = null, delay = 0) {
    if (!ensure() || muted) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol = 0.3, freq = 800, type = 'bandpass') {
    if (!ensure() || muted) return;
    const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  return {
    resume, setEngine,
    ui() { tone(660, 0.07, 'triangle', 0.16); },
    launch() { tone(300, 0.28, 'triangle', 0.22, 720); },
    roll() { tone(420, 0.16, 'sawtooth', 0.12, 640); },
    stunt(rolls) {
      const n = Math.min(4, Math.max(1, rolls));
      for (let i = 0; i < n + 1; i++) tone(523 * Math.pow(1.26, i), 0.16, 'triangle', 0.24, null, i * 0.07);
      noise(0.18, 0.14, 2400, 'highpass');
    },
    land() { tone(120, 0.14, 'sine', 0.3, 60); noise(0.1, 0.12, 400); },
    boost() { tone(240, 0.42, 'sawtooth', 0.22, 1100); noise(0.3, 0.12, 1800, 'highpass'); },
    crash() { noise(0.42, 0.42, 1200, 'lowpass'); tone(150, 0.34, 'square', 0.3, 44); },
    milestone() { tone(784, 0.14, 'triangle', 0.22); tone(1046, 0.22, 'triangle', 0.22, null, 0.11); },
    nearMiss() { tone(1200, 0.07, 'sine', 0.12, 1600); },
    coin(streak = 0) {
      const base = 880 * Math.pow(2, Math.min(12, streak) / 12);
      tone(base, 0.08, 'sine', 0.2);
      tone(base * 1.5, 0.14, 'triangle', 0.22, null, 0.045);
    },
    fruit(streak = 0) {
      const base = 660 * Math.pow(2, Math.min(10, streak) / 12);
      tone(base, 0.1, 'sine', 0.22);
      tone(base * 1.25, 0.12, 'triangle', 0.22, null, 0.05);
      tone(base * 1.5, 0.18, 'sine', 0.24, null, 0.1);
    },
    gem() {
      [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.18, 'triangle', 0.22, null, i * 0.055));
    },
    playTeloletHorn(patternIndex) {
      const ok = telolet.playTeloletHorn(patternIndex);
      if (ok) { bgm.duck(); onHorn?.(); }
      return ok;
    },
    playTeloletFlourish() {
      const ok = telolet.playTeloletFlourish();
      if (ok) { bgm.duck(); onHorn?.(); }
      return ok;
    },
    playAbyssWhistle() {
      return telolet.playAbyssWhistle();
    },
    playLoopWhoosh() {
      return telolet.playLoopWhoosh();
    },
    fireRing() {
      return telolet.playFireRing();
    },
    smashProp() {
      return telolet.playSmashProp();
    },
    victory() {
      return telolet.playVictoryFanfare();
    },
    countdown(label) {
      if (label === 'GO!') {
        tone(880, 0.14, 'triangle', 0.28);
        tone(1174.66, 0.28, 'triangle', 0.28, null, 0.08);
      } else {
        tone(523.25, 0.14, 'triangle', 0.22);
      }
    },
    gameover() { [523, 440, 349, 262].forEach((f, i) => tone(f, 0.34, 'triangle', 0.26, null, i * 0.16)); },
    setMuted(m) {
      muted = m;
      if (master && ac) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.05);
      bgm.refreshMute();
    },
    startMusic(arenaId) { bgm.start(arenaId); },
    stopMusic() { bgm.stop(); },
    pauseMusic() { bgm.pause(); },
    resumeMusic() { bgm.resume(); },
    duckMusic(ms) { bgm.duck(ms); },
    setMusicBoost(on) { bgm.setBoost(on); },
    setMusicKidsMode(on) { bgm.setKidsMode(on); },
    setMusicEnabled(on) { musicEnabled = !!on; bgm.refreshMute(); },
    refreshMusicMute() { bgm.refreshMute(); },
    dispose() { bgm.dispose(); telolet.dispose(); try { engOsc?.stop(); engSub?.stop(); ac?.close(); } catch {} ac = null; engOsc = null; },
  };
}

/* ==================== Template & gaya ==================== */
function TEMPLATE() {
  return `
  <div id="jg-loader" class="jg-loader">
    <div class="jg-load-van">🚐</div><div class="jg-load-road"></div>
    <h1>JURAGAN <em>NGEBUT</em></h1>
    <div class="jg-load-sub">MINI RACE NUSANTARA • SALATIGA</div>
    <div class="jg-load-track"><div id="jg-load-fill" class="jg-load-fill"></div></div>
    <div id="jg-load-status" class="jg-load-status">Menyalakan golden hour…</div>
  </div>

  <div id="jg-fatal" class="jg-fatal"><div class="jg-panel jg-fatal-card">
    <div class="jg-big-em">🛠️</div><h2>Mesin mogok!</h2>
    <p id="jg-fatal-msg">Perangkat ini belum mendukung WebGL.</p>
    <button id="jg-fatal-reload" class="jg-btn primary">Coba Lagi</button>
  </div></div>

  <div id="jg-menu" class="jg-overlay jg-menu">
    <div class="jg-menu-top">
      <div class="jg-brand jg-flame-banner"><span class="jg-brand-em">🔥</span>
        <div><h1>JURAGAN <em>NGEBUT</em></h1><span class="jg-brand-sub">KING OF THE ROAD • SALATIGA</span></div>
      </div>
      <div class="jg-menu-tools">
        <span id="jg-net-menu" class="jg-net solo">● SOLO • AI MODE</span>
        <button id="jg-music-menu" class="jg-btn small jg-music-btn" type="button" aria-pressed="true" title="Matikan musik latar">🎵 Musik</button>
        <button id="jg-help-menu" class="jg-icon" type="button" title="Cara bermain (?)" aria-label="Cara bermain">?</button>
        <button id="jg-audio-menu" class="jg-icon" aria-pressed="true">🔊</button>
      </div>
    </div>
    <div class="jg-menu-stage">
      <div class="jg-panel jg-menu-card">
        <div class="jg-flame-marquee">
          <span class="jg-flame-badge">🔥 KING OF THE ROAD SALATIGA</span>
          <span class="jg-flame-sub">MISI FINIS 1.500M • 1:64 DIE-CAST EDITION</span>
        </div>
        <div class="jg-name-row">
          <label for="jg-name-input">Nama Juragan</label>
          <input id="jg-name-input" class="jg-input" type="text" maxlength="18" placeholder="Tulis namamu di trek…" autocomplete="off" />
        </div>
        <div class="jg-menu-section">
          <div class="jg-menu-head">
            <h2>Pilih Arena</h2><span id="jg-arena-badge" class="jg-chip">🏙️ Kota Salatiga</span>
          </div>
          <div id="jg-arenas" class="jg-arenas"></div>
        </div>
        <div class="jg-menu-section">
          <div class="jg-menu-head">
            <h2>Pilih Armada</h2><span id="jg-best-menu" class="jg-chip gold">🏆 Rekor: 0</span>
          </div>
          <div id="jg-fleet" class="jg-fleet"></div>
        </div>
        <details id="jg-advanced" class="jg-adv">
          <summary>⚙️ Pengaturan lanjutan <span class="jg-adv-hint">Kualitas Grafik, Kamar &amp; Tingkat Ngebut</span></summary>
          <div class="jg-adv-body">
            <div class="jg-menu-section">
              <div class="jg-menu-head"><h2>Kualitas Grafik</h2><span id="jg-quality-badge" class="jg-chip">🌿 ECO (Ringan)</span></div>
              <div id="jg-quality-group" class="jg-qualities" role="group" aria-label="Pilihan kualitas grafik">
                <button class="jg-quality-btn on" type="button" data-quality="eco" aria-pressed="true">
                  <span class="jg-quality-ico" aria-hidden="true">🌿</span>
                  <span class="jg-quality-txt"><strong>ECO (Ringan)</strong><small>Mulus &amp; hemat baterai</small></span>
                </button>
                <button class="jg-quality-btn" type="button" data-quality="normal" aria-pressed="false">
                  <span class="jg-quality-ico" aria-hidden="true">✨</span>
                  <span class="jg-quality-txt"><strong>Normal</strong><small>Detail lebih lengkap</small></span>
                </button>
              </div>
            </div>
            <div class="jg-menu-section">
              <div class="jg-menu-head"><h2>Pilih Kamar Server</h2><span id="jg-room-active" class="jg-chip live-room">🌐 SALATIGA-1</span></div>
              <div id="jg-rooms" class="jg-rooms"></div>
              <div class="jg-private-row">
                <input id="jg-room-input" class="jg-input" type="text" maxlength="20" placeholder="Buat / Gabung Kamar Privat (cth: KOP-88 atau SALATIGA)…" autocomplete="off" />
                <button id="jg-room-join" class="jg-btn small" type="button">Gabung 🔒</button>
              </div>
            </div>
            <div class="jg-menu-section">
              <div class="jg-menu-head"><h2>Tingkat Ngebut</h2><span id="jg-diff-note" class="jg-chip">5 nyawa • skor ×0.8</span></div>
              <div id="jg-diffs" class="jg-diffs"></div>
            </div>
          </div>
        </details>
        <button id="jg-start" class="jg-btn primary big">GAS! 🏁</button>
        <div class="jg-legend">
          <span><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> belok</span>
          <span><kbd>←</kbd><kbd>→</kbd> di udara = <b>Barrel Roll</b> → Turbo</span>
          <span><kbd>H</kbd> klakson telolet • <kbd>P</kbd> jeda • <kbd>R</kbd> ulang • <kbd>M</kbd> suara</span>
        </div>
        <div class="jg-objective">🎯 Capai Garis Finis 1.500 m lebih dulu sambil kumpulkan koin emas &amp; buah segar 3D untuk naik Podium Juara!</div>
        <div class="jg-kid-bar">
          <label class="jg-switch-lbl">
            <input id="jg-kid-mode" type="checkbox" checked />
            <span>🧒 Mode Anak</span>
          </label>
          <label id="jg-no-gameover-wrap" class="jg-switch-lbl sub">
            <input id="jg-no-gameover" type="checkbox" checked />
            <span>🛡️ Tanpa game over</span>
          </label>
        </div>
      </div>
    </div>
  </div>

  <div id="jg-hud" class="jg-hud">
    <canvas id="jg-speedlines" class="jg-speedlines" aria-hidden="true"></canvas>
    <div id="jg-countdown" class="jg-countdown" aria-live="assertive"></div>

    <!-- Kiri-Atas: Lap/Timer + Badge Koin + Nyawa + Klasemen Ikonik 1st–4th -->
    <div class="jg-hud-tl">
      <div class="jg-tl-badges">
        <div id="jg-coins-wrap" class="jg-coin-pill">
          <span class="jg-coin-ico">🪙</span>
          <b id="jg-coins">0</b>
        </div>
        <div id="jg-hearts" class="jg-hearts" aria-label="Nyawa"></div>
        <div id="jg-lap-timer" class="jg-lap-pill">LAP 1 · 0/1500m · 00:00.0</div>
      </div>
      <div id="jg-lb" class="jg-lb" aria-label="Klasemen 1 sampai 4"></div>
    </div>

    <!-- Kanan-Atas: Tombol Panduan, Audio & Jeda Minimal -->
    <div class="jg-hud-tr">
      <button id="jg-help-btn" class="jg-min-btn" type="button" title="Cara bermain (?)" aria-label="Cara bermain">?</button>
      <button id="jg-audio" class="jg-min-btn" aria-pressed="true" title="Suara (M)">🔊</button>
      <button id="jg-pause-btn" class="jg-min-btn" title="Jeda (P)">⏸</button>
    </div>

    <!-- Tepi Kanan: Rel Progress Vertikal START ke FINISH 1500m -->
    <div id="jg-progress-rail" class="jg-progress-rail" aria-hidden="true">
      <div class="jg-prog-flag">🏁</div>
      <span class="jg-prog-lbl">FINISH</span>
      <div class="jg-prog-track"><div id="jg-progress-dots" class="jg-prog-dots"></div></div>
      <span class="jg-prog-lbl">START</span>
    </div>

    <!-- Kiri-Bawah: Minimap Bundar Transparan -->
    <div class="jg-hud-bl" aria-hidden="true">
      <canvas id="jg-minimap" class="jg-minimap" width="120" height="120"></canvas>
    </div>

    <!-- Kanan-Bawah: Speedometer Digital Melengkung + Bar Boost -->
    <div class="jg-hud-br" aria-hidden="true">
      <div class="jg-speedo">
        <svg viewBox="0 0 110 72" class="jg-speedo-svg">
          <path d="M 15 62 A 44 44 0 1 1 95 62" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="8" stroke-linecap="round" />
          <path id="jg-speed-arc" d="M 15 62 A 44 44 0 1 1 95 62" fill="none" stroke="#ffbe0b" stroke-width="8" stroke-linecap="round" stroke-dasharray="118" stroke-dashoffset="118" />
        </svg>
        <div class="jg-speedo-txt"><b id="jg-speed-val">0</b><span>KM/H</span></div>
      </div>
      <div id="jg-boost-wrap" class="jg-boost-bar">
        <span>BOOST</span>
        <div class="jg-boost-track"><div id="jg-boost-fill" class="jg-boost-fill"></div></div>
      </div>
    </div>

    <!-- Penghitung Koin & Mahkota Melayang di atas kendaraan player -->
    <div id="jg-overhead" class="jg-overhead" aria-hidden="true">
      <span id="jg-overhead-crown" class="jg-ov-crown" style="display:none">👑</span>
      <span class="jg-ov-ico">🪙</span>
      <b id="jg-overhead-coins">0</b>
    </div>

    <div id="jg-pad-l" class="jg-pad left" aria-label="Belok kiri">◀</div>
    <button id="jg-telolet" class="jg-telolet" type="button" aria-label="Klakson Telolet Basuri (H)" title="Klakson Telolet Basuri (H)">
      <span class="jg-telolet-em">🎺</span>
      <kbd>H</kbd>
    </button>
    <div id="jg-pad-r" class="jg-pad right" aria-label="Belok kanan">▶</div>
    <div id="jg-crash" class="jg-crash"></div>
  </div>

  <div id="jg-toasts" class="jg-toasts"></div>

  <div id="jg-pause" class="jg-overlay jg-modal"><div class="jg-panel jg-modal-card">
    <div class="jg-big-em">⏸</div><h2>JEDA DULU</h2>
    <p>Mesin masih panas, Juragan. Lanjut kapan saja.</p>
    <button id="jg-resume" class="jg-btn primary">LANJUT ▶</button>
    <div class="jg-btn-row">
      <button id="jg-pause-restart" class="jg-btn">🔁 Ulang</button>
      <button id="jg-pause-menu" class="jg-btn">🚐 Armada</button>
      <button id="jg-audio-pause" class="jg-btn icon" aria-pressed="true">🔊</button>
    </div>
    <div class="jg-btn-row">
      <button id="jg-music-pause" class="jg-btn jg-music-btn" type="button" aria-pressed="true">🎵 Musik: ON</button>
      <button id="jg-quality" class="jg-btn" aria-pressed="true">🌿 Grafik: ECO (Ringan)</button>
    </div>
  </div></div>

  <div id="jg-over" class="jg-overlay jg-modal"><div class="jg-panel jg-modal-card jg-over-card">
    <div class="jg-big-em">🏆</div><h2 id="jg-over-title">HASIL BALAPAN!</h2>
    <div id="jg-over-record" class="jg-record">✨ REKOR BARU ✨</div>
    <div id="jg-podium" class="jg-podium"></div>
    <div class="jg-stats">
      <div><b id="jg-over-score">0</b><span>SKOR</span></div>
      <div><b id="jg-over-dist">0 m</b><span>JARAK</span></div>
      <div><b id="jg-over-coins">0</b><span>KOIN &amp; BUAH</span></div>
      <div><b id="jg-over-rolls">0</b><span>BARREL ROLL</span></div>
      <div class="jg-stat-wide"><b id="jg-over-best">0</b><span>REKOR TERBAIK</span></div>
    </div>
    <button id="jg-over-continue" class="jg-btn primary big" style="display:none">Balapan Berikutnya 🏁</button>
    <button id="jg-over-restart" class="jg-btn primary big">GAS LAGI 🔁</button>
    <button id="jg-over-menu" class="jg-btn">🚐 Ganti Armada</button>
  </div></div>`;
}

function renderPodium(container, standings) {
  if (!container) return;
  container.replaceChildren();
  if (!standings || standings.length === 0) return;

  const confettiWrap = document.createElement('div');
  confettiWrap.className = 'jg-confetti-wrap';
  const confColors = ['#ff2a4b', '#ffd100', '#39ff14', '#9d4edd', '#38bdf8'];
  for (let i = 0; i < 18; i++) {
    const bit = document.createElement('span');
    bit.className = 'jg-confetti-bit';
    bit.style.left = `${(i * 5.8 + 2) % 96}%`;
    bit.style.background = confColors[i % confColors.length];
    bit.style.animationDelay = `${(i % 5) * 0.12}s`;
    confettiWrap.appendChild(bit);
  }
  container.appendChild(confettiWrap);

  const stage = document.createElement('div');
  stage.className = 'jg-podium-stage';

  // Urutan visual podium: 2nd (kiri), 1st (tengah), 3rd (kanan)
  const order = [1, 0, 2];
  const medals = ['🥇', '🥈', '🥉'];
  for (const idx of order) {
    const r = standings[idx];
    if (!r) continue;
    const col = document.createElement('div');
    col.className = `jg-pod-col pos-${idx + 1}${r.isPlayer ? ' me' : ''}`;

    const racer = document.createElement('div');
    racer.className = 'jg-pod-racer';
    if (idx === 0) {
      const flames = document.createElement('div');
      flames.className = 'jg-pod-flames';
      flames.textContent = '👑';
      racer.appendChild(flames);
    }
    const em = document.createElement('div');
    em.className = 'jg-pod-ico';
    em.innerHTML = vehicleSvg(r.type, r.slotColor || '#ff6b00');
    const nm = document.createElement('div');
    nm.className = 'jg-pod-name';
    nm.textContent = r.isPlayer ? `${r.name} (KAMU)` : r.name;
    racer.append(em, nm);

    const block = document.createElement('div');
    block.className = 'jg-pod-block';
    if (r.slotColor) block.style.setProperty('--slot-col', r.slotColor);
    const medal = document.createElement('span');
    medal.className = 'jg-pod-medal';
    medal.textContent = medals[idx] || `#${idx + 1}`;
    const num = document.createElement('b');
    num.textContent = `#${idx + 1}`;
    const cBadge = document.createElement('span');
    cBadge.className = 'jg-pod-coins';
    cBadge.textContent = `🪙 ${Math.round(r.coins ?? 0)}`;
    block.append(medal, num, cBadge);

    col.append(racer, block);
    stage.appendChild(col);
  }
  container.appendChild(stage);

  if (standings[3]) {
    const r4 = standings[3];
    const row4 = document.createElement('div');
    row4.className = `jg-pod-fourth${r4.isPlayer ? ' me' : ''}`;
    row4.textContent = `🏁 #4 • ${EMOJI[r4.type] || '🚐'} ${r4.isPlayer ? `${r4.name} (KAMU)` : r4.name} • 🪙 ${Math.round(r4.coins ?? 0)}`;
    container.appendChild(row4);
  }
}

function injectStyles() {
  if (document.getElementById('jg-styles')) return;
  const s = document.createElement('style');
  s.id = 'jg-styles';
  s.textContent = `
  :root{
    --jg-cream:${P.cream}; --jg-paper:${P.paper}; --jg-ink:${P.ink}; --jg-soft:#6b5a52;
    --jg-red:${P.toyRed}; --jg-amber:${P.toyYellow}; --jg-orange:${P.toyOrange};
    --jg-green:${P.toyGreen}; --jg-blue:${P.toyBlue}; --jg-purple:${P.toyPurple};
    --jg-surface:rgba(255,248,235,.93); --jg-line:rgba(59,47,47,.16);
    --jg-shadow:0 16px 40px rgba(122,72,20,.22);
    --jg-disp:"Fredoka","Plus Jakarta Sans",system-ui,sans-serif;
    --jg-body:"Plus Jakarta Sans",system-ui,sans-serif;
  }
  #jg-root{position:fixed;inset:0;z-index:20;pointer-events:none;font-family:var(--jg-body);color:var(--jg-ink)}
  #jg-root *{box-sizing:border-box;margin:0;padding:0}
  #jg-root button{font-family:var(--jg-body);cursor:pointer;pointer-events:auto}
  #jg-root ::-webkit-scrollbar{width:8px;height:8px}
  #jg-root ::-webkit-scrollbar-track{background:rgba(59,47,47,.07);border-radius:99px}
  #jg-root ::-webkit-scrollbar-thumb{background:linear-gradient(180deg,var(--jg-amber),var(--jg-orange));border-radius:99px}
  #jg-root ::-webkit-scrollbar-thumb:hover{background:var(--jg-orange)}
  #jg-root *{scrollbar-width:thin;scrollbar-color:var(--jg-amber) rgba(59,47,47,.07)}
  #jg-root kbd{background:var(--jg-paper);border:1px solid var(--jg-line);border-bottom-width:2px;border-radius:5px;padding:1px 6px;font-size:12px;font-family:var(--jg-body)}
  .jg-panel{background:var(--jg-surface);border:2px solid var(--jg-line);border-radius:18px;box-shadow:var(--jg-shadow);backdrop-filter:blur(12px)}
  .jg-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:800;background:var(--jg-paper);border:1.5px solid var(--jg-line);border-radius:99px;padding:5px 12px;color:var(--jg-soft);font-variant-numeric:tabular-nums}
  .jg-chip.gold{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;border-color:var(--jg-orange)}
  .jg-btn{pointer-events:auto;min-height:44px;border:2px solid var(--jg-line);background:var(--jg-paper);color:var(--jg-ink);font-weight:800;font-size:14px;border-radius:14px;padding:12px 18px;transition:transform .14s,background .2s,border-color .2s;box-shadow:0 6px 16px rgba(122,72,20,.14)}
  .jg-btn:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-btn:active{transform:scale(.96)}
  .jg-btn.primary{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;border-color:var(--jg-orange);text-shadow:0 1px 2px rgba(120,60,0,.35)}
  .jg-btn.big{width:100%;font-size:1.25rem;font-family:var(--jg-disp);font-weight:700;padding:14px 28px;margin-top:2px;letter-spacing:.5px}
  .jg-btn.icon{flex:none;width:52px}
  .jg-btn-row{display:flex;gap:8px;margin-top:9px}
  .jg-btn-row .jg-btn{flex:1}
  #jg-root button:focus-visible,.jg-card:focus-visible,.jg-diff:focus-visible,.jg-adv summary:focus-visible{outline:3px solid var(--jg-blue);outline-offset:2px}
  .jg-icon{pointer-events:auto;min-width:44px;min-height:44px;width:44px;height:44px;border-radius:13px;border:2px solid var(--jg-line);background:var(--jg-surface);backdrop-filter:blur(8px);font-size:18px;display:grid;place-items:center;box-shadow:0 6px 16px rgba(122,72,20,.16);transition:transform .14s,border-color .2s}
  .jg-icon:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-icon:active{transform:scale(.93)}
  .jg-icon[aria-pressed="false"],.jg-music-btn[aria-pressed="false"]{opacity:.6}

  /* Loader */
  .jg-loader{position:fixed;inset:0;z-index:90;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(160deg,#ffd9a8,#ffe5cc 34%,#fff3e0 68%,#ffe9d2);transition:opacity .7s,visibility .7s}
  .jg-loader.done{opacity:0;visibility:hidden}
  .jg-load-van{font-size:56px;animation:jgBounce 1s cubic-bezier(.3,.7,.4,1) infinite;filter:drop-shadow(0 10px 12px rgba(122,72,20,.3))}
  .jg-load-road{width:180px;height:5px;margin:10px 0 24px;border-radius:99px;background:repeating-linear-gradient(90deg,var(--jg-soft) 0 16px,transparent 16px 30px);opacity:.35;animation:jgRoad .5s linear infinite}
  .jg-loader h1{font-family:var(--jg-disp);font-weight:700;font-size:clamp(30px,6vw,50px);letter-spacing:1px}
  .jg-loader h1 em{font-style:normal;color:var(--jg-red)}
  .jg-load-sub{margin-top:8px;font-size:12px;font-weight:800;letter-spacing:2.4px;color:var(--jg-soft)}
  .jg-load-track{width:min(320px,74vw);height:12px;margin-top:28px;border-radius:99px;background:rgba(59,47,47,.1);border:1.5px solid var(--jg-line);overflow:hidden}
  .jg-load-fill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--jg-amber),var(--jg-orange),var(--jg-red));transition:width .35s cubic-bezier(.2,.8,.2,1)}
  .jg-load-status{margin-top:12px;font-size:12.5px;font-weight:700;color:var(--jg-soft)}

  /* Start Menu */
  .jg-overlay{position:fixed;inset:0;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .35s,visibility .35s}
  .jg-overlay.show{opacity:1;visibility:visible;pointer-events:auto}
  .jg-menu{display:flex;flex-direction:column;align-items:center;padding:18px 20px;gap:14px;background:radial-gradient(120% 90% at 50% 0%,rgba(255,229,204,.55),rgba(255,243,224,.82));overflow-y:auto}
  .jg-menu-top{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;max-width:1200px;flex:none}
  .jg-menu-stage{flex:1;width:100%;display:flex;align-items:center;justify-content:center;padding:4px 0 12px}
  .jg-brand{display:flex;align-items:center;gap:12px}
  .jg-flame-banner{background:linear-gradient(125deg,#d00000 0%,#ff6b00 54%,#ffbe0b 100%);padding:10px 18px;border-radius:18px;border:2.5px solid #fff3bf;box-shadow:0 10px 26px rgba(208,0,0,.35)}
  .jg-flame-banner h1{color:#fff;text-shadow:0 3px 0 #7f1d1d,0 5px 14px rgba(0,0,0,.35)}
  .jg-flame-banner h1 em{color:#ffe600}
  .jg-flame-banner .jg-brand-sub{color:#fff8eb;opacity:.95}
  .jg-brand-em{font-size:38px;filter:drop-shadow(0 4px 7px rgba(122,72,20,.35))}
  .jg-brand h1{font-family:var(--jg-disp);font-weight:700;font-size:clamp(1.45rem,3.2vw,2.1rem);line-height:1.05}
  .jg-brand h1 em{font-style:normal;color:var(--jg-red)}
  .jg-brand-sub{display:block;margin-top:3px;font-size:12px;font-weight:800;letter-spacing:1.4px;color:var(--jg-soft)}
  .jg-menu-tools{display:flex;align-items:center;gap:8px}
  .jg-net{font-size:12px;font-weight:800;letter-spacing:.4px;border-radius:99px;padding:6px 12px;background:var(--jg-surface);border:1.5px solid var(--jg-line);backdrop-filter:blur(8px);white-space:nowrap}
  .jg-net.solo{color:#2b7a38}.jg-net.live{color:#0f766e;border-color:rgba(16,185,129,.45);background:rgba(236,253,245,.95)}.jg-net.warn{color:var(--jg-orange)}
  .jg-menu-card{display:flex;flex-direction:column;gap:16px;max-width:860px;width:92%;margin:auto;padding:24px 28px;max-height:calc(100vh - 96px);overflow-y:auto;border-color:rgba(255,107,0,.45)}
  .jg-flame-marquee{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:11px 16px;border-radius:14px;background:linear-gradient(90deg,#d00000 0%,#ff5400 52%,#ffbe0b 100%);color:#fff;box-shadow:0 8px 20px rgba(255,84,0,.28);border:2px solid #fff3bf}
  .jg-flame-badge{font-family:var(--jg-disp);font-weight:700;font-size:1.08rem;letter-spacing:.7px;text-shadow:0 2px 0 rgba(120,20,0,.6)}
  .jg-flame-sub{font-size:12px;font-weight:800;letter-spacing:1px;background:rgba(34,24,24,.32);padding:4px 10px;border-radius:99px;color:#fff8eb}
  .jg-menu-section{display:flex;flex-direction:column;gap:10px}
  .jg-menu-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .jg-menu-head h2{font-family:var(--jg-disp);font-weight:600;font-size:1.1rem}
  .jg-arenas{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .jg-arena-card{position:relative;pointer-events:auto;min-height:44px;display:flex;align-items:center;gap:10px;text-align:left;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:16px;padding:11px 12px;transition:transform .16s,border-color .2s,box-shadow .2s}
  .jg-arena-card:hover{transform:translateY(-2px);border-color:var(--jg-blue)}
  .jg-arena-card.on{border-color:var(--jg-blue);background:linear-gradient(155deg,#f0f9ff,#e0f2fe);box-shadow:0 0 0 3px rgba(58,134,255,.22),0 10px 22px rgba(2,132,199,.16)}
  .jg-arena-em{font-size:28px;line-height:1;flex:none}
  .jg-arena-meta{display:flex;flex-direction:column;gap:3px;min-width:0}
  .jg-arena-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .jg-arena-top strong{font-family:var(--jg-disp);font-weight:700;font-size:.95rem;color:var(--jg-ink)}
  .jg-arena-badge{font-style:normal;font-size:12px;font-weight:800;letter-spacing:.3px;padding:2px 8px;border-radius:99px;background:rgba(59,47,47,.1);color:var(--jg-soft)}
  .jg-arena-badge.new{background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff}
  .jg-arena-badge.new-hot{background:linear-gradient(135deg,#ff6b00,#e63946);color:#fff}
  .jg-arena-desc{font-size:12px;font-weight:600;line-height:1.35;color:var(--jg-soft)}
  .jg-arena-card.on .jg-card-check{display:grid;background:var(--jg-blue)}
  .jg-fleet{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}
  .jg-card{position:relative;pointer-events:auto;min-height:44px;display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:left;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:16px;padding:13px 14px;transition:transform .16s,border-color .2s,box-shadow .2s}
  .jg-card:hover{transform:translateY(-3px);border-color:var(--jg-amber)}
  .jg-card.on{border-color:var(--jg-orange);box-shadow:0 0 0 3px rgba(255,197,61,.35),0 10px 22px rgba(122,72,20,.2);background:linear-gradient(160deg,#fff8eb,#ffefd6)}
  .jg-card-em{font-size:29px}
  .jg-card-name{font-family:var(--jg-disp);font-weight:600;font-size:1rem;line-height:1.15}
  .jg-card-tag{font-size:12px;font-weight:700;color:var(--jg-orange);line-height:1.3;min-height:32px}
  .jg-card-check{position:absolute;top:9px;right:10px;width:22px;height:22px;border-radius:99px;background:var(--jg-orange);color:#fff;font-size:12px;display:none;place-items:center}
  .jg-card.on .jg-card-check{display:grid}
  .jg-bars{display:flex;flex-direction:column;gap:4px;width:100%;margin-top:4px}
  .jg-bar{display:flex;align-items:center;gap:5px}
  .jg-bar i{font-style:normal;font-size:12px;font-weight:800;color:var(--jg-soft);width:30px}
  .jg-bar b{flex:1;height:6px;border-radius:99px;background:rgba(59,47,47,.1);overflow:hidden}
  .jg-bar u{display:block;height:100%;border-radius:99px}
  .jg-diffs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .jg-diff{pointer-events:auto;min-height:44px;display:flex;align-items:center;justify-content:center;gap:7px;font-weight:800;font-size:.96rem;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:14px;padding:12px 14px;transition:transform .15s,border-color .2s}
  .jg-diff:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-diff.on{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;border-color:var(--jg-orange)}
  .jg-qualities{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .jg-quality-btn{pointer-events:auto;min-height:52px;display:flex;align-items:center;gap:10px;text-align:left;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:14px;padding:10px 13px;transition:transform .15s,border-color .2s,box-shadow .2s}
  .jg-quality-btn:hover{transform:translateY(-2px);border-color:var(--jg-green)}
  .jg-quality-btn.on{background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-color:var(--jg-green);box-shadow:0 0 0 3px rgba(63,163,77,.2)}
  .jg-quality-ico{font-size:24px;line-height:1;flex:none}
  .jg-quality-txt{display:flex;flex-direction:column;gap:2px}
  .jg-quality-txt strong{font-family:var(--jg-disp);font-weight:700;font-size:.98rem;color:var(--jg-ink)}
  .jg-quality-txt small{font-size:12px;font-weight:700;color:var(--jg-soft)}
  .jg-name-row{display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1.5px dashed var(--jg-line)}
  .jg-name-row label{font-family:var(--jg-disp);font-weight:600;font-size:1.1rem;white-space:nowrap}
  .jg-input{pointer-events:auto;user-select:text;flex:1;min-width:0;min-height:44px;font-family:var(--jg-body);font-weight:700;font-size:14px;color:var(--jg-ink);background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:12px;padding:10px 14px;outline:none;transition:border-color .2s,box-shadow .2s}
  .jg-input:focus{border-color:var(--jg-blue);box-shadow:0 0 0 3px rgba(58,134,255,.2)}
  .jg-chip.live-room{background:rgba(236,253,245,.95);border-color:rgba(16,185,129,.45);color:#0f766e}
  .jg-rooms{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .jg-room-btn{pointer-events:auto;min-height:44px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:14px;padding:11px 13px;transition:transform .15s,border-color .2s,box-shadow .2s}
  .jg-room-btn:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-room-btn.on{border-color:var(--jg-green);background:linear-gradient(160deg,#ecfdf5,#d1fae5);box-shadow:0 0 0 3px rgba(56,176,0,.18)}
  .jg-room-name{font-family:var(--jg-disp);font-weight:600;font-size:1rem;color:var(--jg-ink)}
  .jg-room-name small{font-family:var(--jg-body);font-size:12px;font-weight:700;color:var(--jg-soft)}
  .jg-room-cnt{font-size:12px;font-weight:800;color:#0f766e}
  .jg-private-row{display:flex;gap:10px}
  .jg-btn.small{padding:10px 16px;font-size:13.5px;border-radius:12px;white-space:nowrap}
  .jg-adv{background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:14px;padding:4px 12px}
  .jg-adv summary{pointer-events:auto;list-style:none;cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-family:var(--jg-disp);font-weight:600;font-size:1rem;color:var(--jg-ink);user-select:none}
  .jg-adv summary::-webkit-details-marker{display:none}
  .jg-adv-hint{font-family:var(--jg-body);font-size:12px;font-weight:700;color:var(--jg-soft)}
  .jg-adv[open] .jg-adv-body{display:flex;flex-direction:column;gap:14px;padding:10px 0 10px;border-top:1.5px dashed var(--jg-line)}
  .jg-kid-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;background:rgba(255,197,61,.16);border:2px solid rgba(247,107,21,.3);border-radius:14px;padding:8px 14px}
  .jg-switch-lbl{pointer-events:auto;min-height:44px;display:inline-flex;align-items:center;gap:9px;font-family:var(--jg-disp);font-weight:600;font-size:15px;color:var(--jg-ink);cursor:pointer;user-select:none}
  .jg-switch-lbl.sub{font-family:var(--jg-body);font-weight:800;font-size:13px}
  .jg-switch-lbl.dim{opacity:.65}
  .jg-switch-lbl input{width:20px;height:20px;accent-color:var(--jg-orange);cursor:pointer}
  .jg-legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:12.5px;font-weight:700;line-height:1.45;color:var(--jg-soft)}
  .jg-legend b{color:var(--jg-red)}
  .jg-objective{font-size:12.5px;font-weight:700;line-height:1.55;color:var(--jg-soft);background:rgba(63,163,77,.1);border:1.5px solid rgba(63,163,77,.3);border-radius:13px;padding:11px 14px}

  /* ==================== HUD DASHBOARD MINIMALIS SUDUT ==================== */
  .jg-hud{position:fixed;inset:0;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}
  .jg-hud.show{opacity:1;visibility:visible}
  .jg-speedlines{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4}
  .jg-countdown{position:fixed;left:50%;top:42%;transform:translate(-50%,-50%) scale(.5);z-index:30;pointer-events:none;opacity:0;font-family:var(--jg-disp);font-weight:700;font-size:clamp(74px,16vw,140px);line-height:1;color:#fff8eb;text-shadow:0 6px 0 #c2510c,0 12px 30px rgba(0,0,0,.45);-webkit-text-stroke:3px #3b2f2f}
  .jg-countdown.go{color:#ffbe0b;text-shadow:0 6px 0 #b91c1c,0 12px 32px rgba(0,0,0,.48)}
  .jg-countdown.show{opacity:1}
  .jg-countdown.anim{animation:jgCountdown .9s cubic-bezier(.2,.9,.3,1.2) forwards}

  /* Top-Left: Compact Coin + Hearts + Lap/Timer + Sleek 1st-4th Vehicle Leaderboard */
  .jg-hud-tl{position:absolute;top:14px;left:14px;display:flex;flex-direction:column;align-items:flex-start;gap:7px;z-index:12;pointer-events:none}
  .jg-tl-badges{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .jg-coin-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 12px 5px 9px;border-radius:99px;background:rgba(15,23,42,.82);border:2px solid #ffbe0b;color:#ffe600;box-shadow:0 4px 12px rgba(0,0,0,.26)}
  .jg-coin-ico{font-size:15px;line-height:1}
  .jg-coin-pill b{font-family:var(--jg-disp);font-weight:700;font-size:18px;line-height:1;font-variant-numeric:tabular-nums}
  .jg-coin-pill.pop{animation:jgCoinPop .26s cubic-bezier(.2,.9,.3,1.4)}
  .jg-hearts{display:inline-flex;align-items:center;gap:3px;padding:4px 10px;border-radius:99px;background:rgba(15,23,42,.82);border:2px solid rgba(255,255,255,.3);box-shadow:0 4px 12px rgba(0,0,0,.24)}
  .jg-hearts.hurt{animation:jgHeartHurt .38s ease-out}
  .jg-heart{font-size:16px;line-height:1;transition:transform .2s,opacity .2s,filter .2s}
  .jg-heart.lost{opacity:.35;filter:grayscale(1);transform:scale(.86)}
  .jg-lap-pill{padding:5px 12px;border-radius:99px;background:rgba(15,23,42,.76);border:1.5px solid rgba(255,255,255,.26);color:#f8fafc;font-family:var(--jg-disp);font-weight:600;font-size:12px;letter-spacing:.3px;font-variant-numeric:tabular-nums;box-shadow:0 4px 12px rgba(0,0,0,.22)}
  .jg-lb{display:flex;flex-direction:column;gap:4px}
  .jg-lb-row{display:flex;align-items:center;gap:6px;padding:3px 9px 3px 6px;border-radius:10px;background:rgba(15,23,42,.72);border:1.5px solid rgba(255,255,255,.22);color:#f8fafc;box-shadow:0 3px 10px rgba(0,0,0,.22);transition:transform .16s}
  .jg-lb-row.me{background:rgba(255,107,0,.92);border-color:#fff3bf;color:#fff;transform:translateX(3px)}
  .jg-lb-row.pos-1:not(.me){border-color:#ffbe0b}
  .jg-lb-pos{width:18px;text-align:center;font-family:var(--jg-disp);font-weight:700;font-size:13px;line-height:1}
  .jg-lb-ico{display:flex;align-items:center}
  .jg-vsvg{width:34px;height:18px;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
  .jg-lb-name{font-size:12px;font-weight:800;letter-spacing:.2px;max-width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* Bottom-Left: Circular Transparent Minimap */
  .jg-hud-bl{position:absolute;bottom:14px;left:14px;z-index:11;pointer-events:none}
  .jg-minimap{width:120px;height:120px;display:block;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35))}

  /* Bottom-Right: Curved Digital Speedometer + Boost Bar */
  .jg-hud-br{position:absolute;bottom:14px;right:14px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 12px 9px;border-radius:18px;background:rgba(15,23,42,.76);border:1.5px solid rgba(255,255,255,.24);box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:11;pointer-events:none}
  .jg-speedo{position:relative;width:110px;height:68px}
  .jg-speedo-svg{width:100%;height:100%;display:block}
  #jg-speed-arc{transition:stroke-dashoffset .08s linear}
  .jg-speedo-txt{position:absolute;inset:14px 0 0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .jg-speedo-txt b{font-family:var(--jg-disp);font-weight:700;font-size:24px;line-height:1;color:#fff8eb;font-variant-numeric:tabular-nums}
  .jg-speedo-txt span{font-size:12px;font-weight:800;letter-spacing:.6px;color:#cbd5e1}
  .jg-boost-bar{display:flex;align-items:center;gap:6px;width:110px}
  .jg-boost-bar span{font-size:12px;font-weight:800;letter-spacing:.4px;color:#bae6fd}
  .jg-boost-track{flex:1;height:6px;border-radius:99px;background:rgba(255,255,255,.16);overflow:hidden}
  .jg-boost-fill{height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,#38bdf8,#22c55e);transition:width .08s linear}
  .jg-boost-bar.turbo .jg-boost-fill{background:linear-gradient(90deg,#ffbe0b,#ff5400)}

  /* Top-Right: Minimal Audio & Pause Icon Buttons */
  .jg-hud-tr{position:absolute;top:14px;right:14px;display:flex;align-items:center;gap:8px;z-index:12}
  .jg-min-btn{pointer-events:auto;min-width:44px;min-height:44px;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.65);background:rgba(15,23,42,.74);color:#fff;font-size:18px;display:grid;place-items:center;box-shadow:0 4px 12px rgba(0,0,0,.28);transition:transform .14s,border-color .2s}
  .jg-min-btn:hover{transform:scale(1.06);border-color:#ffbe0b}
  .jg-min-btn:active{transform:scale(.92)}
  .jg-min-btn[aria-pressed="false"]{opacity:.65}

  /* Right-Edge Slim Vertical START -> FINISH Progress Rail */
  .jg-progress-rail{position:fixed;right:14px;top:44%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;z-index:11}
  .jg-prog-flag{font-size:20px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))}
  .jg-prog-lbl{font-family:var(--jg-disp);font-weight:700;font-size:12px;letter-spacing:.6px;color:#fff8eb;text-shadow:0 1px 4px rgba(0,0,0,.85)}
  .jg-prog-track{position:relative;width:10px;height:158px;border-radius:99px;background:rgba(15,23,42,.62);border:2px solid rgba(255,248,235,.82);box-shadow:0 6px 16px rgba(0,0,0,.26)}
  .jg-prog-dots{position:absolute;inset:6px 0}
  .jg-prog-dot{position:absolute;left:50%;transform:translate(-50%,50%);width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.45);transition:bottom .1s linear}
  .jg-prog-dot.me{width:17px;height:17px;border:2.5px solid #fff;box-shadow:0 0 0 3px rgba(255,190,11,.9),0 3px 8px rgba(0,0,0,.5)}

  /* Overhead Floating Player Coin Counter */
  .jg-overhead{position:fixed;top:0;left:0;display:none;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;background:rgba(15,23,42,.84);border:2px solid #ffbe0b;color:#fff8eb;font-family:var(--jg-disp);font-weight:700;font-size:15px;line-height:1;box-shadow:0 4px 12px rgba(0,0,0,.35);pointer-events:none;z-index:13;will-change:transform}
  .jg-overhead.show{display:inline-flex}
  .jg-overhead.first{border-color:#ffe600;box-shadow:0 0 12px rgba(255,190,11,.55)}
  .jg-ov-crown{font-size:14px;line-height:1}
  .jg-ov-ico{font-size:13px;line-height:1}
  .jg-overhead b{color:#ffe600;font-variant-numeric:tabular-nums}
  .jg-hud.invuln .jg-overhead{animation:jgBlink .28s steps(2) infinite}

  /* Toasts: Bottom-Left unobtrusive popups (above minimap during race) */
  .jg-toasts{position:fixed;left:24px;bottom:28px;display:flex;flex-direction:column;align-items:flex-start;gap:5px;max-width:min(300px,calc(100vw - 48px));pointer-events:none;z-index:25}
  .jg-toasts.in-race{left:14px;bottom:142px}
  .jg-toast{font-size:12.5px;font-weight:800;line-height:1.3;text-align:left;background:var(--jg-surface);border:2px solid var(--jg-line);border-radius:12px;padding:7px 13px;box-shadow:0 8px 20px rgba(15,23,42,.24);animation:jgToastIn .24s cubic-bezier(.2,.9,.3,1.3);transition:opacity .28s ease,transform .28s ease}
  .jg-toast.good{border-color:var(--jg-green);color:#166534;background:rgba(240,253,244,.94)}
  .jg-toast.warn{border-color:var(--jg-orange);color:#9a3412}
  .jg-toast.bad{border-color:var(--jg-red);color:#991b1b}
  .jg-toast.out{opacity:0;transform:translateY(-10px)}

  /* Bottom Controls */
  .jg-pad{position:absolute;bottom:146px;width:82px;height:82px;border-radius:26px;display:none;place-items:center;font-size:28px;color:#fff8eb;background:rgba(15,23,42,.52);border:2px solid rgba(255,248,235,.55);box-shadow:0 8px 20px rgba(0,0,0,.28);pointer-events:auto;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .1s,background .12s}
  .jg-pad.left{left:14px}.jg-pad.right{right:14px}
  .jg-pad.on{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;transform:scale(.94)}
  .jg-telolet{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);min-height:64px;min-width:110px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 20px;border-radius:99px;border:2px solid #ffbe0b;background:rgba(15,23,42,.82);color:#ffe600;font-family:var(--jg-disp);font-weight:700;font-size:14px;box-shadow:0 6px 16px rgba(0,0,0,.3);pointer-events:auto;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .12s,opacity .15s}
  .jg-telolet.locked{opacity:.55}
  .jg-telolet kbd{background:rgba(255,255,255,.16);color:#fff8eb;border-color:rgba(255,255,255,.35)}
  .jg-telolet:hover{transform:translateX(-50%) translateY(-2px)}
  .jg-telolet:active{transform:translateX(-50%) scale(.93)}
  .jg-telolet.honk{animation:jgHornPop .34s cubic-bezier(.2,.9,.3,1.5)}
  .jg-telolet-em{font-size:28px;line-height:1}
  .jg-crash{position:absolute;inset:0;opacity:0;background:radial-gradient(120% 90% at 50% 50%,transparent 40%,rgba(229,72,77,.55));pointer-events:none}
  .jg-crash.on{animation:jgCrash .45s ease-out}

  /* Modal & Rising Podium */
  .jg-modal{display:grid;place-items:center;background:rgba(59,47,47,.42);backdrop-filter:blur(4px);padding:18px}
  .jg-modal-card{width:min(420px,100%);padding:24px;text-align:center;max-height:92vh;overflow-y:auto}
  .jg-over-card{width:min(470px,100%)}
  .jg-big-em{font-size:44px}
  .jg-modal-card h2{font-family:var(--jg-disp);font-weight:700;font-size:23px;margin:8px 0 6px;line-height:1.15}
  .jg-modal-card p{font-size:12.5px;color:var(--jg-soft);line-height:1.6;margin-bottom:15px}
  .jg-modal-card .jg-btn.primary{width:100%}
  .jg-record{display:none;font-family:var(--jg-disp);font-weight:700;font-size:14px;color:#fff;background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));border-radius:99px;padding:6px 14px;margin:0 auto 12px;width:fit-content}
  .jg-record.show{display:block;animation:jgPop .4s}
  .jg-podium{position:relative;overflow:hidden;margin:8px 0 14px;background:rgba(59,47,47,.05);border:1.5px solid var(--jg-line);border-radius:16px;padding:12px 10px 10px}
  .jg-confetti-wrap{position:absolute;inset:0;pointer-events:none;overflow:hidden}
  .jg-confetti-bit{position:absolute;top:-10px;width:7px;height:11px;border-radius:2px;opacity:.9;animation:jgConfetti 2.1s linear infinite}
  .jg-podium-stage{position:relative;z-index:1;display:flex;align-items:flex-end;justify-content:center;gap:8px;min-height:152px;padding-top:10px}
  .jg-pod-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px}
  .jg-pod-racer{display:flex;flex-direction:column;align-items:center;gap:4px;animation:jgPop .45s backwards}
  .jg-pod-flames{font-size:16px;line-height:1;animation:jgFlamePulse .7s ease-in-out infinite alternate}
  .jg-pod-col.pos-1 .jg-pod-racer{animation-delay:.18s}
  .jg-pod-col.pos-2 .jg-pod-racer{animation-delay:.08s}
  .jg-pod-col.pos-3 .jg-pod-racer{animation-delay:.28s}
  .jg-pod-ico .jg-vsvg{width:48px;height:26px}
  .jg-pod-name{font-size:12px;font-weight:800;color:var(--jg-ink);line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .jg-pod-col.me .jg-pod-name{color:var(--jg-orange)}
  .jg-pod-block{width:100%;border-radius:12px 12px 8px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:2px solid var(--slot-col,var(--jg-amber));transform-origin:bottom;animation:jgPodiumRise .6s cubic-bezier(.2,.9,.3,1.2) backwards;box-shadow:0 6px 14px rgba(122,72,20,.16);padding:4px}
  .jg-pod-col.pos-1 .jg-pod-block{height:88px;background:linear-gradient(180deg,#ffe066,#ffbe0b);animation-delay:.12s}
  .jg-pod-col.pos-2 .jg-pod-block{height:68px;background:linear-gradient(180deg,#f1f5f9,#cbd5e1);animation-delay:.02s}
  .jg-pod-col.pos-3 .jg-pod-block{height:56px;background:linear-gradient(180deg,#fed7aa,#fb923c);animation-delay:.22s}
  .jg-pod-medal{font-size:18px;line-height:1}
  .jg-pod-block b{font-family:var(--jg-disp);font-size:13px;color:var(--jg-ink)}
  .jg-pod-coins{font-size:12px;font-weight:800;color:#5c3400;background:rgba(255,255,255,.6);border-radius:99px;padding:1px 7px}
  .jg-pod-fourth{position:relative;z-index:1;margin-top:8px;padding:5px 10px;border-radius:99px;background:var(--jg-paper);border:1px solid var(--jg-line);font-size:12px;font-weight:700;color:var(--jg-soft)}
  .jg-pod-fourth.me{border-color:var(--jg-orange);color:var(--jg-orange)}
  #jg-over-continue{margin-bottom:8px}
  .jg-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:15px}
  .jg-stats div{background:var(--jg-paper);border:1.5px solid var(--jg-line);border-radius:13px;padding:10px}
  .jg-stats .jg-stat-wide{grid-column:1 / -1;background:linear-gradient(135deg,#fff8eb,#ffefd6);border-color:var(--jg-amber)}
  .jg-stats b{display:block;font-family:var(--jg-disp);font-weight:700;font-size:20px}
  .jg-stats span{font-size:12px;font-weight:800;letter-spacing:.7px;color:var(--jg-soft)}
  .jg-fatal{position:fixed;inset:0;z-index:95;display:none;place-items:center;background:linear-gradient(160deg,#ffd9a8,#fff3e0);pointer-events:auto}
  .jg-fatal.show{display:grid}
  .jg-fatal-card{max-width:380px;margin:20px;padding:28px;text-align:center}

  @keyframes jgBounce{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-13px) rotate(2deg)}}
  @keyframes jgRoad{to{background-position:-30px 0}}
  @keyframes jgPop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes jgPodiumRise{from{transform:scaleY(.05);opacity:0}to{transform:scaleY(1);opacity:1}}
  @keyframes jgCoinPop{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1)}}
  @keyframes jgHeartHurt{0%{transform:scale(1)}30%{transform:scale(1.16) rotate(-4deg)}60%{transform:scale(.94) rotate(4deg)}100%{transform:scale(1)}}
  @keyframes jgCountdown{0%{transform:translate(-50%,-50%) scale(.45);opacity:0}22%{transform:translate(-50%,-50%) scale(1.12);opacity:1}72%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(-50%,-50%) scale(1.38);opacity:0}}
  @keyframes jgHornPop{0%{transform:translateX(-50%) scale(1)}35%{transform:translateX(-50%) scale(1.18) rotate(-4deg)}70%{transform:translateX(-50%) scale(1.08) rotate(3deg)}100%{transform:translateX(-50%) scale(1)}}
  @keyframes jgToastIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}
  @keyframes jgBlink{50%{opacity:.35}}
  @keyframes jgCrash{0%{opacity:1}100%{opacity:0}}
  @keyframes jgFlamePulse{from{transform:translateY(0) scale(1)}to{transform:translateY(-3px) scale(1.12)}}
  @keyframes jgConfetti{0%{transform:translateY(-10px) rotate(0deg);opacity:.95}100%{transform:translateY(190px) rotate(320deg);opacity:0}}

  @media (pointer:coarse),(max-width:860px){
    .jg-pad{display:grid}
    .jg-telolet{bottom:20px;padding:10px 20px}
    .jg-telolet kbd{display:none}
  }
  @media (max-width:720px){
    .jg-arenas{grid-template-columns:1fr}
    .jg-fleet{grid-template-columns:1fr 1fr}
    .jg-rooms{grid-template-columns:1fr}
    .jg-name-row{flex-direction:column;align-items:stretch;gap:8px}
    .jg-card-tag{min-height:0}
    .jg-menu-stage{align-items:flex-start;padding:0 0 8px}
    .jg-menu-card{width:100%;padding:18px 16px;gap:14px;max-height:none}
    .jg-menu{padding:12px;gap:10px}
    .jg-brand-sub{display:none}
    .jg-hud-tl{top:10px;left:10px;gap:5px}
    .jg-hud-tr{top:10px;right:10px}
    .jg-hud-bl{bottom:10px;left:10px}
    .jg-minimap{width:96px;height:96px}
    .jg-toasts.in-race{left:10px;bottom:114px}
    .jg-hud-br{bottom:10px;right:10px;padding:6px 9px}
    .jg-speedo{width:90px;height:56px}
    .jg-speedo-txt b{font-size:19px}
    .jg-boost-bar{width:90px}
    .jg-progress-rail{right:10px}
    .jg-prog-track{height:132px}
    .jg-lb-name{display:none}
    .jg-pad{width:76px;height:76px;bottom:126px}
    .jg-pad.left{left:10px}.jg-pad.right{right:10px}
    .jg-legend{font-size:12px}
  }
  @media (prefers-reduced-motion:reduce){#jg-root *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  `;
  document.head.appendChild(s);
}
