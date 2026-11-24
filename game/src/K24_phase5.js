// K24_ Fase 5 (ronde #19) — asphalt material & road surface refinement.
// Diagnosis dari shot Fase 4 (k23-final-*): aspal terlihat seperti tanah
// berbatu BUKAN karena satu lapisan, tapi karena EMPAT lapisan noise
// menumpuk dengan kontras tinggi di atas alas yang sama:
//   - kanvas ground: aus K17_ + K18_ (bercak 3-15 m, retak tebal 2,5 px,
//     tambalan kotak alpha 0,55 + jahitan pucat) + aus dasar gfx.js;
//   - overlay K17_ detail (tile 6 m, opacity 0,40);
//   - overlay K18_ kasar (tile 24 m, opacity 0,30, bercak 1,4-5 m);
//   - overlay K19_ halus (tile 3 m, opacity 0,68!, 90 elips keras +
//     160 agregat alpha sampai 0,70 per tile — inilah "kerikil").
// Perbaikan = KURANGI kontras + ukuran fitur di semua lapisan (bukan
// tambah lapisan baru), dinginkan warna ke abu-biru, dan lunakkan
// marka geometri + tambalan kotak. TIDAK ada perubahan gameplay /
// kamera / UI / langit / gedung / NPC — hanya material permukaan.
// Anggaran: 0 tris geometri baru untuk aspal; contact shadow +1 draw
// call (hero) + 1 draw call (pool traffic, 2 tris/mobil). ShadowMap
// tetap OFF (gfx.js:1174).
// Batas tris Fase 5 (revisi syarif 09:42 WIB): <550.000 absolut.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp } from './util.js';

function K24_canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function K24_texture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---- 1. TEKSTUR ASPAL BUTIR HALUS (pengganti K19_fineAsphaltTexture) --
// Tile 3 m yang sama, tapi fitur keras DIPOTONG ~60% dan alpha
// diturunkan ~setengah: elips keras 90 -> 36 (lebih kecil, 6-20 px),
// agregat 160 -> 70 (alpha 0,22-0,34, dulu 0,45-0,70), speckle
// 2600 -> 1800 (alpha 0,16-0,34), retak 30 -> 16 (alpha 0,38).
// Hasil: butir mikro tetap terbaca dekat, tapi tidak lagi menumpuk
// jadi kerikil kontras tinggi di foreground.
export function K24_fineAsphaltTexture() {
  const S = 512;
  const cv = K24_canvas(S, S);
  const ctx = cv.getContext('2d');
  const draw = mulberry32(19001);
  // speckle padat: butir gelap + terang 1-2 px, alpha dijinakkan
  for (let i = 0; i < 1800; i++) {
    const light = draw() < 0.45;
    ctx.fillStyle = light
      ? `rgba(198,210,228,${0.16 + draw() * 0.18})`
      : `rgba(10,10,12,${0.16 + draw() * 0.18})`;
    ctx.fillRect(draw() * S, draw() * S, 1 + Math.floor(draw() * 2), 1 + Math.floor(draw() * 2));
  }
  // bercak keras skala 10-20 cm: lebih sedikit + lebih kecil + lebih redup
  for (let i = 0; i < 36; i++) {
    const x = draw() * S, y = draw() * S;
    const rx = 6 + draw() * 14, ry = 5 + draw() * 9;
    const pale = draw() < 0.42;
    ctx.fillStyle = pale
      ? `rgba(182,194,212,${0.15 + draw() * 0.11})`
      : `rgba(12,12,16,${0.15 + draw() * 0.11})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, draw() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // agregat pucat: batu 3-5 px, kontras dijinakkan (bukan lagi kilau)
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(182,194,212,${0.22 + draw() * 0.12})`;
    const s = 3 + Math.floor(draw() * 3);
    ctx.fillRect(draw() * S, draw() * S, s, s);
  }
  // retak tebal: lebih sedikit + lebih redup, tetap di dalam tile
  ctx.strokeStyle = 'rgba(12,12,14,0.38)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    ctx.lineWidth = 2;
    let cx = 20 + draw() * (S - 40), cy = 20 + draw() * (S - 40);
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      cx = clamp(cx + (draw() - 0.5) * 56, 20, S - 20);
      cy = clamp(cy + (draw() - 0.5) * 56, 20, S - 20);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  // blotch kecil lembut: variasi nada skala 1-2 m saja
  for (let i = 0; i < 26; i++) {
    const x = draw() * S, y = draw() * S;
    const r = 18 + draw() * 34;
    const pale = draw() < 0.4;
    const a = 0.05 + draw() * 0.04;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pale ? `rgba(182,194,212,${a})` : `rgba(12,12,16,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return K24_texture(cv);
}

// ---- 2. TEKSTUR ASPAL KASAR (pengganti K18_asphaltCoarseTexture) ------
// Tile 24 m yang sama, tapi bercak besar DIPOTONG: 80 -> 48, radius
// 30-110 px (1,4-5,2 m) -> 20-64 px (0,9-3,0 m), alpha maks 0,28 ->
// 0,15; speckle 520 -> 320 (alpha dijinakkan); retak 16 -> 10
// (alpha 0,26). Bercak besar inilah yang terbaca sebagai "noda
// hitam/cokelat raksasa" di shot chase — sekarang variasi nada
// skala meteran yang lembut, bukan noda.
export function K24_coarseAsphaltTexture() {
  const S = 512;
  const cv = K24_canvas(S, S);
  const ctx = cv.getContext('2d');
  const draw = mulberry32(18001);
  // bercak besar: radial gradient lembut, gelap + pucat
  for (let i = 0; i < 48; i++) {
    const x = draw() * S, y = draw() * S;
    const r = 20 + draw() * 44;
    const pale = draw() < 0.38;
    const a = pale ? 0.05 + draw() * 0.07 : 0.06 + draw() * 0.09;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pale ? `rgba(182,194,212,${a})` : `rgba(12,12,16,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // speckle tegas: butir gelap + terang 1-2 px
  for (let i = 0; i < 320; i++) {
    const light = draw() < 0.42;
    ctx.fillStyle = light
      ? `rgba(198,210,228,${0.10 + draw() * 0.12})`
      : `rgba(10,10,12,${0.10 + draw() * 0.12})`;
    ctx.fillRect(draw() * S, draw() * S, 1 + Math.floor(draw() * 2), 1 + Math.floor(draw() * 2));
  }
  // retak pendek di dalam tile (margin 30 px dari tepi)
  ctx.strokeStyle = 'rgba(10,10,13,0.26)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    ctx.lineWidth = 1.5 + draw() * 1;
    let cx = 30 + draw() * (S - 60), cy = 30 + draw() * (S - 60);
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      cx = clamp(cx + (draw() - 0.5) * 52, 30, S - 30);
      cy = clamp(cy + (draw() - 0.5) * 52, 30, S - 30);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  return K24_texture(cv);
}

// ---- 3. CONTACT SHADOW (pengganti ShadowMap yang tetap OFF) ----------
// Satu tekstur radial-gradient bersama: inti gelap lembut (alpha
// 0,50) yang memudar ke transparan di tepi — bayangan kontak di
// bawah mobil supaya kendaraan "menapak" di aspal, bukan melayang.
// Dipakai dua tempat: satu plane anak grup heroCar (ikut skala +
// heading hero), dan satu InstancedMesh pool untuk traffic
// (di-update di loop mobil yang sama, 1 draw call, 2 tris/mobil).
let K24_shadowTex = null;
export function K24_contactShadowTexture() {
  if (K24_shadowTex) return K24_shadowTex;
  const S = 256;
  const cv = K24_canvas(S, S);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(8,6,6,0.50)');
  g.addColorStop(0.55, 'rgba(8,6,6,0.30)');
  g.addColorStop(0.8, 'rgba(8,6,6,0.12)');
  g.addColorStop(1, 'rgba(8,6,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  K24_shadowTex = new THREE.CanvasTexture(cv);
  K24_shadowTex.colorSpace = THREE.SRGBColorSpace;
  return K24_shadowTex;
}

// Pool bayangan traffic: plane 1x1 yang DIPUTAR DATAR (rotateX -90)
// supaya scale instance (sx = panjang, sz = lebar) + rotasi Y =
// heading mobil langsung cocok dengan helper setM di update().
// renderOrder 3: digambar SETELAH overlay aspal (renderOrder 2) dan
// plane marka R7 (renderOrder 2, y 0,06) — bayangan memang harus
// menggelapkan marka di bawah mobil, seperti bayangan nyata.
export function K24_makeContactShadowMesh(count) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: K24_contactShadowTexture(),
    transparent: true, opacity: 1, depthWrite: false,
  });
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.renderOrder = 3;
  return m;
}

// Bayangan kontak hero: plane anak grup heroCar — ikut posisi,
// heading, dan skala visual hero (x1,10) otomatis. y 0,03 lokal:
// di atas kanvas ground (y 0) tapi di bawah overlay aspal —
// renderOrder 3 + depthWrite false membuatnya tetap tergambar
// di atas overlay tanpa z-fight dengan kotak marka (y 0,10+).
export function K24_addHeroContactShadow(heroCar) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 2.6),
    new THREE.MeshBasicMaterial({
      map: K24_contactShadowTexture(),
      transparent: true, opacity: 1, depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.renderOrder = 3;
  heroCar.add(mesh);
  return mesh;
}
