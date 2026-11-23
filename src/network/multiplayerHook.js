/* =====================================================================
   multiplayerHook.js — Sinkronisasi Supabase Realtime Multiplayer
   (Lobby Directory + Room Presence + Broadcast ~20Hz / 50ms) dengan
   fallback aman ke mode Solo/AI bila environment variables belum ada.
   Channel kamar dinamis: juragan-room-<roomId>.
   Lobby directory: juragan-lobby-directory.
   ===================================================================== */
import * as THREE from 'three';
import { createClient } from '@supabase/supabase-js';
import { loadVehicle, setVehicleUnderglow, createNeonRibbonTrail } from '../entities/assetFactory.js';
import { getTrackYaw, getTrackBank } from '../world/activeTrack.js';
import { VEHICLES, SLOT_COLORS, getVehicleDef } from '../config/gameConfig.js';

export const PUBLIC_ROOMS = Object.freeze([
  { id: 'salatiga-1', label: 'Salatiga-1', tag: 'Umum' },
  { id: 'nusantara-2', label: 'Nusantara-2', tag: 'Umum' },
  { id: 'mabar-3', label: 'Mabar-3', tag: 'Umum' },
]);

const DEFAULT_ROOM = 'salatiga-1';
const LOBBY_CHANNEL = 'juragan-lobby-directory';
const SEND_INTERVAL = 0.05; // ~20 Hz (50ms throttle)
const PEER_TTL = 4.0;       // detik tanpa kabar → dianggap pergi
const NAMES = [
  'Juragan Angkot', 'Bos Bemo', 'Sultan L300', 'Raja Ojol',
  'Nona Salatiga', 'Mas Blotongan', 'Juragan Kopi', 'Pembalap Merbabu',
];
const VEHICLE_EMOJIS = { angkot: '🚐', bemo: '🛺', l300: '🛻', ojol: '🏍️' };
const SLOT_GLOW_COLORS = [...SLOT_COLORS, '#a855f7', '#ff6b00'];

export function getSlotGlowColor(peerId) {
  const str = String(peerId || 'p0');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return SLOT_GLOW_COLORS[Math.abs(h) % SLOT_GLOW_COLORS.length];
}

export function normalizeRoomId(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return cleaned || DEFAULT_ROOM;
}

function getOrCreateIdentity() {
  const fallbackName = NAMES[Math.floor(Math.random() * NAMES.length)];
  let id = `p_${Math.random().toString(36).slice(2, 9)}`;
  let name = fallbackName;
  try {
    const savedId = sessionStorage.getItem('jg_peer_id');
    if (savedId) id = savedId;
    else sessionStorage.setItem('jg_peer_id', id);
    const savedName = localStorage.getItem('jg_player_name');
    if (savedName && savedName.trim()) name = savedName.trim().slice(0, 18);
  } catch {}
  return { id, name };
}

function makeNameplateSprite(name, vehicleType) {
  const c = document.createElement('canvas');
  c.width = 340;
  c.height = 84;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);

  g.fillStyle = 'rgba(34, 24, 24, 0.88)';
  g.beginPath();
  g.roundRect(8, 12, 324, 58, 26);
  g.fill();

  g.strokeStyle = '#ffbe0b';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(8, 12, 324, 58, 26);
  g.stroke();

  const em = VEHICLE_EMOJIS[vehicleType] || '🚐';
  g.fillStyle = '#fff8eb';
  g.font = '700 26px Fredoka, "Plus Jakarta Sans", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = `${em} ${String(name || 'Juragan').slice(0, 16)}`;
  g.fillText(label, 170, 42);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.8, 0.95, 1);
  sprite.renderOrder = 6;
  sprite.userData = { tex, mat };
  return sprite;
}

function createSupabaseFromEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (
    typeof url !== 'string' || !url.startsWith('http') || url.includes('MY_SUPABASE') ||
    typeof key !== 'string' || key.length < 12 || key.includes('MY_SUPABASE')
  ) {
    return null;
  }
  try {
    return createClient(url, key, {
      realtime: { params: { eventsPerSecond: 30 } },
    });
  } catch (err) {
    console.warn('[Multiplayer] Gagal membuat Supabase client, lanjut mode Solo:', err);
    return null;
  }
}

export function createMultiplayerHook({
  scene = null,
  room = DEFAULT_ROOM,
  enabled = true,
  onStatusChange = null,
  onLobbyChange = null,
} = {}) {
  const identity = getOrCreateIdentity();
  const id = identity.id;
  let currentRoom = normalizeRoomId(room);

  const peers = new Map();      // id -> { id, name, vehicleType, x, y, z, rollAngle, speed, score, state, seen }
  const presenceIds = new Set();
  const ghosts = new Map();     // id -> { root, vehicleMesh, nameplate, plateName, target, roll, type, loading }
  let lobbyCounts = {};

  let supabaseClient = null;
  let transport = null, unsubscribe = null, channel = null, lobbyChannel = null;
  let status = 'solo';
  let onlineCount = 1;
  let acc = 0, lastPayload = null, lastTrackedVehicle = '';
  let disposed = false;

  function emitStatus() {
    onStatusChange?.({ status, room: currentRoom, onlineCount, peerCount: peers.size });
  }

  function emitLobby() {
    const merged = { ...lobbyCounts };
    if (status === 'live') {
      merged[currentRoom] = Math.max(merged[currentRoom] || 0, onlineCount);
    }
    onLobbyChange?.(merged);
  }

  function recomputeOnlineCount() {
    if (status === 'live') {
      onlineCount = Math.max(1, presenceIds.size || (peers.size + 1));
    } else {
      onlineCount = 1;
    }
    emitStatus();
    emitLobby();
  }

  function disposeGhostEntry(entry) {
    if (!entry) return;
    entry.ribbon?.dispose?.();
    if (entry.root) scene?.remove(entry.root);
    if (entry.nameplate?.userData) {
      entry.nameplate.userData.tex?.dispose();
      entry.nameplate.userData.mat?.dispose();
    }
  }

  function removePeer(pid) {
    peers.delete(pid);
    const g = ghosts.get(pid);
    if (g) {
      disposeGhostEntry(g);
      ghosts.delete(pid);
    }
  }

  function receive(payload) {
    if (!payload || payload.id === id) return;
    if (payload.leave) {
      removePeer(payload.id);
      presenceIds.delete(payload.id);
      recomputeOnlineCount();
      return;
    }
    const vType = payload.vehicleType || payload.vehicle;
    const safeVehicle = VEHICLES[vType] ? vType : 'angkot';
    peers.set(payload.id, {
      id: payload.id,
      name: payload.name || 'Juragan',
      vehicleType: safeVehicle,
      vehicle: safeVehicle,
      x: +payload.x || 0,
      y: +payload.y || 0,
      z: +payload.z || 0,
      rollAngle: +payload.rollAngle || 0,
      speed: +payload.speed || 0,
      score: +payload.score || 0,
      coins: Math.round(+payload.coins || 0),
      turbo: !!payload.turbo,
      state: payload.state || 'PLAYING',
      seen: performance.now() / 1000,
    });
  }

  /* ---------- Transport generik ---------- */
  function attachTransport(t) {
    detach();
    transport = t;
    try {
      unsubscribe = t.subscribe?.((msg) => receive(msg?.payload ?? msg)) || null;
      status = 'live';
    } catch {
      status = 'offline';
    }
    recomputeOnlineCount();
    return status;
  }

  function detach() {
    try { unsubscribe?.(); } catch {}
    unsubscribe = null;
    transport = null;
    presenceIds.clear();
    for (const pid of [...peers.keys()]) removePeer(pid);
  }

  /* ---------- Lobby Directory Channel (juragan-lobby-directory) ---------- */
  function connectLobby(client) {
    if (!client?.channel || lobbyChannel) return;
    try {
      lobbyChannel = client.channel(LOBBY_CHANNEL, {
        config: { presence: { key: id } },
      });
      lobbyChannel.on('presence', { event: 'sync' }, () => {
        if (!lobbyChannel) return;
        const pState = lobbyChannel.presenceState();
        const counts = {};
        for (const metas of Object.values(pState || {})) {
          const meta = Array.isArray(metas) && metas.length ? metas[metas.length - 1] : null;
          const rm = normalizeRoomId(meta?.room || DEFAULT_ROOM);
          counts[rm] = (counts[rm] || 0) + 1;
        }
        lobbyCounts = counts;
        emitLobby();
      });
      lobbyChannel.subscribe(async (s) => {
        if (disposed) return;
        if (s === 'SUBSCRIBED') {
          try {
            await lobbyChannel.track({ id, room: currentRoom, name: identity.name });
          } catch {}
        }
      });
    } catch (err) {
      console.warn('[Multiplayer] Lobby directory gagal:', err);
    }
  }

  /* ---------- Room Channel Dinamis: juragan-room-<roomId> ---------- */
  function connectSupabase(client, roomName = currentRoom) {
    currentRoom = normalizeRoomId(roomName);
    if (!client?.channel) {
      status = 'solo';
      recomputeOnlineCount();
      return status;
    }
    supabaseClient = client;

    if (channel) {
      try { channel.send({ type: 'broadcast', event: 'state', payload: { id, leave: true } }); } catch {}
      try { channel.unsubscribe(); } catch {}
      channel = null;
    }
    detach();

    connectLobby(client);

    try {
      const topic = `juragan-room-${currentRoom}`;
      channel = client.channel(topic, {
        config: {
          broadcast: { self: false },
          presence: { key: id },
        },
      });

      channel.on('broadcast', { event: 'state' }, ({ payload }) => receive(payload));

      channel.on('presence', { event: 'sync' }, () => {
        if (!channel) return;
        const pState = channel.presenceState();
        presenceIds.clear();
        for (const [key, metas] of Object.entries(pState || {})) {
          presenceIds.add(key);
          if (key === id) continue;
          const meta = Array.isArray(metas) && metas.length ? metas[metas.length - 1] : null;
          if (meta) {
            const existing = peers.get(key);
            const vType = VEHICLES[meta.vehicleType] ? meta.vehicleType : (existing?.vehicleType || 'angkot');
            if (!existing) {
              peers.set(key, {
                id: key,
                name: meta.name || 'Juragan',
                vehicleType: vType,
                vehicle: vType,
                x: 0, y: 0, z: 0, rollAngle: 0, speed: 0, score: 0, coins: 0,
                state: 'MENU',
                seen: performance.now() / 1000,
              });
            } else {
              if (meta.name) existing.name = meta.name;
              existing.vehicleType = vType;
              existing.vehicle = vType;
            }
          }
        }
        for (const pid of [...peers.keys()]) {
          if (!presenceIds.has(pid)) removePeer(pid);
        }
        recomputeOnlineCount();
      });

      channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        if (key && key !== id) {
          presenceIds.delete(key);
          removePeer(key);
        }
        for (const p of leftPresences || []) {
          const pk = p.key || p.id;
          if (pk && pk !== id) {
            presenceIds.delete(pk);
            removePeer(pk);
          }
        }
        recomputeOnlineCount();
      });

      status = 'connecting';
      emitStatus();

      const activeChannel = channel;
      activeChannel.subscribe(async (s) => {
        if (disposed || activeChannel !== channel) return;
        if (s === 'SUBSCRIBED') {
          status = 'live';
          try {
            await activeChannel.track({
              id,
              name: identity.name,
              vehicleType: lastPayload?.vehicleType || 'angkot',
            });
            lastTrackedVehicle = lastPayload?.vehicleType || 'angkot';
            lobbyChannel?.track({ id, room: currentRoom, name: identity.name }).catch(() => {});
          } catch {}
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          status = 'offline';
        } else if (s === 'CLOSED') {
          status = 'solo';
        } else {
          status = 'connecting';
        }
        recomputeOnlineCount();
      });

      transport = {
        send: (event, payload) => channel?.send({ type: 'broadcast', event, payload }),
      };
    } catch (err) {
      console.warn('[Multiplayer] Koneksi Supabase gagal, beralih ke Solo:', err);
      status = 'solo';
      recomputeOnlineCount();
    }
    return status;
  }

  function joinRoom(roomId) {
    const nextRoom = normalizeRoomId(roomId);
    try { localStorage.setItem('jg_room', nextRoom); } catch {}
    if (nextRoom === currentRoom && (status === 'live' || status === 'connecting')) {
      return status;
    }
    currentRoom = nextRoom;
    if (supabaseClient) {
      return connectSupabase(supabaseClient, nextRoom);
    }
    detach();
    status = 'solo';
    recomputeOnlineCount();
    return status;
  }

  /* ---------- Auto-init dari VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY ---------- */
  if (enabled) {
    supabaseClient = createSupabaseFromEnv();
    if (supabaseClient) {
      connectSupabase(supabaseClient, currentRoom);
    } else {
      status = 'solo';
      onlineCount = 1;
    }
  }

  /* ---------- Kirim state lokal (throttle ~20Hz / 50ms) ---------- */
  const round = (v) => Math.round((+v || 0) * 100) / 100;
  function syncLocalState(playerState) {
    const vType = playerState?.vehicleType || playerState?.vehicle || 'angkot';
    lastPayload = {
      id,
      name: identity.name,
      vehicleType: VEHICLES[vType] ? vType : 'angkot',
      x: round(playerState?.x),
      y: round(playerState?.y),
      z: round(playerState?.z),
      rollAngle: round(playerState?.rollAngle),
      speed: round(playerState?.speed),
      score: Math.round(playerState?.score || 0),
      coins: Math.round(playerState?.coins || 0),
      turbo: !!playerState?.turbo,
      state: playerState?.state || 'MENU',
    };
  }

  /* ---------- Daftar pemain remote ---------- */
  function getRemotePlayers() {
    const now = performance.now() / 1000;
    let removed = false;
    for (const [pid, p] of peers) {
      const ttl = presenceIds.has(pid) ? PEER_TTL * 4 : PEER_TTL;
      if (now - p.seen > ttl) {
        removePeer(pid);
        removed = true;
      }
    }
    if (removed) recomputeOnlineCount();
    return [...peers.values()];
  }

  /* ---------- Kendaraan remote + Nameplate mengambang ---------- */
  function attachNameplate(entry, name, vehicleType) {
    if (entry.nameplate) {
      entry.root.remove(entry.nameplate);
      entry.nameplate.userData.tex?.dispose();
      entry.nameplate.userData.mat?.dispose();
    }
    const def = getVehicleDef(vehicleType);
    const plate = makeNameplateSprite(name, vehicleType);
    plate.position.set(0, def.targetSize.y + 1.05, 0);
    entry.nameplate = plate;
    entry.plateName = name;
    entry.root.add(plate);
  }

  async function spawnOrSwapVehicle(peer, entry) {
    if (!scene || entry.loading || !VEHICLES[peer.vehicleType]) return;
    entry.loading = true;
    entry.type = peer.vehicleType;
    try {
      const mesh = await loadVehicle(peer.vehicleType);
      if (disposed || !peers.has(peer.id) || ghosts.get(peer.id) !== entry) return;

      mesh.traverse((o) => {
        if (o.isMesh && o.name !== 'slot_underglow' && !o.name.startsWith('flame_')) {
          o.castShadow = false;
          o.receiveShadow = true;
        }
      });
      setVehicleUnderglow(mesh, getSlotGlowColor(peer.id));

      if (entry.vehicleMesh) entry.root.remove(entry.vehicleMesh);
      entry.vehicleMesh = mesh;
      entry.root.add(mesh);

      attachNameplate(entry, peer.name, peer.vehicleType);
    } catch {
      // biarkan entry bersih jika gagal memuat
    } finally {
      entry.loading = false;
    }
  }

  function ensureGhost(peer) {
    if (!scene || ghosts.has(peer.id)) return;
    const root = new THREE.Group();
    root.position.set(peer.x, peer.y, peer.z);
    root.visible = peer.state === 'PLAYING' || peer.state === 'PAUSED';
    scene.add(root);

    const color = getSlotGlowColor(peer.id);
    const ribbon = createNeonRibbonTrail(scene, color, 0.50);
    ribbon.reset(peer.x, peer.y + 0.34, peer.z + 1.3);
    ribbon.setVisible(root.visible);

    const entry = {
      root,
      vehicleMesh: null,
      nameplate: null,
      ribbon,
      plateName: peer.name,
      target: new THREE.Vector3(peer.x, peer.y, peer.z),
      roll: peer.rollAngle || 0,
      type: peer.vehicleType,
      loading: false,
    };
    ghosts.set(peer.id, entry);
    spawnOrSwapVehicle(peer, entry);
  }

  function update(dt) {
    acc += dt;
    if (transport && status === 'live' && lastPayload && acc >= SEND_INTERVAL) {
      acc = 0;
      try {
        transport.send('state', lastPayload);
        if (channel && lastPayload.vehicleType !== lastTrackedVehicle) {
          lastTrackedVehicle = lastPayload.vehicleType;
          channel.track({
            id,
            name: identity.name,
            vehicleType: lastTrackedVehicle,
          }).catch(() => {});
        }
      } catch {
        status = 'offline';
        recomputeOnlineCount();
      }
    }

    const list = getRemotePlayers();
    const alpha = Math.min(1, 1 - Math.exp(-16 * dt));

    for (const p of list) {
      if (!ghosts.has(p.id)) {
        ensureGhost(p);
        continue;
      }
      const entry = ghosts.get(p.id);
      if (entry.type !== p.vehicleType && !entry.loading) {
        spawnOrSwapVehicle(p, entry);
      } else if (entry.vehicleMesh && entry.plateName !== p.name && !entry.loading) {
        attachNameplate(entry, p.name, entry.type);
      }

      const showVehicle = p.state === 'PLAYING' || p.state === 'PAUSED';
      entry.root.visible = showVehicle;
      entry.ribbon?.setVisible(showVehicle);
      entry.target.set(p.x, p.y, p.z);

      if (!showVehicle) {
        entry.root.position.copy(entry.target);
        continue;
      }

      const prevX = entry.root.position.x;
      entry.root.position.lerp(entry.target, alpha);
      const dx = (entry.root.position.x - prevX) / Math.max(0.001, dt);

      entry.roll += ((p.rollAngle || 0) - entry.roll) * alpha;

      const trackYaw = getTrackYaw(entry.root.position.z);
      const trackBank = getTrackBank(entry.root.position.z);
      if (entry.vehicleMesh) {
        entry.vehicleMesh.rotation.order = 'YXZ';
        entry.vehicleMesh.rotation.z = entry.roll + (Math.abs(entry.roll) < 0.1 ? trackBank : 0);
        entry.vehicleMesh.rotation.y = trackYaw + THREE.MathUtils.clamp(-dx * 0.025, -0.22, 0.22);
        const wr = getVehicleDef(entry.type).wheelRadius || 0.34;
        const spin = ((p.speed || 16) / wr) * dt;
        for (const w of entry.vehicleMesh.userData.wheels || []) {
          w.rotation.x -= spin;
        }
        const flames = entry.vehicleMesh.userData.flames;
        if (flames?.group) {
          const on = !!p.turbo;
          flames.group.visible = on;
          if (on) {
            const tNow = performance.now() * 0.04;
            for (let j = 0; j < flames.jets.length; j++) {
              const jet = flames.jets[j];
              const s = 0.88 + 0.4 * Math.abs(Math.sin(tNow + j * 1.9));
              jet.scale.set(s, s, 1.0 + 0.5 * Math.sin(tNow * 1.3 + j));
            }
          }
        }
      }
      const ry = entry.vehicleMesh?.rotation?.y || trackYaw;
      entry.ribbon?.setBoostMode(!!p.turbo || Math.abs(p.rollAngle || 0) > 0.35);
      entry.ribbon?.update(
        entry.root.position.x,
        entry.root.position.y + 0.34,
        entry.root.position.z + 1.3,
        Math.cos(ry),
        Math.sin(entry.roll),
        -Math.sin(ry)
      );
    }
  }

  function setName(newName) {
    const clean = String(newName || '').trim().slice(0, 18);
    if (!clean) return identity.name;
    identity.name = clean;
    try { localStorage.setItem('jg_player_name', clean); } catch {}
    if (channel && status === 'live') {
      channel.track({
        id,
        name: identity.name,
        vehicleType: lastPayload?.vehicleType || 'angkot',
      }).catch(() => {});
    }
    if (lobbyChannel) {
      lobbyChannel.track({ id, room: currentRoom, name: identity.name }).catch(() => {});
    }
    return identity.name;
  }

  function disconnect() {
    try { transport?.send?.('state', { id, leave: true }); } catch {}
    try { channel?.unsubscribe?.(); } catch {}
    try { lobbyChannel?.unsubscribe?.(); } catch {}
    channel = null;
    lobbyChannel = null;
    detach();
    status = 'solo';
    recomputeOnlineCount();
  }

  function dispose() {
    disposed = true;
    disconnect();
    for (const [, entry] of ghosts) disposeGhostEntry(entry);
    ghosts.clear();
  }

  return {
    syncLocalState, getRemotePlayers, update,
    attachTransport, connectSupabase, joinRoom, setName, disconnect, dispose,
    get status() { return status; },
    get room() { return currentRoom; },
    get identity() { return identity; },
    get peerCount() { return peers.size; },
    get onlineCount() { return onlineCount; },
    get lobbyCounts() { return { ...lobbyCounts }; },
  };
}
