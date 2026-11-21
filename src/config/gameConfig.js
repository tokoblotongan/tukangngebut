/* =====================================================================
   gameConfig.js — SATU sumber kebenaran seluruh konstanta terkunci.
   Palet Toy Story hangat, fisika arcade, aset armada & landmark Salatiga.
   Semua modul membaca dari sini; jangan hardcode angka di tempat lain.
   ===================================================================== */

export const GAME = {
  title: 'Juragan Ngebut',
  subtitle: 'Mini Race Nusantara',
  city: 'Salatiga',
  version: '0.1.0 — Fondasi Part 1',
};

export const STATES = Object.freeze({
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAMEOVER: 'GAMEOVER',
});

/* ---------- Palet plastik satin hangat & cerah (Pixar Toy Story) ---------- */
export const PALETTE = Object.freeze({
  cream: '#fff3e0', paper: '#fff8eb', warmWhite: '#f7f0e3', ink: '#3b2f2f',
  toyRed: '#e63946', toyYellow: '#ffbe0b', toyGreen: '#38b000',
  toyBlue: '#3a86ff', toyOrange: '#fb5607', toyPurple: '#8338ec',
  angkotGreen: '#2b9348', angkotGreenDark: '#1b6b33', angkotYellow: '#ffbe0b',
  bemoOrange: '#fb5607', bemoOrangeDark: '#d9480f', bemoCream: '#fff4e0',
  l300White: '#f4ede0', ojolGreen: '#00a844', ojolGreenDark: '#007a30',
  wood: '#b0793f', woodDark: '#8a5a2b',
  asphalt: '#454c59', asphaltDark: '#353b47', line: '#fff3d6',
  concrete: '#cfc4b4', stone: '#e2d8c5', grass: '#38b000', grassDark: '#2ec4b6',
  glass: '#90e0ef', tire: '#252229', hub: '#f1e8d8', skin: '#e8b98a',
  gold: '#ffbe0b', terracotta: '#e63946', merahPutih: '#e63946',
  headlight: '#fff3b0', tail: '#ff3b3b', indicator: '#ffb020',
  skyZenith: '#1d4ed8', skyMid: '#38bdf8', horizon: '#ffd89b',
  coinGold: '#ffbe0b', coinGoldRim: '#fb8500',
  pastelMint: '#52b788', pastelCoral: '#ff6b8b', pastelSky: '#4cc9f0',
  pastelButter: '#ffd166', pastelLavender: '#b583e0',
});

/* ---------- Kunci renderer (Strict Visual Lock) ---------- */
export const RENDERER = Object.freeze({
  exposure: 0.95,
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  shadowFrustum: 28,      // batas frustum bayangan ketat, mengikuti player
  shadowNear: 1,
  shadowFar: 95,
});

/* ---------- Pencahayaan Dota 2 lembut: warm key + cool-sky/warm-earth hemi ---------- */
export const LIGHTING = Object.freeze({
  key: { color: '#ffe8b8', intensity: 1.75, dir: { x: -0.55, y: 0.56, z: -0.62 }, distance: 46 },
  hemi: { sky: '#bae6fd', ground: '#4d7c0f', intensity: 0.9 },
  rim: { color: '#bae6fd', intensity: 0.42, dir: { x: 0.5, y: 0.35, z: 0.8 }, distance: 40 },
  fog: { color: '#ffd89b', near: 110, far: 280 },
  sunSprite: { distance: 330, coreScale: 24, haloScale: 80 },
  clouds: { count: 9, driftSpeed: 0.5, wrapRadius: 155 },
  balloons: { count: 9, wrapRadius: 155 },
  motes: { count: 110, box: { x: 60, y: 18, z: 60 }, size: 0.32, opacity: 0.42 },
});

/* ---------- Kamera chase 45° lebih dekat & intim (~22% lebih rapat) ---------- */
export const CAMERA = Object.freeze({
  fov: 56, near: 0.1, far: 500,
  height: 6.4, distance: 6.6,
  lookAhead: 10.5, lookHeight: 1.25,
  posLerp: 6.5, aimLerp: 9.0,
  fovSpeedGain: 7.5,
  shakeDecay: 1.8, shakeAmp: 0.38,
});

/* ---------- Fisika arcade (dipakai playerController & gameLoop) ---------- */
export const PHYSICS = Object.freeze({
  gravity: -34,
  baseSpeed: 16, maxSpeed: 30, accel: 2.2,
  turbo: { multiplier: 1.65, duration: 2.6 },
  steer: { maxLatSpeed: 9, lerp: 8, maxX: 5.2 },
  suspension: { stiffness: 90, damping: 12, maxCompress: 0.22 },
  ramp: { launchVy: 13.5, minSpeed: 10 },
  barrelRoll: { speed: 10.5, bonusPerRoll: 250, landingBoost: true },
  contactShadow: { footprint: 3.4, baseOpacity: 0.5, lift: 0.02 },
});

/* ---------- Trek streaming undulasi (dipakai trackGenerator) ---------- */
export const TRACK = Object.freeze({
  width: 13, lanes: 3,
  segmentLength: 24, segmentsAhead: 10, segmentsBehind: 2,
  hill: { amp1: 2.6, freq1: 0.021, amp2: 1.1, freq2: 0.052 },
  rampEvery: 5, boostEvery: 7, bridgeEvery: 9,
  landmarkEvery: 2, landmarkOffset: 18.0, archEvery: 8,
});

/* ---------- Lalu lintas Nusantara (dipakai trafficManager) ---------- */
export const TRAFFIC = Object.freeze({
  poolSize: 14,
  spawnInterval: [0.9, 1.7],
  safeSpawnAhead: 90, despawnBehind: 18,
  speedFactor: { angkot: 0.55, bemo: 0.45, l300: 0.7, ojol: 0.95 },
  ngetem: { chance: 0.35, duration: [2.5, 5], lane: -1 },
  ojolWeave: { amp: 1.6, freq: 0.8 },
});

/* ---------- Skor & stunt ---------- */
export const SCORE = Object.freeze({
  distancePerUnit: 1,
  rollBonus: 250, boostPadBonus: 50, nearMissBonus: 25,
  coinBonus: 35, fruitBonus: 95, gemBonus: 150,
  comboWindow: 4,
});

/* ---------- Pipeline aset dual-mode ---------- */
export const ASSETS = Object.freeze({
  basePath: './public/assets/',
  dracoPath: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/',
});

/* ---------- ARMADA: 4 kendaraan ikonik Nusantara ----------
   stats  = tampilan UI 1–10 (pemilih armada)
   perf   = pengali fisika nyata
   targetSize = bounding box dunia {x,y,z}; pivot dasar-tengah y=0  */
export const VEHICLES = Object.freeze({
  angkot: {
    id: 'angkot', label: 'Angkot', glbName: 'angkot',
    tagline: 'Si Raja Ngetem',
    desc: 'Minibus hijau-kuning legendaris trayek Salatiga. Badan tebal, suspensi membal, dan kebiasaan berhenti mendadak yang bikin deg-degan.',
    targetSize: { x: 2.1, y: 2.85, z: 4.75 }, wheelRadius: 0.34,
    colors: { body: PALETTE.angkotGreen, roof: PALETTE.angkotYellow, stripe: PALETTE.angkotYellow, cabin: PALETTE.cream },
    stats: { speed: 6, accel: 5, grip: 7, weight: 8 },
    perf: { speedMul: 0.95, accelMul: 0.9, steerMul: 0.95 },
  },
  bemo: {
    id: 'bemo', label: 'Bemo', glbName: 'bemo',
    tagline: 'Legenda Tiga Roda',
    desc: 'Bemo oranye warisan jalanan Salatiga sejak era 60-an. Mungil, lincah menyelip, bangku kayu berhadapan — penuh cerita di setiap tikungan.',
    targetSize: { x: 1.85, y: 2.25, z: 3.6 }, wheelRadius: 0.3,
    colors: { body: PALETTE.bemoOrange, roof: PALETTE.bemoCream, bench: PALETTE.wood },
    stats: { speed: 4, accel: 4, grip: 6, weight: 6 },
    perf: { speedMul: 0.85, accelMul: 0.8, steerMul: 1.0 },
  },
  l300: {
    id: 'l300', label: 'L300 Pick Up', glbName: 'l300',
    tagline: 'Jagoan Bak Kayu',
    desc: 'Pick up bak kayu andalan pasar dan kebun. Bobot paling mantap, cengkeraman juara — muatan peti dan karung pun tetap stabil dihajar ramp.',
    targetSize: { x: 2.05, y: 2.2, z: 4.7 }, wheelRadius: 0.36,
    colors: { body: PALETTE.l300White, bed: PALETTE.wood, cargo: PALETTE.woodDark },
    stats: { speed: 7, accel: 6, grip: 8, weight: 9 },
    perf: { speedMul: 1.0, accelMul: 0.95, steerMul: 1.05 },
  },
  ojol: {
    id: 'ojol', label: 'Ojol', glbName: 'ojol',
    tagline: 'Satelit Jalanan',
    desc: 'Motor hijau jaket kebanggaan dengan boks antar di belakang. Paling ringan, paling ngebut, paling gesit menyalip — tapi gampang terpental.',
    targetSize: { x: 1.05, y: 2.0, z: 2.5 }, wheelRadius: 0.3,
    colors: { body: PALETTE.ojolGreen, jacket: PALETTE.ojolGreen, helmet: PALETTE.warmWhite },
    stats: { speed: 9, accel: 9, grip: 6, weight: 2 },
    perf: { speedMul: 1.12, accelMul: 1.2, steerMul: 1.15 },
  },
});

/* ---------- LANDMARK: 4 ikon pinggir trek Salatiga ----------
   Kunci pendek → nama file .glb terkunci (final spec).        */
export const LANDMARKS = Object.freeze({
  koperasi: {
    id: 'koperasi', label: 'Koperasi Merah Putih', glbName: 'koperasi_merah_putih',
    tagline: 'Gerai Rakyat Merah Putih',
    desc: 'Balai koperasi desa beratap merah dengan kanopi belang merah-putih dan bendera berkibar di halaman — semangat gotong royong kota kecil.',
    fact: 'Gerai koperasi desa',
    targetSize: { x: 16.5, y: 12.8, z: 14.0 },
    colors: { wall: PALETTE.warmWhite, roof: PALETTE.merahPutih, accent: PALETTE.merahPutih },
  },
  pasarRaya: {
    id: 'pasarRaya', label: 'Pasar Raya II', glbName: 'pasar_raya_salatiga',
    tagline: 'Jantung Belanja Salatiga',
    desc: 'Hall pasar legendaris beratap hijau dengan arkade terbuka: lapak buah, sayur, dan gerobak kayu di bawah lampu hangat yang menyala sejak subuh.',
    fact: 'Pusat belanja rakyat',
    targetSize: { x: 22.0, y: 11.8, z: 16.5 },
    colors: { wall: '#f2d16b', roof: PALETTE.toyGreen, column: PALETTE.warmWhite },
  },
  rumdin: {
    id: 'rumdin', label: 'Rumdin Walikota', glbName: 'rumah_dinas_walikota',
    tagline: 'Pendopo Kediaman Resmi',
    desc: 'Rumah dinas bergaya kolonial: dinding krem, atap terakota, empat pilar pendopo putih, halaman rumput rapi, dan Merah Putih di tiang tertinggi.',
    fact: 'Kediaman resmi Walikota',
    targetSize: { x: 20.0, y: 13.0, z: 15.5 },
    colors: { wall: PALETTE.l300White, roof: PALETTE.terracotta, column: PALETTE.warmWhite },
  },
  monas: {
    id: 'monas', label: 'Monas Salatiga', glbName: 'monas',
    tagline: 'Tugu Emas Mini',
    desc: 'Replika tugu kebanggaan di jantung kota: obelisk bertingkat menjulang dengan lidah api emas yang berkilau memantulkan cahaya golden hour.',
    fact: 'Tugu kebanggaan kota',
    targetSize: { x: 10.5, y: 26.5, z: 10.5 },
    colors: { stone: PALETTE.stone, gold: PALETTE.gold, lawn: PALETTE.grass },
  },
});

/* ---------- Helper aman ---------- */
export const VEHICLE_TYPES = Object.freeze(Object.keys(VEHICLES));
export const LANDMARK_TYPES = Object.freeze(Object.keys(LANDMARKS));
export const getVehicleDef = (type) => VEHICLES[type] || VEHICLES.angkot;
export const getLandmarkDef = (type) => LANDMARKS[type] || LANDMARKS.koperasi;
