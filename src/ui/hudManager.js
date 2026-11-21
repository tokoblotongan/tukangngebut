/* =====================================================================
   hudManager.js — Seluruh antarmuka game: layar muat, menu armada,
   HUD balapan (skor, jarak, nyawa, combo, speed, turbo), banner stunt,
   kontrol sentuh, jeda, mogok/rekor, toast, dan mesin audio sintetis
   (WebAudio, tanpa aset eksternal — gratis & offline).
   API ringkas ada di objek yang dikembalikan createHUD().
   ===================================================================== */
import { VEHICLES, GAME, PALETTE as P } from '../config/gameConfig.js';
import { PUBLIC_ROOMS, normalizeRoomId } from '../network/multiplayerHook.js';

const EMOJI = { angkot: '🚐', bemo: '🛺', l300: '🛻', ojol: '🏍️' };
const DIFFS = [
  { id: 'santai', label: 'Santai', note: '5 nyawa • skor ×0.8', emoji: '🌤️' },
  { id: 'normal', label: 'Normal', note: '3 nyawa • skor ×1.0', emoji: '🔥' },
  { id: 'ngebut', label: 'Ngebut', note: '2 nyawa • skor ×1.35', emoji: '⚡' },
];

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
    menu: $('jg-menu'), fleet: $('jg-fleet'), diffs: $('jg-diffs'), diffNote: $('jg-diff-note'),
    rooms: $('jg-rooms'), roomActive: $('jg-room-active'),
    roomInput: /** @type {HTMLInputElement | null} */ ($('jg-room-input')),
    roomJoin: $('jg-room-join'),
    nameInput: /** @type {HTMLInputElement | null} */ ($('jg-name-input')),
    bestMenu: $('jg-best-menu'), btnStart: $('jg-start'),
    hud: $('jg-hud'), score: $('jg-score'), dist: $('jg-dist'), coins: $('jg-coins'), coinsWrap: $('jg-coins-wrap'),
    hearts: $('jg-hearts'), combo: $('jg-combo'), speed: $('jg-speed'), speedBar: $('jg-speed-bar'),
    turboWrap: $('jg-turbo'), turboFill: $('jg-turbo-fill'),
    cpFill: $('jg-cp-fill'), cpLabel: $('jg-cp-label'), fleetTag: $('jg-fleet-tag'),
    banner: $('jg-banner'), bannerTitle: $('jg-banner-title'), bannerPts: $('jg-banner-pts'),
    airHint: $('jg-airhint'), toasts: $('jg-toasts'), net: $('jg-net'), netMenu: $('jg-net-menu'),
    pause: $('jg-pause'), over: $('jg-over'),
    overScore: $('jg-over-score'), overDist: $('jg-over-dist'), overRolls: $('jg-over-rolls'),
    overCoins: $('jg-over-coins'), overBest: $('jg-over-best'), overRecord: $('jg-over-record'), overTitle: $('jg-over-title'),
    btnAudio: $('jg-audio'), btnAudioMenu: $('jg-audio-menu'), btnAudioPause: $('jg-audio-pause'),
    btnQuality: $('jg-quality'), btnPause: $('jg-pause-btn'),
    padL: $('jg-pad-l'), padR: $('jg-pad-r'), crashFlash: $('jg-crash'),
  };

  const input = { left: false, right: false };
  const sfx = createAudioEngine();
  let muted = localStorage.getItem('jg_muted') === '1';
  let hd = true;
  let selectedVehicle = localStorage.getItem('jg_vehicle') || 'angkot';
  if (!VEHICLES[selectedVehicle]) selectedVehicle = 'angkot';
  let selectedDiff = localStorage.getItem('jg_diff') || 'normal';
  if (!DIFFS.some((d) => d.id === selectedDiff)) selectedDiff = 'normal';
  let selectedRoom = normalizeRoomId(localStorage.getItem('jg_room') || 'salatiga-1');
  let lobbyCounts = {};

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
      localStorage.setItem('jg_vehicle', key);
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
    el.fleetTag.textContent = `${EMOJI[selectedVehicle]} ${VEHICLES[selectedVehicle].label}`;
  }

  /* ---------- Difficulty ---------- */
  for (const d of DIFFS) {
    const b = document.createElement('button');
    b.className = 'jg-diff'; b.dataset.key = d.id;
    b.innerHTML = `<span>${d.emoji}</span>${d.label}`;
    b.addEventListener('click', () => {
      selectedDiff = d.id;
      localStorage.setItem('jg_diff', d.id);
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
    try { localStorage.setItem('jg_room', selectedRoom); } catch {}
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

  if (el.nameInput) {
    const savedName = localStorage.getItem('jg_player_name');
    if (savedName) el.nameInput.value = savedName;
    const commitName = () => {
      const clean = (el.nameInput?.value || '').trim().slice(0, 18);
      if (clean) opts.onNameChange?.(clean);
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
  $('jg-over-restart').addEventListener('click', () => { sfx.ui(); opts.onRestart?.(); });
  $('jg-over-menu').addEventListener('click', () => { sfx.ui(); opts.onMenu?.(); });
  $('jg-fatal-reload').addEventListener('click', () => location.reload());

  function paintAudio() {
    const icon = muted ? '🔇' : '🔊';
    for (const b of [el.btnAudio, el.btnAudioMenu, el.btnAudioPause]) {
      b.textContent = icon;
      b.setAttribute('aria-pressed', String(!muted));
      b.title = muted ? 'Nyalakan suara (M)' : 'Bisukan suara (M)';
    }
  }
  function toggleAudio() {
    muted = !muted;
    localStorage.setItem('jg_muted', muted ? '1' : '0');
    sfx.setMuted(muted); paintAudio();
    if (!muted) { sfx.resume(); sfx.ui(); }
    opts.onAudio?.(!muted);
  }
  for (const b of [el.btnAudio, el.btnAudioMenu, el.btnAudioPause]) b.addEventListener('click', toggleAudio);
  sfx.setMuted(muted); paintAudio();

  el.btnQuality.addEventListener('click', () => {
    hd = !hd;
    el.btnQuality.textContent = hd ? 'HD' : 'ECO';
    el.btnQuality.setAttribute('aria-pressed', String(hd));
    sfx.ui(); opts.onQuality?.(hd);
  });

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

  /* ---------- Cache nilai agar tidak thrash DOM ---------- */
  const last = {};
  function setText(node, key, val) { if (last[key] !== val) { last[key] = val; node.textContent = val; } }

  let bannerTimer = 0, toastSeq = 0;

  const api = {
    input, sfx,
    get vehicle() { return selectedVehicle; },
    get difficulty() { return selectedDiff; },
    get room() { return selectedRoom; },

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
      el.menu.classList.add('show');
      el.hud.classList.remove('show');
      el.pause.classList.remove('show');
      el.over.classList.remove('show');
      el.bestMenu.textContent = `🏆 Rekor: ${Math.round(best).toLocaleString('id-ID')}`;
      paintFleet();
    },
    hideMenu() { el.menu.classList.remove('show'); },
    showHUD() { el.hud.classList.add('show'); },
    hideHUD() { el.hud.classList.remove('show'); },

    updateHUD(s) {
      setText(el.score, 'score', Math.round(s.score).toLocaleString('id-ID'));
      setText(el.dist, 'dist', `${Math.round(s.distance)} m`);
      const coinVal = Math.round(s.coins ?? 0);
      if (last.coinsNum !== coinVal) {
        if (last.coinsNum !== undefined && coinVal > last.coinsNum) {
          el.coinsWrap.classList.remove('pop');
          void el.coinsWrap.offsetWidth;
          el.coinsWrap.classList.add('pop');
        }
        last.coinsNum = coinVal;
      }
      setText(el.coins, 'coins', coinVal.toLocaleString('id-ID'));
      setText(el.speed, 'speed', String(Math.round(s.speed * 3.6)));
      el.speedBar.style.width = `${Math.min(100, s.speedRatio * 100)}%`;
      const hearts = '❤️'.repeat(s.hearts) + '🖤'.repeat(Math.max(0, s.maxHearts - s.hearts));
      setText(el.hearts, 'hearts', hearts);
      if (s.combo > 1) {
        el.combo.classList.add('show');
        setText(el.combo, 'combo', `×${s.combo} RANTAI`);
      } else el.combo.classList.remove('show');
      el.turboWrap.classList.toggle('show', s.turbo > 0);
      el.turboFill.style.width = `${Math.max(0, Math.min(1, s.turbo)) * 100}%`;
      el.cpFill.style.width = `${Math.min(100, (s.distance % 500) / 5)}%`;
      setText(el.cpLabel, 'cp', `Checkpoint ${s.nextCheckpoint} m`);
      el.hud.classList.toggle('invuln', s.invuln > 0);
    },

    setAirHint(on) { el.airHint.classList.toggle('show', on); },

    showStunt(title, points) {
      el.bannerTitle.textContent = title;
      el.bannerPts.textContent = points > 0 ? `+${Math.round(points).toLocaleString('id-ID')}` : '';
      el.banner.classList.remove('show');
      void el.banner.offsetWidth;
      el.banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => el.banner.classList.remove('show'), 1500);
    },

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
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2000);
      while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
      return id;
    },

    setPaused(on) { el.pause.classList.toggle('show', on); },

    showGameOver(r) {
      el.overScore.textContent = Math.round(r.score).toLocaleString('id-ID');
      el.overDist.textContent = `${Math.round(r.distance)} m`;
      el.overRolls.textContent = String(r.rolls);
      el.overCoins.textContent = Math.round(r.coins ?? 0).toLocaleString('id-ID');
      el.overBest.textContent = Math.round(r.best).toLocaleString('id-ID');
      el.overRecord.classList.toggle('show', r.newRecord);
      el.overTitle.textContent = r.newRecord ? 'REKOR BARU, JURAGAN!' : 'MOGOK DI JALAN!';
      el.over.classList.add('show');
      el.hud.classList.remove('show');
    },
    hideGameOver() { el.over.classList.remove('show'); },

    setPlayerName(name) {
      if (el.nameInput && name && !el.nameInput.value) el.nameInput.value = name;
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
      for (const node of [el.net, el.netMenu]) {
        if (!node) continue;
        node.className = `jg-net ${cls}`;
        node.textContent = `● ${label}`;
      }
      if (room) {
        selectedRoom = normalizeRoomId(room);
        paintRooms();
      }
    },

    setMuted(m) { muted = m; sfx.setMuted(m); paintAudio(); },
    toggleAudio,

    dispose() {
      clearTimeout(bannerTimer);
      sfx.dispose();
      wrap.remove();
    },
  };
  return api;
}

/* ==================== Audio sintetis (WebAudio, tanpa file) ==================== */
function createAudioEngine() {
  let ac = null, master = null, muted = false;
  let engOsc = null, engSub = null, engGain = null, engFilter = null, roadGain = null, noiseBuf = null;
  let engineOn = false;

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
    engineOn = active;
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
    gameover() { [523, 440, 349, 262].forEach((f, i) => tone(f, 0.34, 'triangle', 0.26, null, i * 0.16)); },
    setMuted(m) {
      muted = m;
      if (master && ac) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.05);
    },
    dispose() { try { engOsc?.stop(); engSub?.stop(); ac?.close(); } catch {} ac = null; engOsc = null; },
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
      <div class="jg-brand"><span class="jg-brand-em">🚐</span>
        <div><h1>JURAGAN <em>NGEBUT</em></h1><span class="jg-brand-sub">MINI RACE NUSANTARA • SALATIGA</span></div>
      </div>
      <div class="jg-menu-tools">
        <span id="jg-net-menu" class="jg-net solo">● SOLO • AI MODE</span>
        <button id="jg-audio-menu" class="jg-icon" aria-pressed="true">🔊</button>
      </div>
    </div>
    <div class="jg-panel jg-menu-card">
      <div class="jg-name-row">
        <label for="jg-name-input">Nama Juragan</label>
        <input id="jg-name-input" class="jg-input" type="text" maxlength="18" placeholder="Tulis namamu di trek…" autocomplete="off" />
      </div>
      <div class="jg-menu-head">
        <h2>Pilih Armada</h2><span id="jg-best-menu" class="jg-chip gold">🏆 Rekor: 0</span>
      </div>
      <div id="jg-fleet" class="jg-fleet"></div>
      <div class="jg-menu-head mt"><h2>Pilih Kamar Server</h2><span id="jg-room-active" class="jg-chip live-room">🌐 SALATIGA-1</span></div>
      <div id="jg-rooms" class="jg-rooms"></div>
      <div class="jg-private-row">
        <input id="jg-room-input" class="jg-input" type="text" maxlength="20" placeholder="Buat / Gabung Kamar Privat (cth: KOP-88 atau SALATIGA)…" autocomplete="off" />
        <button id="jg-room-join" class="jg-btn small" type="button">Gabung 🔒</button>
      </div>
      <div class="jg-menu-head mt"><h2>Tingkat Ngebut</h2><span id="jg-diff-note" class="jg-chip">3 nyawa • skor ×1.0</span></div>
      <div id="jg-diffs" class="jg-diffs"></div>
      <button id="jg-start" class="jg-btn primary big">GAS! 🏁</button>
      <div class="jg-legend">
        <span><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> belok</span>
        <span><kbd>←</kbd><kbd>→</kbd> di udara = <b>Barrel Roll</b> → Turbo</span>
        <span><kbd>P</kbd> jeda • <kbd>R</kbd> ulang • <kbd>M</kbd> suara</span>
        <span>📱 Sentuh pads kiri/kanan di layar</span>
      </div>
      <div class="jg-objective">🎯 Kumpulkan koin &amp; buah segar, salip ketat, hajar ramp, dan raih rantai stunt. Checkpoint tiap 500 m memberi bonus!</div>
    </div>
  </div>

  <div id="jg-hud" class="jg-hud">
    <div class="jg-hud-left jg-panel">
      <div class="jg-score-lbl">SKOR</div>
      <div id="jg-score" class="jg-score">0</div>
      <div class="jg-row">
        <span id="jg-dist" class="jg-chip">0 m</span>
        <span id="jg-coins-wrap" class="jg-chip coin">🪙 <b id="jg-coins">0</b></span>
        <span id="jg-fleet-tag" class="jg-chip">🚐 Angkot</span>
      </div>
      <div id="jg-hearts" class="jg-hearts">❤️❤️❤️</div>
      <div class="jg-cp"><div class="jg-cp-track"><div id="jg-cp-fill" class="jg-cp-fill"></div></div><span id="jg-cp-label">Checkpoint 500 m</span></div>
    </div>
    <div class="jg-hud-right">
      <div class="jg-tools">
        <span id="jg-net" class="jg-net solo">● SOLO • AI MODE</span>
        <button id="jg-quality" class="jg-icon txt" aria-pressed="true">HD</button>
        <button id="jg-audio" class="jg-icon" aria-pressed="true">🔊</button>
        <button id="jg-pause-btn" class="jg-icon" title="Jeda (P)">⏸</button>
      </div>
      <div class="jg-panel jg-speedo">
        <div><span id="jg-speed" class="jg-speed">0</span><span class="jg-unit">km/j</span></div>
        <div class="jg-speed-track"><div id="jg-speed-bar" class="jg-speed-bar"></div></div>
        <div id="jg-turbo" class="jg-turbo"><span>🔥 TURBO</span><div class="jg-turbo-track"><div id="jg-turbo-fill" class="jg-turbo-fill"></div></div></div>
      </div>
      <div id="jg-combo" class="jg-combo">×2 RANTAI</div>
    </div>
    <div id="jg-banner" class="jg-banner"><div id="jg-banner-title" class="jg-banner-title">BARREL ROLL!</div><div id="jg-banner-pts" class="jg-banner-pts">+250</div></div>
    <div id="jg-airhint" class="jg-airhint">⬅️ TAHAN KIRI / KANAN ➡️ UNTUK BARREL ROLL!</div>
    <div id="jg-toasts" class="jg-toasts"></div>
    <div id="jg-pad-l" class="jg-pad left" aria-label="Belok kiri">◀</div>
    <div id="jg-pad-r" class="jg-pad right" aria-label="Belok kanan">▶</div>
    <div id="jg-crash" class="jg-crash"></div>
  </div>

  <div id="jg-pause" class="jg-overlay jg-modal"><div class="jg-panel jg-modal-card">
    <div class="jg-big-em">⏸</div><h2>JEDA DULU</h2>
    <p>Mesin masih panas, Juragan. Lanjut kapan saja.</p>
    <button id="jg-resume" class="jg-btn primary">LANJUT ▶</button>
    <div class="jg-btn-row">
      <button id="jg-pause-restart" class="jg-btn">🔁 Ulang</button>
      <button id="jg-pause-menu" class="jg-btn">🚐 Armada</button>
      <button id="jg-audio-pause" class="jg-btn icon" aria-pressed="true">🔊</button>
    </div>
  </div></div>

  <div id="jg-over" class="jg-overlay jg-modal"><div class="jg-panel jg-modal-card">
    <div class="jg-big-em">🏁</div><h2 id="jg-over-title">MOGOK DI JALAN!</h2>
    <div id="jg-over-record" class="jg-record">✨ REKOR BARU ✨</div>
    <div class="jg-stats">
      <div><b id="jg-over-score">0</b><span>SKOR</span></div>
      <div><b id="jg-over-dist">0 m</b><span>JARAK</span></div>
      <div><b id="jg-over-coins">0</b><span>KOIN</span></div>
      <div><b id="jg-over-rolls">0</b><span>BARREL ROLL</span></div>
      <div class="jg-stat-wide"><b id="jg-over-best">0</b><span>REKOR TERBAIK</span></div>
    </div>
    <button id="jg-over-restart" class="jg-btn primary big">GAS LAGI 🔁</button>
    <button id="jg-over-menu" class="jg-btn">🚐 Ganti Armada</button>
  </div></div>`;
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
  #jg-root kbd{background:var(--jg-paper);border:1px solid var(--jg-line);border-bottom-width:2px;border-radius:5px;padding:1px 6px;font-size:10.5px;font-family:var(--jg-body)}
  .jg-panel{background:var(--jg-surface);border:2px solid var(--jg-line);border-radius:18px;box-shadow:var(--jg-shadow);backdrop-filter:blur(12px)}
  .jg-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;background:var(--jg-paper);border:1.5px solid var(--jg-line);border-radius:99px;padding:4px 10px;color:var(--jg-soft);font-variant-numeric:tabular-nums}
  .jg-chip.gold{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;border-color:var(--jg-orange)}
  .jg-chip.coin{background:linear-gradient(135deg,#fff3bf,#ffd166);color:#6e3f00;border-color:#f4a261}
  .jg-chip.coin b{font-family:var(--jg-disp);font-weight:700}
  .jg-chip.coin.pop{animation:jgCoinPop .28s cubic-bezier(.2,.9,.3,1.4)}
  .jg-btn{pointer-events:auto;border:2px solid var(--jg-line);background:var(--jg-paper);color:var(--jg-ink);font-weight:800;font-size:13.5px;border-radius:14px;padding:12px 18px;transition:transform .14s,background .2s,border-color .2s;box-shadow:0 6px 16px rgba(122,72,20,.14)}
  .jg-btn:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-btn:active{transform:scale(.96)}
  .jg-btn.primary{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;border-color:var(--jg-orange);text-shadow:0 1px 2px rgba(120,60,0,.35)}
  .jg-btn.big{width:100%;font-size:19px;font-family:var(--jg-disp);font-weight:700;padding:15px;margin-top:14px;letter-spacing:.5px}
  .jg-btn.icon{flex:none;width:52px}
  .jg-btn-row{display:flex;gap:8px;margin-top:9px}
  .jg-btn-row .jg-btn{flex:1}
  #jg-root button:focus-visible,.jg-card:focus-visible,.jg-diff:focus-visible{outline:3px solid var(--jg-blue);outline-offset:2px}
  .jg-icon{pointer-events:auto;width:42px;height:42px;border-radius:13px;border:2px solid var(--jg-line);background:var(--jg-surface);backdrop-filter:blur(8px);font-size:17px;display:grid;place-items:center;box-shadow:0 6px 16px rgba(122,72,20,.16);transition:transform .14s,border-color .2s}
  .jg-icon.txt{font-size:11px;font-weight:800;letter-spacing:.5px}
  .jg-icon:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-icon:active{transform:scale(.93)}
  .jg-icon[aria-pressed="false"]{opacity:.6}

  /* Loader */
  .jg-loader{position:fixed;inset:0;z-index:90;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(160deg,#ffd9a8,#ffe5cc 34%,#fff3e0 68%,#ffe9d2);transition:opacity .7s,visibility .7s}
  .jg-loader.done{opacity:0;visibility:hidden}
  .jg-load-van{font-size:56px;animation:jgBounce 1s cubic-bezier(.3,.7,.4,1) infinite;filter:drop-shadow(0 10px 12px rgba(122,72,20,.3))}
  .jg-load-road{width:180px;height:5px;margin:10px 0 24px;border-radius:99px;background:repeating-linear-gradient(90deg,var(--jg-soft) 0 16px,transparent 16px 30px);opacity:.35;animation:jgRoad .5s linear infinite}
  .jg-loader h1{font-family:var(--jg-disp);font-weight:700;font-size:clamp(30px,6vw,50px);letter-spacing:1px}
  .jg-loader h1 em{font-style:normal;color:var(--jg-red)}
  .jg-load-sub{margin-top:8px;font-size:11.5px;font-weight:800;letter-spacing:2.6px;color:var(--jg-soft)}
  .jg-load-track{width:min(320px,74vw);height:12px;margin-top:28px;border-radius:99px;background:rgba(59,47,47,.1);border:1.5px solid var(--jg-line);overflow:hidden}
  .jg-load-fill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--jg-amber),var(--jg-orange),var(--jg-red));transition:width .35s cubic-bezier(.2,.8,.2,1)}
  .jg-load-status{margin-top:12px;font-size:12.5px;font-weight:700;color:var(--jg-soft)}

  /* Overlay umum */
  .jg-overlay{position:fixed;inset:0;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .35s,visibility .35s}
  .jg-overlay.show{opacity:1;visibility:visible;pointer-events:auto}
  .jg-menu{display:flex;flex-direction:column;padding:16px;gap:12px;background:radial-gradient(120% 90% at 50% 0%,rgba(255,229,204,.55),rgba(255,243,224,.82));overflow-y:auto}
  .jg-menu-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none}
  .jg-brand{display:flex;align-items:center;gap:11px}
  .jg-brand-em{font-size:38px;filter:drop-shadow(0 4px 7px rgba(122,72,20,.3))}
  .jg-brand h1{font-family:var(--jg-disp);font-weight:700;font-size:clamp(21px,3.6vw,32px);line-height:1}
  .jg-brand h1 em{font-style:normal;color:var(--jg-red)}
  .jg-brand-sub{font-size:10px;font-weight:800;letter-spacing:1.8px;color:var(--jg-soft)}
  .jg-menu-tools{display:flex;gap:8px}
  .jg-menu-card{width:min(760px,100%);margin:auto;padding:20px;max-height:calc(100vh - 120px);overflow-y:auto}
  .jg-menu-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}
  .jg-menu-head.mt{margin-top:16px}
  .jg-menu-head h2{font-family:var(--jg-disp);font-weight:600;font-size:19px}
  .jg-fleet{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
  .jg-card{position:relative;pointer-events:auto;display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:15px;padding:11px;transition:transform .16s,border-color .2s,box-shadow .2s}
  .jg-card:hover{transform:translateY(-3px);border-color:var(--jg-amber)}
  .jg-card.on{border-color:var(--jg-orange);box-shadow:0 0 0 3px rgba(255,197,61,.35),0 10px 22px rgba(122,72,20,.2);background:linear-gradient(160deg,#fff8eb,#ffefd6)}
  .jg-card-em{font-size:27px}
  .jg-card-name{font-family:var(--jg-disp);font-weight:600;font-size:14.5px;line-height:1.1}
  .jg-card-tag{font-size:10px;font-weight:700;color:var(--jg-orange);line-height:1.25;min-height:24px}
  .jg-card-check{position:absolute;top:8px;right:9px;width:19px;height:19px;border-radius:99px;background:var(--jg-orange);color:#fff;font-size:11px;display:none;place-items:center}
  .jg-card.on .jg-card-check{display:grid}
  .jg-bars{display:flex;flex-direction:column;gap:3px;width:100%;margin-top:4px}
  .jg-bar{display:flex;align-items:center;gap:5px}
  .jg-bar i{font-style:normal;font-size:8px;font-weight:800;color:var(--jg-soft);width:22px}
  .jg-bar b{flex:1;height:5px;border-radius:99px;background:rgba(59,47,47,.1);overflow:hidden}
  .jg-bar u{display:block;height:100%;border-radius:99px}
  .jg-diffs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .jg-diff{pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:800;font-size:13px;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:13px;padding:11px;transition:transform .15s,border-color .2s}
  .jg-diff:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-diff.on{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;border-color:var(--jg-orange)}
  .jg-name-row{display:flex;align-items:center;gap:10px;margin-bottom:13px;padding-bottom:12px;border-bottom:1.5px dashed var(--jg-line)}
  .jg-name-row label{font-family:var(--jg-disp);font-weight:600;font-size:15px;white-space:nowrap}
  .jg-input{pointer-events:auto;user-select:text;flex:1;min-width:0;font-family:var(--jg-body);font-weight:700;font-size:13px;color:var(--jg-ink);background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:12px;padding:9px 12px;outline:none;transition:border-color .2s,box-shadow .2s}
  .jg-input:focus{border-color:var(--jg-blue);box-shadow:0 0 0 3px rgba(58,134,255,.2)}
  .jg-chip.live-room{background:rgba(236,253,245,.95);border-color:rgba(16,185,129,.45);color:#0f766e}
  .jg-rooms{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .jg-room-btn{pointer-events:auto;display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;background:var(--jg-paper);border:2px solid var(--jg-line);border-radius:13px;padding:9px 11px;transition:transform .15s,border-color .2s,box-shadow .2s}
  .jg-room-btn:hover{transform:translateY(-2px);border-color:var(--jg-amber)}
  .jg-room-btn.on{border-color:var(--jg-green);background:linear-gradient(160deg,#ecfdf5,#d1fae5);box-shadow:0 0 0 3px rgba(56,176,0,.18)}
  .jg-room-name{font-family:var(--jg-disp);font-weight:600;font-size:13.5px;color:var(--jg-ink)}
  .jg-room-name small{font-family:var(--jg-body);font-size:10px;font-weight:700;color:var(--jg-soft)}
  .jg-room-cnt{font-size:10.5px;font-weight:800;color:#0f766e}
  .jg-private-row{display:flex;gap:8px;margin-top:8px}
  .jg-btn.small{padding:9px 14px;font-size:12.5px;border-radius:12px;white-space:nowrap}
  .jg-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:13px;font-size:11px;font-weight:700;color:var(--jg-soft)}
  .jg-legend b{color:var(--jg-red)}
  .jg-objective{margin-top:11px;font-size:11.5px;font-weight:700;line-height:1.5;color:var(--jg-soft);background:rgba(63,163,77,.1);border:1.5px solid rgba(63,163,77,.3);border-radius:12px;padding:9px 12px}

  /* HUD */
  .jg-hud{position:fixed;inset:0;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}
  .jg-hud.show{opacity:1;visibility:visible}
  .jg-hud-left{position:absolute;top:14px;left:14px;padding:12px 14px;min-width:172px}
  .jg-score-lbl{font-size:9.5px;font-weight:800;letter-spacing:2px;color:var(--jg-soft)}
  .jg-score{font-family:var(--jg-disp);font-weight:700;font-size:34px;line-height:1;color:var(--jg-ink)}
  .jg-row{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}
  .jg-hearts{margin-top:7px;font-size:14px;letter-spacing:1px}
  .jg-hud.invuln .jg-hearts{animation:jgBlink .28s steps(2) infinite}
  .jg-cp{margin-top:8px}
  .jg-cp-track{height:6px;border-radius:99px;background:rgba(59,47,47,.1);overflow:hidden}
  .jg-cp-fill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--jg-green),var(--jg-amber));transition:width .2s}
  .jg-cp span{display:block;margin-top:3px;font-size:9px;font-weight:800;letter-spacing:.6px;color:var(--jg-soft)}
  .jg-hud-right{position:absolute;top:14px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
  .jg-tools{display:flex;align-items:center;gap:7px}
  .jg-menu-tools{display:flex;align-items:center;gap:8px}
  .jg-net{font-size:9.5px;font-weight:800;letter-spacing:.7px;border-radius:99px;padding:6px 11px;background:var(--jg-surface);border:1.5px solid var(--jg-line);backdrop-filter:blur(8px);white-space:nowrap}
  .jg-net.solo{color:#2b7a38}.jg-net.live{color:#0f766e;border-color:rgba(16,185,129,.45);background:rgba(236,253,245,.95)}.jg-net.warn{color:var(--jg-orange)}
  .jg-speedo{padding:10px 14px;min-width:150px;text-align:right}
  .jg-speed{font-family:var(--jg-disp);font-weight:700;font-size:31px;line-height:1}
  .jg-unit{font-size:10px;font-weight:800;color:var(--jg-soft);margin-left:4px}
  .jg-speed-track{height:6px;margin-top:6px;border-radius:99px;background:rgba(59,47,47,.1);overflow:hidden}
  .jg-speed-bar{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--jg-green),var(--jg-amber),var(--jg-red));transition:width .12s}
  .jg-turbo{display:none;margin-top:7px}
  .jg-turbo.show{display:block;animation:jgPop .3s}
  .jg-turbo span{font-size:9.5px;font-weight:800;color:var(--jg-orange);letter-spacing:1px}
  .jg-turbo-track{height:7px;margin-top:3px;border-radius:99px;background:rgba(59,47,47,.1);overflow:hidden}
  .jg-turbo-fill{height:100%;width:100%;border-radius:99px;background:linear-gradient(90deg,var(--jg-red),var(--jg-amber));box-shadow:0 0 10px rgba(255,197,61,.8)}
  .jg-combo{display:none;font-family:var(--jg-disp);font-weight:700;font-size:16px;color:#fff;background:linear-gradient(135deg,var(--jg-purple),var(--jg-red));border-radius:99px;padding:6px 14px;box-shadow:var(--jg-shadow)}
  .jg-combo.show{display:block;animation:jgPop .3s}
  .jg-banner{position:absolute;top:20%;left:50%;transform:translate(-50%,-14px) scale(.85);opacity:0;text-align:center;transition:opacity .2s,transform .3s cubic-bezier(.2,.9,.3,1.5)}
  .jg-banner.show{opacity:1;transform:translate(-50%,0) scale(1)}
  .jg-banner-title{font-family:var(--jg-disp);font-weight:700;font-size:clamp(28px,6vw,50px);color:#fff;letter-spacing:1px;text-shadow:0 3px 0 var(--jg-red),0 6px 22px rgba(122,72,20,.55)}
  .jg-banner-pts{font-family:var(--jg-disp);font-weight:700;font-size:clamp(18px,3.4vw,28px);color:var(--jg-amber);text-shadow:0 2px 8px rgba(122,72,20,.6)}
  .jg-airhint{position:absolute;top:32%;left:50%;transform:translateX(-50%);opacity:0;transition:opacity .25s;font-size:12.5px;font-weight:800;color:var(--jg-ink);background:var(--jg-surface);border:2px solid var(--jg-amber);border-radius:99px;padding:8px 16px;box-shadow:var(--jg-shadow);white-space:nowrap}
  .jg-airhint.show{opacity:1;animation:jgFloat 1.1s ease-in-out infinite}
  .jg-toasts{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px}
  .jg-toast{font-size:12px;font-weight:800;background:var(--jg-surface);border:2px solid var(--jg-line);border-radius:99px;padding:8px 15px;box-shadow:var(--jg-shadow);backdrop-filter:blur(8px);animation:jgToastIn .3s cubic-bezier(.2,.9,.3,1.4);transition:opacity .3s,transform .3s}
  .jg-toast.good{border-color:var(--jg-green);color:#2b7a38}
  .jg-toast.warn{border-color:var(--jg-orange);color:#b45309}
  .jg-toast.bad{border-color:var(--jg-red);color:#b3261e}
  .jg-toast.out{opacity:0;transform:translateY(-8px)}
  .jg-pad{position:absolute;bottom:22px;width:104px;height:104px;border-radius:32px;display:none;place-items:center;font-size:34px;color:var(--jg-ink);background:var(--jg-surface);border:2px solid var(--jg-line);box-shadow:var(--jg-shadow);backdrop-filter:blur(10px);pointer-events:auto;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .1s,background .12s}
  .jg-pad.left{left:22px}.jg-pad.right{right:22px}
  .jg-pad.on{background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));color:#fff;transform:scale(.94)}
  .jg-crash{position:absolute;inset:0;opacity:0;background:radial-gradient(120% 90% at 50% 50%,transparent 40%,rgba(229,72,77,.55));pointer-events:none}
  .jg-crash.on{animation:jgCrash .45s ease-out}

  /* Modal */
  .jg-modal{display:grid;place-items:center;background:rgba(59,47,47,.42);backdrop-filter:blur(4px);padding:18px}
  .jg-modal-card{width:min(400px,100%);padding:26px;text-align:center;max-height:90vh;overflow-y:auto}
  .jg-big-em{font-size:44px}
  .jg-modal-card h2{font-family:var(--jg-disp);font-weight:700;font-size:23px;margin:8px 0 6px;line-height:1.15}
  .jg-modal-card p{font-size:12.5px;color:var(--jg-soft);line-height:1.6;margin-bottom:15px}
  .jg-modal-card .jg-btn.primary{width:100%}
  .jg-record{display:none;font-family:var(--jg-disp);font-weight:700;font-size:14px;color:#fff;background:linear-gradient(135deg,var(--jg-amber),var(--jg-orange));border-radius:99px;padding:6px 14px;margin:0 auto 12px;width:fit-content}
  .jg-record.show{display:block;animation:jgPop .4s}
  .jg-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:15px}
  .jg-stats div{background:var(--jg-paper);border:1.5px solid var(--jg-line);border-radius:13px;padding:10px}
  .jg-stats .jg-stat-wide{grid-column:1 / -1;background:linear-gradient(135deg,#fff8eb,#ffefd6);border-color:var(--jg-amber)}
  .jg-stats b{display:block;font-family:var(--jg-disp);font-weight:700;font-size:20px}
  .jg-stats span{font-size:9px;font-weight:800;letter-spacing:1.2px;color:var(--jg-soft)}
  .jg-fatal{position:fixed;inset:0;z-index:95;display:none;place-items:center;background:linear-gradient(160deg,#ffd9a8,#fff3e0);pointer-events:auto}
  .jg-fatal.show{display:grid}
  .jg-fatal-card{max-width:380px;margin:20px;padding:28px;text-align:center}

  @keyframes jgBounce{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-13px) rotate(2deg)}}
  @keyframes jgRoad{to{background-position:-30px 0}}
  @keyframes jgPop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes jgCoinPop{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1)}}
  @keyframes jgToastIn{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
  @keyframes jgBlink{50%{opacity:.35}}
  @keyframes jgFloat{50%{transform:translateX(-50%) translateY(-5px)}}
  @keyframes jgCrash{0%{opacity:1}100%{opacity:0}}

  @media (pointer:coarse),(max-width:860px){
    .jg-pad{display:grid}
    .jg-toasts{bottom:142px}
  }
  @media (max-width:720px){
    .jg-fleet{grid-template-columns:1fr 1fr}
    .jg-rooms{grid-template-columns:1fr}
    .jg-name-row{flex-direction:column;align-items:stretch;gap:6px}
    .jg-card-tag{min-height:0}
    .jg-menu-card{padding:15px;max-height:none}
    .jg-menu{padding:12px}
    .jg-brand-sub{display:none}
    .jg-hud-left{min-width:140px;padding:10px;top:10px;left:10px}
    .jg-score{font-size:26px}
    .jg-hud-right{top:10px;right:10px}
    .jg-speedo{min-width:118px;padding:8px 11px}
    .jg-speed{font-size:24px}
    .jg-net{font-size:8.5px;padding:5px 8px}
    .jg-pad{width:88px;height:88px;bottom:16px}
    .jg-pad.left{left:14px}.jg-pad.right{right:14px}
    .jg-legend{font-size:10px}
    .jg-airhint{font-size:10.5px;padding:7px 12px;max-width:92vw;white-space:normal;text-align:center}
  }
  @media (prefers-reduced-motion:reduce){#jg-root *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  `;
  document.head.appendChild(s);
}
