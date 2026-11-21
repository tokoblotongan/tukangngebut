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
  renderer.toneMappingExposure = RENDERER.exposure;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));

  /* ---------------- Scene + fog atmosfer (linear di cakrawala jauh) ---------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LIGHTING.fog.color);
  scene.fog = new THREE.Fog(LIGHTING.fog.color, LIGHTING.fog.near, LIGHTING.fog.far);

  /* Studio environment map halus agar emas koin, buah glossy & plastik mainan berkilau */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.46;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(0, CAMERA.height, CAMERA.distance);
  camera.up.set(0, 1, 0); // horizon-lock: up tidak pernah berubah

  /* ---------------- Tiga titik cahaya lembut ala Source 2 / Dota 2 ---------------- */
  const hemi = new THREE.HemisphereLight(LIGHTING.hemi.sky, LIGHTING.hemi.ground, LIGHTING.hemi.intensity);
  scene.add(hemi);

  const keyDir = new THREE.Vector3(LIGHTING.key.dir.x, LIGHTING.key.dir.y, LIGHTING.key.dir.z).normalize();
  const key = new THREE.DirectionalLight(LIGHTING.key.color, LIGHTING.key.intensity);
  key.castShadow = !isSoftwareGl;
  key.shadow.mapSize.set(RENDERER.shadowMapSize, RENDERER.shadowMapSize);
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

  /* ---------------- Langit gradien biru cerah → cakrawala emas hangat (#FFD89B) ---------------- */
  const skyTex = makeSkyTexture();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(380, 28, 18),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  /* Matahari: inti + halo aditif, searah key light */
  const sunTex = makeGlowTexture();
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
  const balloonTextures = balloonPalettes.map((cols) => makeBalloonStripeTexture(cols));
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
  const moteTex = makeGlowTexture(64);
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

  /* ---------------- Contact shadow dinamis di bawah player ---------------- */
  const csTex = makeContactShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: csTex, transparent: true, depthWrite: false, color: '#1a0f08' })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.renderOrder = 1;
  scene.add(contactShadow);

  function updateContactShadow(x, groundY, z, airHeight = 0, footprint = PHYSICS.contactShadow.footprint) {
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
  let camInit = false, currentFov = CAMERA.fov;

  function snapCamera(pos) {
    camPos.set(pos.x * 0.90, pos.y + CAMERA.height, pos.z + CAMERA.distance);
    aim.set(pos.x * 0.96, pos.y + CAMERA.lookHeight, pos.z - CAMERA.lookAhead);
    camInit = true;
  }

  /** Ikuti player tanpa pernah ikut roll — kamera chase 45° intim & horizon-locked */
  function followCamera(pos, dt, { speedRatio = 0, turbo = false } = {}) {
    if (!camInit) snapCamera(pos);
    const sr = THREE.MathUtils.clamp(speedRatio, 0, 1.6);
    const kp = 1 - Math.exp(-CAMERA.posLerp * dt);
    const ka = 1 - Math.exp(-CAMERA.aimLerp * dt);
    desiredPos.set(
      pos.x * 0.90,
      pos.y + CAMERA.height - sr * 0.38,
      pos.z + CAMERA.distance + sr * 0.45
    );
    desiredAim.set(pos.x * 0.96, pos.y + CAMERA.lookHeight, pos.z - CAMERA.lookAhead - sr * 1.6);
    camPos.lerp(desiredPos, kp);
    aim.lerp(desiredAim, ka);
    camera.position.copy(camPos);
    camera.position.x += shakeOffset.x;
    camera.position.y += shakeOffset.y;
    camera.up.set(0, 1, 0);
    camera.lookAt(aim);
    const maxFov = CAMERA.maxFov ?? 68;
    const baseGain = Math.min(1, sr) * (CAMERA.fovSpeedGain ?? 6.5);
    const targetFov = turbo ? maxFov : Math.min(maxFov, CAMERA.fov + baseGain);
    const fovLerp = 1 - Math.exp(-(turbo ? 7.5 : 4.5) * dt);
    currentFov += (targetFov - currentFov) * fovLerp;
    if (Math.abs(currentFov - camera.fov) > 0.01) {
      camera.fov = currentFov;
      camera.updateProjectionMatrix();
    }
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
    sky.geometry.dispose(); sky.material.map.dispose(); sky.material.dispose();
    sunCore.material.dispose(); sunHalo.material.dispose(); sunTex.dispose();
    puffGeo.dispose(); cloudMat.dispose();
    balloonEnvGeo.dispose(); balloonCollarGeo.dispose(); balloonBasketGeo.dispose();
    balloonRopeGeo.dispose(); balloonFlameGeo.dispose();
    balloonTextures.forEach((t) => t.dispose());
    balloonEnvMats.forEach((m) => m.dispose());
    basketMat.dispose(); ropeMat.dispose(); collarMat.dispose(); burnerMat.dispose();
    moteGeo.dispose(); motes.material.dispose(); moteTex.dispose();
    sparkleGeo.dispose(); sparkleMat.dispose();
    contactShadow.geometry.dispose(); contactShadow.material.dispose(); csTex.dispose();
    renderer.dispose();
  }

  return {
    renderer, scene, camera,
    keyLight: key, hemiLight: hemi, rimLight: rim,
    contactShadow, updateContactShadow, spawnSparkles,
    setAnchor, snapCamera, followCamera, addShake,
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
  grad.addColorStop(0.45, '#93c5fd');
  grad.addColorStop(0.62, PALETTE.horizon);    // warm golden horizon (#ffd89b)
  grad.addColorStop(0.84, '#ffe5b8');
  grad.addColorStop(1, '#ffd89b');
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
