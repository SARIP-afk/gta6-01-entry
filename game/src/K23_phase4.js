// K23_ Fase 4 (ronde #18) — final visual polish, lanjutan Fase 3.
// Semua helper Fase 4 tinggal di sini supaya diff gfx.js tetap kecil
// dan setiap tahap bisa di-rollback dengan melepas satu pemanggilan.
// TIDAK ada perubahan gameplay / sistem — hanya aset visual.
// Anggaran: SEMUA target 0 tris (reshape + tekstur + warna + cahaya).

import * as THREE from '../vendor/three.module.min.js';

// ---- Target A: framing hero -------------------------------------------
// Skala VISUAL grup heroCar saja (+10%): sim/fisika tidak berubah
// (posisi + heading tetap dari sim; grup berpusat di tanah y=0,
// jadi roda tetap menapak — pusat roda y 0,38 -> 0,418, jari-jari
// 0,38 -> 0,418, alas roda tetap y=0). Baseline chase: lebar hero
// 267 px = 10,4% lebar frame (diukur p0-baseline); x1,10 -> ~294 px
// (~11,5%) bila proyeksi linear — diukur ulang di shot A.
// Fill light ikut grup (posisi lokal -5,5 -> -6,05 m, intensitas
// tidak berubah). Cover: hero sudah besar di sana; dicek tidak
// menabrak tepi kanan frame.
export const K23_HERO_SCALE = 1.10;

// ---- Target E (dan heroWalk): taper box -------------------------------
// BoxGeometry yang ujung atas / bawahnya dirampingkan / dilebarkan
// dengan menggeser verteks yang sudah ada — 0 tris baru.
// topXZ: faktor skala x/z verteks y=+h/2; botXZ: y=-h/2.
// Dipakai: torso NPC (bahu meruncing 0,70, pinggang 0,88), kepala
// (rahang/leher 0,65 di bawah, 0,95 di atas), lengan (tangan
// mengembang 1,40 di ujung bawah = mitten), kaki (pergelangan 0,88).
export function K23_taperBox(w, h, d, topXZ = 1, botXZ = 1) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = y > 0 ? topXZ : y < 0 ? botXZ : 1;
    if (f !== 1) {
      pos.setX(i, pos.getX(i) * f);
      pos.setZ(i, pos.getZ(i) * f);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---- Target D: awan di kanvas kubah langit ----------------------------
// K17_buildClouds (awan 3D) sudah ada tapi tipis; goresan putih di
// cover Fase 3 adalah wisp itu (opacity ~0,30, puff hanya 5-13 m
// tinggi). Lapisan kedua ini DILUKIS ke kanvas kubah langit saat
// repaint per-bucket di update() — 0 tris, 0 draw call, dan tidak
// bisa hilang karena drift awan 3D. Pita atas langit (y 18..95 px
// dari 256, v 0,07..0,37 — di atas horizon oranye, di bawah zenith)
// supaya tidak menutupi matahari / horizon. Elips lembut berlapis:
// inti putih-pink terang (tepi atas kena matahari) + bayangan ungu
// di bawahnya. Deterministik (hash sin, tanpa Math.random) dan TIDAK
// bergantung bucket — sama di tiap repaint, jadi tidak berkedip.
export function K23_paintDomeClouds(ctx) {
  const K23_h = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const puff = (cx, cy, rx, ry, a) => {
    // bayangan ungu di bawah (sedikit lebih rendah + lebih lebar)
    let g = ctx.createRadialGradient(cx, cy + ry * 0.45, 0, cx, cy + ry * 0.45, rx);
    g.addColorStop(0, `rgba(122,74,116,${(a * 0.55).toFixed(2)})`);
    g.addColorStop(1, 'rgba(90,50,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.45, rx * 1.05, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // inti terang: pink pucat (tepi atas kena matahari senja)
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, `rgba(255,214,226,${a.toFixed(2)})`);
    g.addColorStop(0.6, `rgba(255,205,220,${(a * 0.55).toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,200,215,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // 12 gugus, masing-masing 2-4 elips tumpang-tindih; x membungkus
  // 512 px (u 0..1 = 360 derajat), jadi awan ada di semua azimuth.
  for (let c = 0; c < 12; c++) {
    const cx = K23_h(c * 7 + 1) * 512;
    const cy = 22 + K23_h(c * 7 + 2) * 68;
    const big = K23_h(c * 7 + 3) > 0.55; // gugus besar lebih jarang
    const rx = (big ? 55 : 30) + K23_h(c * 7 + 4) * (big ? 55 : 35);
    const ry = (big ? 7 : 4) + K23_h(c * 7 + 5) * (big ? 7 : 4);
    const a = 0.14 + K23_h(c * 7 + 6) * 0.12;
    puff(cx, cy, rx, ry, a);
    const n2 = 2 + Math.floor(K23_h(c * 7 + 7) * 2);
    for (let k = 0; k < n2; k++) {
      const ox = (K23_h(c * 31 + k * 5 + 1) - 0.5) * rx * 1.5;
      const oy = (K23_h(c * 31 + k * 5 + 2) - 0.5) * ry * 1.1;
      puff(cx + ox, cy + oy, rx * (0.45 + K23_h(c * 31 + k * 5 + 3) * 0.3), ry * (0.6 + K23_h(c * 31 + k * 5 + 4) * 0.5), a * 0.85);
    }
  }
}
