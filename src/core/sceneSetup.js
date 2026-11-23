/* =====================================================================
   sceneSetup.js — Renderer ACESFilmic terkunci, kamera chase 45°
   horizon-locked, pencahayaan golden-hour hangat, FogExp2, langit
   gradien, matahari, awan mainan, debu cahaya, dan contact shadow
   dinamis. Satu-satunya pemilik renderer & atmosfer scene.
   ===================================================================== */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RENDERER, LIGHTING, CAMERA, PHYSICS, PALETTE } from '../config/gameConfig.js';

export function createSceneContext(canvas) {
  /* ---------------- Renderer (Strict Visual Lock + Software-GL guard) ---------------- */
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  const gl = renderer.getContext();
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const gpuStr = String(gl?.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpuStr);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));
  const maxAnisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());

  function applyCanvasTextureFiltering(tex) {
    if (!tex) return tex;
    tex.anisotropy = maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  function refineSceneTextures(rootObj = scene) {
    if (!rootObj) return;
    const seen = new Set();
    const texSlots = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap'];
    rootObj.traverse((obj) => {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        for (const slot of texSlots) {
          const t = m[slot];
          if (t && t.isCanvasTexture && !seen.has(t)) {
            seen.add(t);
            applyCanvasTextureFiltering(t);
          }
        }
      }
    });
  }

  /* ---------------- Scene + fog atmosfer (linear di cakrawala jauh) ---------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe9ff);
  scene.fog = new THREE.Fog(0xbfe9ff, 140, 460);

  /* Studio environment map halus agar emas koin, buah glossy & plastik mainan berkilau */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.56;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(0, CAMERA.height, CAMERA.distance);
  camera.up.set(0, 1, 0); // horizon-lock: up tidak pernah berubah

  /* ---------------- Tiga titik cahaya daylight lembut ---------------- */
  const hemi = new THREE.HemisphereLight(0x8be0ff, 0xffe6c7, 0.95);
  scene.add(hemi);

  const keyDir = new THREE.Vector3(LIGHTING.key.dir.x, LIGHTING.key.dir.y, LIGHTING.key.dir.z).normalize();
  const key = new THREE.DirectionalLight(LIGHTING.key.color, LIGHTING.key.intensity);
  key.castShadow = !isSoftwareGl;
  key.shadow.mapSize.set(RENDERER.shadowMapSize, RENDERER.shadowMapSize);
  key.shadow.radius = 3.5;
  key.shadow.bias = RENDERER.shadowBias;
  key.shadow.normalBias = RENDERER.shadowNormalBias;
  const sc = key.shadow.camera;
  sc.left = -RENDERER.shadowFrustum; sc.right = RENDERER.shadowFrustum;
  sc.top = RENDERER.shadowFrustum; sc.bottom = -RENDERER.shadowFrustum;
  sc.near = RENDERER.shadowNear; sc.far = RENDERER.shadowFar;
  scene.add(key, key.target);

  const rimDir = new THREE.Vector3(LIGHTING.rim.dir.x, LIGHTING.rim.dir.y, LIGHTING.rim.dir.z).normalize();
  const rim = new THREE.DirectionalLight(LIGHTING.rim.color, LIGHTING.rim.intensity);
  scene.add(rim, rim.target);

  /* ---------------- Langit gradien: Salatiga vs Nusantara Skyway ---------------- */
  const skyTexSalatiga = applyCanvasTextureFiltering(makeSkyTexture());
  const skyTexSkyway = applyCanvasTextureFiltering(makeSkywaySkyTexture());
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTexSalatiga, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 28, 18),
    skyMat
  );
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  let currentAtmosphere = 'salatiga';
  function setAtmosphere(arenaId) {
    const isFantasy = arenaId === 'skyway' || arenaId === 'mandalika';
    currentAtmosphere = arenaId === 'mandalika' ? 'mandalika' : isFantasy ? 'skyway' : 'salatiga';
    skyMat.map = isFantasy ? skyTexSkyway : skyTexSalatiga;
    skyMat.needsUpdate = true;
    scene.background.setHex(0xbfe9ff);
    scene.fog.color.setHex(0xbfe9ff);
    scene.fog.near = 140;
    scene.fog.far = 460;
    hemi.color.setHex(0x8be0ff);
    hemi.groundColor.setHex(0xffe6c7);
    hemi.intensity = 0.95;
    key.color.set(isFantasy ? '#fff6e0' : '#ffefd0');
    key.intensity = isFantasy ? 1.78 : 1.72;
    rim.color.setHex(0xd8f3ff);
    rim.intensity = isFantasy ? 0.76 : 0.70;
  }

  /* Matahari: inti + halo aditif, searah key light */
  const sunTex = applyCanvasTextureFiltering(makeGlowTexture());
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, color: '#fff9e6', transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunCore.scale.setScalar(LIGHTING.sunSprite.coreScale);
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, color: '#ffe5a3', transparent: true, opacity: 0.24,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunHalo.scale.setScalar(LIGHTING.sunSprite.haloScale);
  sunCore.renderOrder = -9; sunHalo.renderOrder = -9;
  scene.add(sunCore, sunHalo);

  /* ---------------- Awan mainan lembut (drift + wrap) ---------------- */
  const puffGeo = new THREE.SphereGeometry(1, 14, 10);
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#fff8f0', roughness: 0.85, metalness: 0 });
  const clouds = [];
  for (let i = 0; i < LIGHTING.clouds.count; i++) {
    const g = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let p = 0; p < puffs; p++) {
      const m = new THREE.Mesh(puffGeo, cloudMat);
      m.position.set((p - puffs / 2) * 1.15, Math.sin(p * 2.1) * 0.35, Math.cos(p * 1.7) * 0.5);
      m.scale.set(1.3 + (p % 2) * 0.6, 0.85 + (p % 3) * 0.2, 1.1);
      g.add(m);
    }
    const ang = (i / LIGHTING.clouds.count) * Math.PI * 2;
    const rad = 60 + (i % 4) * 26;
    g.position.set(Math.cos(ang) * rad, 26 + (i % 5) * 5, Math.sin(ang) * rad);
    g.scale.setScalar(3.6 + (i % 3) * 1.8);
    g.userData.drift = LIGHTING.clouds.driftSpeed * (0.7 + (i % 4) * 0.18);
    scene.add(g); clouds.push(g);
  }

  /* ---------------- Balon udara warna-warni mainan di langit ---------------- */
  const balloonProfile = [
    new THREE.Vector2(0.01, 2.3),
    new THREE.Vector2(0.85, 2.15),
    new THREE.Vector2(1.48, 1.65),
    new THREE.Vector2(1.62, 0.95),
    new THREE.Vector2(1.22, 0.15),
    new THREE.Vector2(0.58, -0.55),
    new THREE.Vector2(0.45, -0.75),
  ];
  const balloonEnvGeo = new THREE.LatheGeometry(balloonProfile, 20);
  const balloonCollarGeo = new THREE.TorusGeometry(0.47, 0.07, 8, 18);
  const balloonBasketGeo = new THREE.BoxGeometry(0.68, 0.52, 0.68);
  const balloonRopeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6);
  const balloonFlameGeo = new THREE.SphereGeometry(0.18, 10, 8);

  const balloonPalettes = [
    [PALETTE.toyRed, PALETTE.toyYellow, PALETTE.warmWhite],
    [PALETTE.toyBlue, PALETTE.pastelSky, PALETTE.toyYellow],
    [PALETTE.toyGreen, PALETTE.pastelButter, PALETTE.toyOrange],
    [PALETTE.toyPurple, PALETTE.pastelCoral, PALETTE.warmWhite],
    [PALETTE.toyOrange, PALETTE.toyYellow, PALETTE.toyRed],
  ];
  const balloonTextures = balloonPalettes.map((cols) => applyCanvasTextureFiltering(makeBalloonStripeTexture(cols)));
  const balloonEnvMats = balloonTextures.map((tex) => new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.42, metalness: 0.05,
  }));
  const basketMat = new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.78 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: PALETTE.warmWhite, roughness: 0.6 });
  const collarMat = new THREE.MeshStandardMaterial({ color: PALETTE.toyYellow, roughness: 0.45 });
  const burnerMat = new THREE.MeshStandardMaterial({
    color: '#ffe082', emissive: '#ff9f1c', emissiveIntensity: 1.6, roughness: 0.3,
  });

  const balloons = [];
  const balloonCount = LIGHTING.balloons?.count ?? 9;
  const balloonWrapR = LIGHTING.balloons?.wrapRadius ?? 155;
  for (let i = 0; i < balloonCount; i++) {
    const g = new THREE.Group();
    const env = new THREE.Mesh(balloonEnvGeo, balloonEnvMats[i % balloonEnvMats.length]);
    const collar = new THREE.Mesh(balloonCollarGeo, collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.75;
    const flame = new THREE.Mesh(balloonFlameGeo, burnerMat);
    flame.position.y = -0.82;
    const basket = new THREE.Mesh(balloonBasketGeo, basketMat);
    basket.position.y = -1.78;
    g.add(env, collar, flame, basket);

    for (const rx of [-0.28, 0.28]) {
      for (const rz of [-0.28, 0.28]) {
        const rope = new THREE.Mesh(balloonRopeGeo, ropeMat);
        rope.position.set(rx, -1.2, rz);
        g.add(rope);
      }
    }

    const ang = (i / balloonCount) * Math.PI * 2 + 0.35;
    const rad = 44 + (i % 3) * 32;
    const baseY = 21 + (i % 4) * 5.5;
    g.position.set(Math.cos(ang) * rad, baseY, Math.sin(ang) * rad);
    g.scale.setScalar(1.9 + (i % 3) * 0.45);
    g.userData = {
      baseY,
      phase: i * 1.37,
      bobAmp: 1.1 + (i % 3) * 0.35,
      driftX: (i % 2 === 0 ? 1 : -1) * (0.45 + (i % 3) * 0.2),
      spin: (i % 2 === 0 ? 0.14 : -0.14),
    };
    scene.add(g);
    balloons.push(g);
  }

  /* ---------------- Pelangi 3D pastel-gloss & bintang kecil berkelap-kelip ---------------- */
  const RAINBOW_COLORS = ['#ff758f', '#ff9f43', '#ffe066', '#6ee7b7', '#60a5fa', '#c084fc'];
  const rainbowBandGeos = RAINBOW_COLORS.map((_, idx) =>
    new THREE.TorusGeometry(64 - idx * 2.15, 0.95, 10, 52, Math.PI)
  );
  const rainbowBandMats = RAINBOW_COLORS.map((col) => new THREE.MeshPhysicalMaterial({
    color: col,
    emissive: col,
    emissiveIntensity: 0.24,
    roughness: 0.22,
    metalness: 0.04,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    transparent: true,
    opacity: 0.88,
  }));
  const rainbows = [];
  const rainbowConfigs = [
    { x: -24, y: 4, zOff: -155, ry: 0.22, sc: 1.05 },
    { x: 34, y: 6, zOff: -255, ry: -0.26, sc: 1.2 },
  ];
  for (const cfg of rainbowConfigs) {
    const rg = new THREE.Group();
    for (let b = 0; b < RAINBOW_COLORS.length; b++) {
      const band = new THREE.Mesh(rainbowBandGeos[b], rainbowBandMats[b]);
      band.renderOrder = -6;
      rg.add(band);
    }
    rg.position.set(cfg.x, cfg.y, cfg.zOff);
    rg.rotation.y = cfg.ry;
    rg.scale.setScalar(cfg.sc);
    rg.userData = { baseX: cfg.x, baseY: cfg.y };
    scene.add(rg);
    rainbows.push(rg);
  }

  const starShape = new THREE.Shape();
  for (let p = 0; p < 10; p++) {
    const r = p % 2 === 0 ? 0.62 : 0.27;
    const a = (p / 10) * Math.PI * 2 - Math.PI / 2;
    if (p === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  starShape.closePath();
  const starGeo = new THREE.ExtrudeGeometry(starShape, {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2,
  });
  starGeo.center();
  const starTex = applyCanvasTextureFiltering(makeGlowTexture(64));
  const stars = [];
  const STAR_COUNT = 22;
  const starWrapR = 150;
  for (let i = 0; i < STAR_COUNT; i++) {
    const sg = new THREE.Group();
    const sMat = new THREE.MeshStandardMaterial({
      color: '#fff3b0',
      emissive: i % 3 === 0 ? '#ffd166' : i % 3 === 1 ? '#fde68a' : '#bae6fd',
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.45,
      fog: false,
    });
    const body = new THREE.Mesh(starGeo, sMat);
    const haloMat = new THREE.SpriteMaterial({
      map: starTex,
      color: '#fff8d6',
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(2.4);
    sg.add(body, halo);
    const ang = (i / STAR_COUNT) * Math.PI * 2 + 0.19;
    const rad = 42 + (i % 5) * 24;
    const baseY = 30 + (i % 4) * 6.5;
    sg.position.set(Math.cos(ang) * rad, baseY, Math.sin(ang) * rad);
    const baseScale = 0.95 + (i % 3) * 0.35;
    sg.scale.setScalar(baseScale);
    sg.userData = {
      mat: sMat,
      halo,
      baseY,
      baseScale,
      phase: i * 1.13,
      twinkleSpd: 2.2 + (i % 4) * 0.65,
      spinSpd: (i % 2 === 0 ? 1 : -1) * (0.45 + (i % 3) * 0.18),
    };
    scene.add(sg);
    stars.push(sg);
  }

  /* ---------------- Debu cahaya golden hour (Points aditif) ---------------- */
  const moteCount = LIGHTING.motes.count;
  const moteBox = LIGHTING.motes.box;
  const motePos = new Float32Array(moteCount * 3);
  const moteBaseY = new Float32Array(moteCount);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * moteBox.x;
    motePos[i * 3 + 1] = Math.random() * moteBox.y + 0.5;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * moteBox.z;
    moteBaseY[i] = motePos[i * 3 + 1];
    motePhase[i] = Math.random() * Math.PI * 2;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteTex = applyCanvasTextureFiltering(makeGlowTexture(64));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    map: moteTex, color: '#ffd9a0', size: LIGHTING.motes.size, sizeAttenuation: true,
    transparent: true, opacity: LIGHTING.motes.opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  motes.frustumCulled = false;
  scene.add(motes);

  /* ---------------- Sparkle particle burst koin & permata (zero-GC pool) ---------------- */
  const SPARKLE_MAX = 180;
  const spPos = new Float32Array(SPARKLE_MAX * 3);
  const spCol = new Float32Array(SPARKLE_MAX * 3);
  const spVel = new Float32Array(SPARKLE_MAX * 3);
  const spBaseCol = new Float32Array(SPARKLE_MAX * 3);
  const spLife = new Float32Array(SPARKLE_MAX);
  const spMaxLife = new Float32Array(SPARKLE_MAX);
  for (let i = 0; i < SPARKLE_MAX; i++) spPos[i * 3 + 1] = -999;

  const sparkleGeo = new THREE.BufferGeometry();
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  sparkleGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparkleMat = new THREE.PointsMaterial({
    map: moteTex, size: 0.92, sizeAttenuation: true,
    vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
  sparkles.frustumCulled = false;
  scene.add(sparkles);

  const FRUIT_BURST_PALETTES = {
    strawberry: ['#e63946', '#ff4d6d', '#ffbe0b', '#38b000'],
    melon: ['#2ec4b6', '#38b000', '#1b6b33', '#ff5c8a'],
    banana: ['#ffe135', '#ffbe0b', '#fff3b0', '#70e000'],
    orange: ['#fb5607', '#ff9f1c', '#ffbe0b', '#38b000'],
  };

  let spCursor = 0;
  const _tmpCol = new THREE.Color();
  function spawnSparkles(x, y, z, kind = 'coin') {
    const isGem = kind === true || kind === 'gem';
    const fruitCols = typeof kind === 'string' ? FRUIT_BURST_PALETTES[kind] : null;
    const burst = isGem ? 28 : fruitCols ? 24 : 16;
    for (let k = 0; k < burst; k++) {
      const idx = spCursor;
      spCursor = (spCursor + 1) % SPARKLE_MAX;
      const ang = (k / burst) * Math.PI * 2 + Math.random() * 0.4;
      const spd = (isGem || fruitCols ? 6.4 : 4.6) * (0.55 + Math.random() * 0.7);
      spPos[idx * 3] = x + (Math.random() - 0.5) * 0.4;
      spPos[idx * 3 + 1] = y + (Math.random() - 0.5) * 0.35;
      spPos[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      spVel[idx * 3] = Math.cos(ang) * spd;
      spVel[idx * 3 + 1] = (isGem || fruitCols ? 7.2 : 5.2) + Math.random() * 4.0;
      spVel[idx * 3 + 2] = Math.sin(ang) * spd;

      if (isGem) {
        _tmpCol.setHSL((k / burst + Math.random() * 0.1) % 1, 0.95, 0.65);
      } else if (fruitCols) {
        _tmpCol.set(fruitCols[k % fruitCols.length]);
      } else {
        _tmpCol.setHSL(0.11 + Math.random() * 0.04, 0.95, 0.62 + Math.random() * 0.22);
      }
      spBaseCol[idx * 3] = _tmpCol.r;
      spBaseCol[idx * 3 + 1] = _tmpCol.g;
      spBaseCol[idx * 3 + 2] = _tmpCol.b;
      spCol[idx * 3] = _tmpCol.r;
      spCol[idx * 3 + 1] = _tmpCol.g;
      spCol[idx * 3 + 2] = _tmpCol.b;
      const ml = (isGem || fruitCols ? 0.74 : 0.52) + Math.random() * 0.22;
      spLife[idx] = ml;
      spMaxLife[idx] = ml;
    }
    sparkleGeo.attributes.position.needsUpdate = true;
    sparkleGeo.attributes.color.needsUpdate = true;
  }

  /* ---------------- 3D Celebratory Fireworks Pool (zero-GC) ---------------- */
  const FIREWORK_MAX = 240;
  const fwPos = new Float32Array(FIREWORK_MAX * 3);
  const fwCol = new Float32Array(FIREWORK_MAX * 3);
  const fwVel = new Float32Array(FIREWORK_MAX * 3);
  const fwBaseCol = new Float32Array(FIREWORK_MAX * 3);
  const fwLife = new Float32Array(FIREWORK_MAX);
  const fwMaxLife = new Float32Array(FIREWORK_MAX);
  for (let i = 0; i < FIREWORK_MAX; i++) fwPos[i * 3 + 1] = -999;

  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fwMat = new THREE.PointsMaterial({
    map: moteTex, size: 1.55, sizeAttenuation: true,
    vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fireworks = new THREE.Points(fwGeo, fwMat);
  fireworks.frustumCulled = false;
  scene.add(fireworks);

  const FIREWORK_PALETTES = ['#ffbe0b', '#ff2a4b', '#38bdf8', '#39ff14', '#c084fc', '#ff6b00'];
  let fwCursor = 0;
  function spawnFireworks(x, y, z) {
    const burst = 44;
    const baseHue = Math.random();
    for (let k = 0; k < burst; k++) {
      const idx = fwCursor;
      fwCursor = (fwCursor + 1) % FIREWORK_MAX;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = 8.5 + Math.random() * 11.5;
      fwPos[idx * 3] = x + (Math.random() - 0.5) * 0.6;
      fwPos[idx * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      fwPos[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      fwVel[idx * 3] = Math.sin(phi) * Math.cos(theta) * spd;
      fwVel[idx * 3 + 1] = Math.abs(Math.cos(phi)) * spd * 0.85 + 4.5;
      fwVel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * spd;

      if (k % 3 === 0) _tmpCol.setHSL((baseHue + k * 0.02) % 1, 0.96, 0.66);
      else _tmpCol.set(FIREWORK_PALETTES[k % FIREWORK_PALETTES.length]);

      fwBaseCol[idx * 3] = _tmpCol.r;
      fwBaseCol[idx * 3 + 1] = _tmpCol.g;
      fwBaseCol[idx * 3 + 2] = _tmpCol.b;
      fwCol[idx * 3] = _tmpCol.r;
      fwCol[idx * 3 + 1] = _tmpCol.g;
      fwCol[idx * 3 + 2] = _tmpCol.b;
      const ml = 0.95 + Math.random() * 0.45;
      fwLife[idx] = ml;
      fwMaxLife[idx] = ml;
    }
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.color.needsUpdate = true;
  }

  /* ---------------- Contact shadow dinamis di bawah player ---------------- */
  const csTex = applyCanvasTextureFiltering(makeContactShadowTexture());
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: csTex, transparent: true, depthWrite: false, color: '#1a0f08' })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.renderOrder = 1;
  scene.add(contactShadow);

  function updateContactShadow(x, groundY, z, airHeight = 0, footprint = PHYSICS.contactShadow.footprint, visible = true) {
    if (!visible) {
      contactShadow.visible = false;
      return;
    }
    const cs = PHYSICS.contactShadow;
    contactShadow.visible = true;
    contactShadow.position.set(x, groundY + cs.lift, z);
    const s = footprint * (1 + airHeight * 0.08);
    contactShadow.scale.set(s, s, 1);
    contactShadow.material.opacity = THREE.MathUtils.clamp(cs.baseOpacity - airHeight * 0.03, 0.08, cs.baseOpacity);
  }

  /* ---------------- Anchor: rig cahaya & atmosfer mengikuti dunia ---------------- */
  const anchor = new THREE.Vector3();
  function setAnchor(x, y, z) {
    anchor.set(x, y, z);
    key.position.set(x + keyDir.x * LIGHTING.key.distance, y + keyDir.y * LIGHTING.key.distance, z + keyDir.z * LIGHTING.key.distance);
    key.target.position.set(x, y, z);
    rim.position.set(x + rimDir.x * LIGHTING.rim.distance, y + rimDir.y * LIGHTING.rim.distance, z + rimDir.z * LIGHTING.rim.distance);
    rim.target.position.set(x, y, z);
    sky.position.set(x, 0, z);
    sunCore.position.set(x + keyDir.x * LIGHTING.sunSprite.distance, keyDir.y * LIGHTING.sunSprite.distance, z + keyDir.z * LIGHTING.sunSprite.distance);
    sunHalo.position.copy(sunCore.position);
  }
  setAnchor(0, 0, 0);

  /* ---------------- Kamera chase 45° horizon-locked ---------------- */
  const camPos = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredAim = new THREE.Vector3();
  const _lastHorizFwd = new THREE.Vector3(0, 0, -1);
  const _horizRight = new THREE.Vector3(1, 0, 0);
  let camInit = false, currentFov = CAMERA.fov;

  function updateHorizBasis(forwardVec) {
    if (forwardVec) {
      const hLen = Math.hypot(forwardVec.x, forwardVec.z);
      if (hLen > 0.25) {
        _lastHorizFwd.set(forwardVec.x / hLen, 0, forwardVec.z / hLen);
      }
    } else {
      _lastHorizFwd.set(0, 0, -1);
    }
    _horizRight.set(-_lastHorizFwd.z, 0, _lastHorizFwd.x);
  }

  function snapCamera(pos, forwardVec = null) {
    const isFantasy = currentAtmosphere === 'skyway' || currentAtmosphere === 'mandalika';
    const h = isFantasy ? (CAMERA.skywayHeight ?? CAMERA.height) : CAMERA.height;
    const d = isFantasy ? (CAMERA.skywayDistance ?? CAMERA.distance) : CAMERA.distance;
    if (forwardVec) {
      updateHorizBasis(forwardVec);
      camPos.set(
        pos.x - _lastHorizFwd.x * d,
        pos.y + h,
        pos.z - _lastHorizFwd.z * d
      );
      aim.set(
        pos.x + _lastHorizFwd.x * CAMERA.lookAhead,
        pos.y + CAMERA.lookHeight,
        pos.z + _lastHorizFwd.z * CAMERA.lookAhead
      );
    } else {
      _lastHorizFwd.set(0, 0, -1);
      _horizRight.set(1, 0, 0);
      camPos.set(pos.x * 0.90, pos.y + h, pos.z + d);
      aim.set(pos.x * 0.96, pos.y + CAMERA.lookHeight, pos.z - CAMERA.lookAhead);
    }
    camInit = true;
  }

  /** Ikuti player tanpa pernah ikut roll — damping eksponensial halus anti-jitter */
  function followCamera(pos, dt, {
    speedRatio = 0, turbo = false, inLoop = false, loopCenterZ = 0,
    falling = false, aimOffsetX = 0, arenaId = currentAtmosphere, introProgress = 1,
    forwardVec = null,
  } = {}) {
    if (!camInit) snapCamera(pos, forwardVec);
    const safeDt = Math.min(Math.max(dt || 0.016, 0), 0.05);
    const isFantasy = arenaId === 'skyway' || arenaId === 'mandalika';
    const sr = THREE.MathUtils.clamp(speedRatio, 0, 1.6);
    const basePosLerp = isFantasy ? (CAMERA.skywayPosLerp ?? 5.2) : CAMERA.posLerp;
    const baseAimLerp = isFantasy ? (CAMERA.skywayAimLerp ?? 7.2) : CAMERA.aimLerp;
    const kpX = 1 - Math.exp(-(inLoop ? 5.2 : basePosLerp) * safeDt);
    const kpY = 1 - Math.exp(-(inLoop ? 5.2 : basePosLerp * 0.86) * safeDt);
    const kpZ = 1 - Math.exp(-(inLoop ? 5.8 : basePosLerp * 2.2) * safeDt);
    const kaX = 1 - Math.exp(-(inLoop ? 6.8 : baseAimLerp) * safeDt);
    const kaY = 1 - Math.exp(-(inLoop ? 6.8 : baseAimLerp * 0.85) * safeDt);
    const kaZ = 1 - Math.exp(-(inLoop ? 7.4 : baseAimLerp * 1.9) * safeDt);
    const camH = isFantasy ? (CAMERA.skywayHeight ?? 7.0) : CAMERA.height;
    const camD = isFantasy ? (CAMERA.skywayDistance ?? 7.4) : CAMERA.distance;

    if (forwardVec) {
      updateHorizBasis(forwardVec);
      if (inLoop) {
        desiredPos.set(
          pos.x + _horizRight.x * 12.0 - _lastHorizFwd.x * 15.5,
          Math.max(pos.y * 0.45 + 6.5, 8.2),
          pos.z + _horizRight.z * 12.0 - _lastHorizFwd.z * 15.5
        );
        desiredAim.set(pos.x, pos.y + 0.8, pos.z);
      } else if (falling) {
        desiredPos.set(
          pos.x - _lastHorizFwd.x * 10.5,
          Math.max(pos.y + 8.5, camPos.y - 3.5 * safeDt),
          pos.z - _lastHorizFwd.z * 10.5
        );
        desiredAim.set(pos.x, pos.y - 0.6, pos.z);
      } else if (introProgress < 0.999) {
        const e = introProgress * introProgress * (3 - 2 * introProgress);
        const distBack = THREE.MathUtils.lerp(18.0, camD + sr * 0.4, e);
        const sideOut = THREE.MathUtils.lerp(8.0, 0, e);
        const lookDist = THREE.MathUtils.lerp(24.0, CAMERA.lookAhead, e);
        desiredPos.set(
          pos.x - _lastHorizFwd.x * distBack + _horizRight.x * sideOut,
          pos.y + THREE.MathUtils.lerp(14.5, camH - sr * 0.25, e),
          pos.z - _lastHorizFwd.z * distBack + _horizRight.z * sideOut
        );
        desiredAim.set(
          pos.x + _lastHorizFwd.x * lookDist + _horizRight.x * aimOffsetX * e,
          pos.y + THREE.MathUtils.lerp(2.5, CAMERA.lookHeight, e),
          pos.z + _lastHorizFwd.z * lookDist + _horizRight.z * aimOffsetX * e
        );
      } else {
        const distBack = camD + sr * 0.45;
        const lookDist = CAMERA.lookAhead + sr * 1.4;
        desiredPos.set(
          pos.x - _lastHorizFwd.x * distBack,
          pos.y + camH - sr * 0.22,
          pos.z - _lastHorizFwd.z * distBack
        );
        desiredAim.set(
          pos.x + _lastHorizFwd.x * lookDist + _horizRight.x * aimOffsetX,
          pos.y + CAMERA.lookHeight,
          pos.z + _lastHorizFwd.z * lookDist + _horizRight.z * aimOffsetX
        );
      }
      const kpH = 1 - Math.exp(-(inLoop ? 5.6 : basePosLerp * 1.55) * safeDt);
      const kaH = 1 - Math.exp(-(inLoop ? 7.2 : baseAimLerp * 1.5) * safeDt);
      camPos.x += (desiredPos.x - camPos.x) * kpH;
      camPos.y += (desiredPos.y - camPos.y) * kpY;
      camPos.z += (desiredPos.z - camPos.z) * kpH;
      aim.x += (desiredAim.x - aim.x) * kaH;
      aim.y += (desiredAim.y - aim.y) * kaY;
      aim.z += (desiredAim.z - aim.z) * kaH;
    } else {
      if (inLoop) {
        desiredPos.set(pos.x + 11.5, Math.max(pos.y * 0.45 + 6.5, 8.2), loopCenterZ + 19.5);
        desiredAim.set(pos.x, pos.y + 0.8, pos.z);
      } else if (falling) {
        desiredPos.set(pos.x * 0.94, Math.max(pos.y + 8.5, camPos.y - 3.5 * safeDt), pos.z + 10.5);
        desiredAim.set(pos.x, pos.y - 0.6, pos.z);
      } else if (introProgress < 0.999) {
        const e = introProgress * introProgress * (3 - 2 * introProgress);
        const chaseX = pos.x * 0.94;
        const chaseY = pos.y + camH - sr * 0.3;
        const chaseZ = pos.z + camD + sr * 0.4;
        desiredPos.set(
          THREE.MathUtils.lerp(pos.x + 9.0, chaseX, e),
          THREE.MathUtils.lerp(pos.y + 15.5, chaseY, e),
          THREE.MathUtils.lerp(pos.z + 20.0, chaseZ, e)
        );
        desiredAim.set(
          pos.x + aimOffsetX * e,
          THREE.MathUtils.lerp(pos.y + 2.8, pos.y + CAMERA.lookHeight, e),
          THREE.MathUtils.lerp(pos.z - 28.0, pos.z - CAMERA.lookAhead, e)
        );
      } else {
        desiredPos.set(
          pos.x * 0.94,
          pos.y + camH - sr * (isFantasy ? 0.22 : 0.38),
          pos.z + camD + sr * 0.45
        );
        desiredAim.set(pos.x + aimOffsetX, pos.y + CAMERA.lookHeight, pos.z - CAMERA.lookAhead - sr * 1.4);
      }

      camPos.x += (desiredPos.x - camPos.x) * kpX;
      camPos.y += (desiredPos.y - camPos.y) * kpY;
      camPos.z += (desiredPos.z - camPos.z) * kpZ;
      aim.x += (desiredAim.x - aim.x) * kaX;
      aim.y += (desiredAim.y - aim.y) * kaY;
      aim.z += (desiredAim.z - aim.z) * kaZ;
    }

    const shakeMul = isFantasy ? (CAMERA.skywayShakeMul ?? 0.35) : 1.0;
    camera.position.copy(camPos);
    camera.position.x += shakeOffset.x * shakeMul;
    camera.position.y += shakeOffset.y * shakeMul;
    camera.up.set(0, 1, 0);
    camera.lookAt(aim);
    const maxFov = isFantasy ? 65 : (CAMERA.maxFov ?? 67);
    const baseGain = Math.min(1, sr) * (CAMERA.fovSpeedGain ?? 6.0);
    const targetFov = (turbo || inLoop) ? maxFov : Math.min(maxFov, CAMERA.fov + baseGain);
    const fovLerp = 1 - Math.exp(-((turbo || inLoop) ? 7.2 : 4.2) * safeDt);
    currentFov += (targetFov - currentFov) * fovLerp;
    if (Math.abs(currentFov - camera.fov) > 0.01) {
      camera.fov = currentFov;
      camera.updateProjectionMatrix();
    }
  }

  /* ---------------- Proyeksi koordinat 3D → layar (zero-GC) ---------------- */
  const _projVec = new THREE.Vector3();
  function projectToScreen(wx, wy, wz, out) {
    _projVec.set(wx, wy, wz).project(camera);
    const w = renderer.domElement.clientWidth || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;
    out.x = (_projVec.x * 0.5 + 0.5) * w;
    out.y = (-_projVec.y * 0.5 + 0.5) * h;
    out.visible = _projVec.z >= -1 && _projVec.z <= 1;
    return out;
  }

  /* ---------------- Camera shake (trauma, tanpa roll) ---------------- */
  const shakeOffset = new THREE.Vector3();
  let trauma = 0;
  function addShake(amount) { trauma = Math.min(1, trauma + amount); }

  /* ---------------- Update atmosfer per frame ---------------- */
  const wrapR = LIGHTING.clouds.wrapRadius;
  function update(dt, t) {
    trauma = Math.max(0, trauma - CAMERA.shakeDecay * dt);
    const tr2 = trauma * trauma;
    shakeOffset.set(tr2 * CAMERA.shakeAmp * Math.sin(t * 47.3), tr2 * CAMERA.shakeAmp * 0.75 * Math.sin(t * 39.7 + 1.7), 0);

    for (const c of clouds) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x - anchor.x > wrapR) c.position.x -= wrapR * 2;
      if (c.position.x - anchor.x < -wrapR) c.position.x += wrapR * 2;
      if (c.position.z - anchor.z > wrapR) c.position.z -= wrapR * 2;
      if (c.position.z - anchor.z < -wrapR) c.position.z += wrapR * 2;
    }

    for (const b of balloons) {
      const ud = b.userData;
      b.position.x += ud.driftX * dt;
      b.position.y = ud.baseY + Math.sin(t * 0.7 + ud.phase) * ud.bobAmp;
      b.rotation.y += ud.spin * dt;
      if (b.position.x - anchor.x > balloonWrapR) b.position.x -= balloonWrapR * 2;
      if (b.position.x - anchor.x < -balloonWrapR) b.position.x += balloonWrapR * 2;
      if (b.position.z - anchor.z > balloonWrapR) b.position.z -= balloonWrapR * 2;
      if (b.position.z - anchor.z < -balloonWrapR) b.position.z += balloonWrapR * 2;
    }

    for (const rg of rainbows) {
      if (rg.position.z - anchor.z > 85) rg.position.z -= 260;
      if (rg.position.z - anchor.z < -265) rg.position.z += 260;
      rg.position.x = anchor.x + rg.userData.baseX;
      rg.position.y = rg.userData.baseY + Math.sin(t * 0.35 + rg.userData.baseX) * 0.8;
    }

    for (const st of stars) {
      const ud = st.userData;
      const tw = 0.5 + 0.5 * Math.sin(t * ud.twinkleSpd + ud.phase);
      st.scale.setScalar(ud.baseScale * (0.78 + tw * 0.42));
      st.rotation.y += ud.spinSpd * dt;
      st.position.y = ud.baseY + Math.sin(t * 0.8 + ud.phase) * 0.8;
      ud.mat.emissiveIntensity = 0.55 + tw * 0.95;
      ud.halo.material.opacity = 0.32 + tw * 0.48;
      if (st.position.x - anchor.x > starWrapR) st.position.x -= starWrapR * 2;
      if (st.position.x - anchor.x < -starWrapR) st.position.x += starWrapR * 2;
      if (st.position.z - anchor.z > starWrapR) st.position.z -= starWrapR * 2;
      if (st.position.z - anchor.z < -starWrapR) st.position.z += starWrapR * 2;
    }

    const arr = moteGeo.attributes.position.array;
    for (let i = 0; i < moteCount; i++) {
      arr[i * 3 + 1] = moteBaseY[i] + Math.sin(t * 0.5 + motePhase[i]) * 0.6;
      arr[i * 3] += 0.15 * dt;
      if (arr[i * 3] - anchor.x > moteBox.x / 2) arr[i * 3] -= moteBox.x;
      if (arr[i * 3] - anchor.x < -moteBox.x / 2) arr[i * 3] += moteBox.x;
      if (arr[i * 3 + 2] - anchor.z > moteBox.z / 2) arr[i * 3 + 2] -= moteBox.z;
      if (arr[i * 3 + 2] - anchor.z < -moteBox.z / 2) arr[i * 3 + 2] += moteBox.z;
    }
    moteGeo.attributes.position.needsUpdate = true;

    let spDirty = false;
    for (let i = 0; i < SPARKLE_MAX; i++) {
      if (spLife[i] <= 0) continue;
      spDirty = true;
      spLife[i] -= dt;
      if (spLife[i] <= 0) {
        spPos[i * 3 + 1] = -999;
        spCol[i * 3] = 0; spCol[i * 3 + 1] = 0; spCol[i * 3 + 2] = 0;
      } else {
        spVel[i * 3 + 1] -= 13.5 * dt;
        spPos[i * 3] += spVel[i * 3] * dt;
        spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt;
        spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
        const fade = spLife[i] / spMaxLife[i];
        spCol[i * 3] = spBaseCol[i * 3] * fade;
        spCol[i * 3 + 1] = spBaseCol[i * 3 + 1] * fade;
        spCol[i * 3 + 2] = spBaseCol[i * 3 + 2] * fade;
      }
    }
    if (spDirty) {
      sparkleGeo.attributes.position.needsUpdate = true;
      sparkleGeo.attributes.color.needsUpdate = true;
    }

    let fwDirty = false;
    const drag = Math.exp(-1.5 * dt);
    for (let i = 0; i < FIREWORK_MAX; i++) {
      if (fwLife[i] <= 0) continue;
      fwDirty = true;
      fwLife[i] -= dt;
      if (fwLife[i] <= 0) {
        fwPos[i * 3 + 1] = -999;
        fwCol[i * 3] = 0; fwCol[i * 3 + 1] = 0; fwCol[i * 3 + 2] = 0;
      } else {
        fwVel[i * 3] *= drag;
        fwVel[i * 3 + 1] = fwVel[i * 3 + 1] * drag - 8.8 * dt;
        fwVel[i * 3 + 2] *= drag;
        fwPos[i * 3] += fwVel[i * 3] * dt;
        fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt;
        fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt;
        const fade = Math.pow(fwLife[i] / fwMaxLife[i], 0.75);
        fwCol[i * 3] = fwBaseCol[i * 3] * fade;
        fwCol[i * 3 + 1] = fwBaseCol[i * 3 + 1] * fade;
        fwCol[i * 3 + 2] = fwBaseCol[i * 3 + 2] * fade;
      }
    }
    if (fwDirty) {
      fwGeo.attributes.position.needsUpdate = true;
      fwGeo.attributes.color.needsUpdate = true;
    }

    sunHalo.material.opacity = 0.22 + Math.sin(t * 0.7) * 0.04;
  }

  /* ---------------- Resize, kualitas, render, dispose ---------------- */
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function setQuality(high) {
    renderer.setPixelRatio(isSoftwareGl ? 1 : (high ? Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio) : 1));
    resize();
  }

  function render() { renderer.render(scene, camera); }

  /** Lepas resource milik sceneSetup saja (cache assetFactory tetap hidup). */
  function dispose() {
    window.removeEventListener('resize', resize);
    envTex.dispose();
    sky.geometry.dispose(); skyTexSalatiga.dispose(); skyTexSkyway.dispose(); skyMat.dispose();
    sunCore.material.dispose(); sunHalo.material.dispose(); sunTex.dispose();
    puffGeo.dispose(); cloudMat.dispose();
    balloonEnvGeo.dispose(); balloonCollarGeo.dispose(); balloonBasketGeo.dispose();
    balloonRopeGeo.dispose(); balloonFlameGeo.dispose();
    balloonTextures.forEach((t) => t.dispose());
    balloonEnvMats.forEach((m) => m.dispose());
    basketMat.dispose(); ropeMat.dispose(); collarMat.dispose(); burnerMat.dispose();
    rainbowBandGeos.forEach((g) => g.dispose());
    rainbowBandMats.forEach((m) => m.dispose());
    starGeo.dispose(); starTex.dispose();
    stars.forEach((st) => { st.userData.mat.dispose(); st.userData.halo.material.dispose(); });
    moteGeo.dispose(); motes.material.dispose(); moteTex.dispose();
    sparkleGeo.dispose(); sparkleMat.dispose();
    fwGeo.dispose(); fwMat.dispose();
    contactShadow.geometry.dispose(); contactShadow.material.dispose(); csTex.dispose();
    renderer.dispose();
  }

  return {
    renderer, scene, camera, maxAnisotropy, refineSceneTextures,
    keyLight: key, hemiLight: hemi, rimLight: rim,
    contactShadow, updateContactShadow, spawnSparkles, spawnFireworks,
    projectToScreen, setAnchor, setAtmosphere, snapCamera, followCamera, addShake,
    update, setQuality, resize, render, dispose,
  };
}

/* ==================== Texture helpers (statis, dibuat sekali) ==================== */
function makeSkyTexture() {
  const c = document.createElement('canvas'); c.width = 2; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, PALETTE.skyZenith);     // deep crisp sky blue (#1d4ed8)
  grad.addColorStop(0.24, PALETTE.skyMid);     // bright cerulean (#38bdf8)
  grad.addColorStop(0.46, '#93d5ff');
  grad.addColorStop(0.62, '#bfe9ff');          // atmospheric horizon fog blend
  grad.addColorStop(0.84, '#dff4ff');
  grad.addColorStop(1, '#bfe9ff');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSkywaySkyTexture() {
  const c = document.createElement('canvas'); c.width = 2; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0284c7');
  grad.addColorStop(0.26, '#38bdf8');
  grad.addColorStop(0.52, '#7dd3fc');
  grad.addColorStop(0.74, '#bfe9ff');
  grad.addColorStop(1, '#dff4ff');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBalloonStripeTexture(colors) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const stripes = 12;
  const sw = c.width / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(i * sw, 0, sw + 1, c.height);
  }
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 48, c.width, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,240,210,.55)');
  grad.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeContactShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,.6)');
  grad.addColorStop(0.55, 'rgba(255,255,255,.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
