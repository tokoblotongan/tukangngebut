/* =====================================================================
   trackMaterial.js — Material & tekstur jalan oranye Hot Wheels bersih
   (tanpa normalMap, tanpa speed grooves, garis tepi putih putus-putus).
   Juga menyediakan helper refresh font kanvas saat document.fonts.ready.
   ===================================================================== */
import * as THREE from 'three';

export function whenFontsReady(cb) {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  document.fonts.ready.then(() => {
    try { cb(); } catch {}
  }).catch(() => {});
}

export function createCleanOrangeTrackTexture(maxAnisotropy = 4) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');

  // Oranye mainan bersih & solid (#ff6b00) dengan gradasi sisi sangat halus
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#ec6000');
  grad.addColorStop(0.08, '#ff6b00');
  grad.addColorStop(0.5, '#ff740f');
  grad.addColorStop(0.92, '#ff6b00');
  grad.addColorStop(1, '#ec6000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);

  // Sabuk tekstur lintasan melintang amat halus (tanpa alur kecepatan vertikal)
  g.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let y = 0; y < 512; y += 64) {
    g.fillRect(0, y, 512, 16);
  }

  // Garis tepi putih putus-putus yang tajam di kiri & kanan
  g.fillStyle = 'rgba(255, 252, 244, 0.92)';
  for (let y = 12; y < 512; y += 64) {
    g.fillRect(24, y, 12, 40);
    g.fillRect(476, y, 12, 40);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, maxAnisotropy || 1);
  return tex;
}

export function createCleanOrangeTrackMaterial({
  maxAnisotropy = 4,
  side = THREE.FrontSide,
  repeatX = 1,
  repeatY = 1,
  polygonOffset = false,
} = {}) {
  const map = createCleanOrangeTrackTexture(maxAnisotropy);
  if (repeatX !== 1 || repeatY !== 1) {
    map.repeat.set(repeatX, repeatY);
  }
  return new THREE.MeshStandardMaterial({
    map,
    color: '#ffffff',
    roughness: 0.45,
    metalness: 0.05,
    side,
    ...(polygonOffset ? { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 } : {}),
  });
}

export function createWarningSignTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d90429';
  g.fillRect(0, 0, 128, 128);

  // Segitiga peringatan putih + tanda seru merah bersih
  g.fillStyle = '#fff8eb';
  g.beginPath();
  g.moveTo(64, 16);
  g.lineTo(114, 108);
  g.lineTo(14, 108);
  g.closePath();
  g.fill();

  g.lineWidth = 6;
  g.strokeStyle = '#ffbe0b';
  g.stroke();

  g.fillStyle = '#d90429';
  g.beginPath();
  g.roundRect(57, 42, 14, 36, 5);
  g.fill();
  g.beginPath();
  g.arc(64, 93, 8, 0, Math.PI * 2);
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
