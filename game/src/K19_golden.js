// K19_ golden-hour realism pass — Solmarina polish round #14 (Builder A).
// Tiga keluhan syarif dari screenshot cover beranotasi (15:34 WIB):
// (1) heli kotak, (2) palem bilah papan + batang balok bertumpuk,
// (3) aspal blur kayak mosaik + garis cahaya aneh di foreground.
// Plus bar final 15:31 WIB: SEMUA elemen detail + HD 2K native, arah
// realistis. File ini: cat kanvas (sun-bleach + hapus marka tekstur di
// koridor), dressing geometri marka (garis kuning ganda + dash putih +
// zebra — geometri = tajam di 2K, tidak blur seperti cat kanvas 5,3
// px/m), tekstur aspal butir halus (tile 3 m), dan geometri pelepah
// palem melengkung. Semua prosedural, 0 file gambar. Deterministik
// (hash2 / mulberry32), tidak ada Math.random.
//
// Kenapa aspal blur: kanvas ground 4096 px / 768 m = 5,3 px/m dan
// plane R7 2048 px / 768 m = 2,7 px/m — di foreground 2K tiap texel
// membesar jadi mosaik; overlay kasar K18 (tile 24 m, blotch lembut)
// menambah kabur. Obatnya bukan cat yang lebih tebal, tapi detail
// frekuensi-tinggi di skala 3 m (K19_fineAsphaltTexture, 170 px/m)
// + marka geometri (bukan cat) + kurangi opasitas overlay lembut.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, hash2, clamp } from './util.js';

export const K19_ASPHALT_BASE = '#84909e'; // K23_ abu biru SEDIKIT lebih dingin lagi (dulu #8b929e — foreground median (64,37,28) R-B 36 masih hangat; alas didinginkan + speckle K19/K18 didinginkan, hemiSky ikut 0xb79aa0)

// Koridor kamera: jalan boulevard z=240 (shot play + cover, hero
// menghadap barat) dan jalan z=-144 (rute autopilot/default play).
// Marka tekstur dihapus di sini saja — sisa kota tetap pakai cat lama.
export const K19_CORRIDORS = [
  { z: 240, x0: -200, x1: 20, crossings: [-192, -144, -96, -48, 0] },
  { z: -144, x0: 30, x1: 230, crossings: [48, 96, 144, 192] },
];

function K19_canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---- 1. CAT KANVAS: sun-bleach + hapus marka tekstur di koridor -----
// Dipanggil di groundTexture SETELAH lane furniture (jadi bisa menimpa
// dash kuning + zebra tekstur), SEBELUM sidewalk borders. Pita tengah
// yang dihapus dicat ulang warna aspal + di-speckle lagi supaya tidak
// jadi strip bersih yang aneh — aus di bawah marka harus tetap ada.
export function K19_paintSunBleach(ctx, px, pz, mpp) {
  for (const c of K19_CORRIDORS) {
    // hapus dash kuning tengah: pita z ±0,5 m sepanjang koridor
    ctx.fillStyle = K19_ASPHALT_BASE;
    ctx.fillRect(px(c.x0), pz(c.z - 0.5), (c.x1 - c.x0) * mpp, 1.0 * mpp);
    // hapus zebra tekstur di tiap persimpangan (zebra geometri gantinya)
    for (const a of c.crossings) {
      ctx.fillRect(px(a - 7), pz(c.z - 6.5), 14 * mpp, 13 * mpp);
    }
    // speckle ulang pita yang dihapus: butir gelap + terang 2 px
    for (let i = 0; i < 420; i++) {
      const along = c.x0 + hash2(i, 501, 1) * (c.x1 - c.x0);
      const inCross = c.crossings.some((a) => Math.abs(along - a) < 7);
      const z = inCross
        ? c.z + (hash2(i, 502, 1) - 0.5) * 13
        : c.z + (hash2(i, 502, 1) - 0.5) * 1.0;
      const light = hash2(i, 503, 1) < 0.45;
      ctx.fillStyle = light
        ? `rgba(206,214,226,${0.10 + hash2(i, 504, 1) * 0.14})` // K23_ speckle terang didinginkan (dulu 222,224,226)
        : `rgba(10,10,12,${0.10 + hash2(i, 505, 1) * 0.16})`;
      ctx.fillRect(px(along), pz(z), 2, 2);
    }
    // sun-bleach: cucian pucat hangat (matahari sore membakar aspal),
    // elips besar alpha rendah — mengangkat koridor yang K18_ buat
    // terlalu gelap, tanpa menutup retak/tambalan di bawahnya.
    // K24_ (Fase 5): elips DIPERKECIL (rx 4-11 -> 3-8 m) + alpha
    // 0,05-0,11 -> 0,04-0,08 — cucian pucat besar ikut membentuk
    // "bercak" di koridor kamera.
    for (let i = 0; i < 46; i++) {
      const x = c.x0 + hash2(i, 511, 1) * (c.x1 - c.x0);
      const z = c.z + (hash2(i, 512, 1) - 0.5) * 9;
      const rx = (3 + hash2(i, 513, 1) * 5) * mpp;
      const rz = (2 + hash2(i, 514, 1) * 3) * mpp;
      ctx.fillStyle = `rgba(204,205,202,${0.04 + hash2(i, 515, 1) * 0.04})`; // K20_ sun-bleach pucat NETRAL (dulu 216,202,170 hangat-krem)
      ctx.beginPath();
      ctx.ellipse(px(x), pz(z), rx, rz, hash2(i, 516, 1) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- 2. HAPUS MARKA R7 DI KORIDOR (plane transparan y 0,06) ---------
// Plane R7_asphaltTexture (2,7 px/m) melukis garis kuning ganda
// (±0,35 m), dash putih (±2,75 m) dan zebra di SEMUA jalan. Di koridor,
// ketiganya diganti marka geometri K19 — kalau dibiarkan, garis tekstur
// yang blur akan mengintip di samping garis geometri yang tajam (efek
// garis ganda + halo kuning). destination-out: plane transparan, jadi
// yang terhapus tinggal menunjukkan ground di bawahnya.
export function K19_eraseR7Markings(g, px, py) {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  for (const c of K19_CORRIDORS) {
    // garis kuning ganda R7 (±0,35 m, lebar ~0,75 m di kanvas)
    g.fillRect(px(c.x0), py(c.z - 0.95), (c.x1 - c.x0) * (2048 / 768), 1.9 * (1792 / 672));
    // dash putih R7 (±2,75 m)
    for (const off of [-2.75, 2.75]) {
      g.fillRect(px(c.x0), py(c.z + off - 0.55), (c.x1 - c.x0) * (2048 / 768), 1.1 * (1792 / 672));
    }
    // K19c_ garis tepi R7 (±5,5 m): di sudut menunduk garis 2 px ini
    // melebar jadi pita pucat diagonal di kedua tepi jalan — sisa
    // "garis cahaya aneh" di crop chase. Diganti garis tepi geometri.
    for (const off of [-5.5, 5.5]) {
      g.fillRect(px(c.x0), py(c.z + off - 0.6), (c.x1 - c.x0) * (2048 / 768), 1.2 * (1792 / 672));
    }
    // zebra + dash jalan melintang di tiap persimpangan
    for (const a of c.crossings) {
      g.fillRect(px(a - 7), py(c.z - 6.5), 14 * (2048 / 768), 13 * (1792 / 672));
    }
  }
  g.restore();
}

// ---- 3. MARKA GEOMETRI (tajam di 2K, 0 draw call) --------------------
// Kotak tipis (tebal 0,06 m, puncak y 0,16) masuk solid soup yang sudah
// ada — di atas plane R7 (y 0,06) dan dressing K18 (puncak 0,12), jadi
// tidak pernah z-fight. Garis kuning ganda solid (bukan dash, sesuai
// referensi), dash putih 3 m tiap 12 m, zebra 5 bilah penuh selebar
// jalan di tiap persimpangan, + garis tepi geometri ±5,5 m (K19c),
// + 16 kotak dressing permukaan di koridor z=240 (K19b). ~155 kotak
// x 12 tris = ~1.860 tris.
export function K19_dressRoads(solid) {
  const Y = 0.13; // alas 0,10 — di atas marka R7 (0,06) + dressing K18 (0,12)
  // K24_ (Fase 5): cat marka DILEMAHKAN — putih #f7f3e0 -> #ddd5c0
  // (cat usang, bukan papan putih baru) dan kuning #e8c33c -> #d8b83a
  // (kurang jenuh). Marka yang terlalu putih + terlalu tebal di atas
  // aspal gelap inilah yang terbaca sebagai "balok" di shot cover.
  const yellow = '#d8b83a';
  const white = '#ddd5c0';
  for (const c of K19_CORRIDORS) {
    // garis kuning ganda: segmen antar persimpangan (jeda ±7 m),
    // dua garis di z ±0,35, lebar 0,18 m
    // K24_ (Fase 5): lebar 0,18 -> 0,12 m, offset ±0,35 -> ±0,30 —
    // pita kuning ganda yang terlalu lebar terbaca sebagai "balok"
    // kuning di sudut grazing.
    const bounds = [c.x0, ...c.crossings, c.x1];
    for (let s = 0; s < bounds.length - 1; s++) {
      const a = bounds[s] + (s === 0 ? 0 : 7);
      const b = bounds[s + 1] - (s === bounds.length - 2 ? 0 : 7);
      if (b - a < 4) continue;
      const cx = (a + b) / 2, len = b - a;
      for (const off of [-0.30, 0.30]) {
        solid.add(cx, Y, c.z + off, len, 0.06, 0.12, yellow);
      }
    }
    // dash putih di garis lajur (±3,0 m): 3 m tiap 12 m, jeda di
    // persimpangan (±8 m) supaya tidak menutup zebra
    // K24_ (Fase 5): lebar dash 0,15 -> 0,12 m.
    for (let x = c.x0; x <= c.x1; x += 12) {
      if (c.crossings.some((a) => Math.abs(x - a) < 8)) continue;
      for (const off of [-3.0, 3.0]) {
        solid.add(x, Y, c.z + off, 3, 0.06, 0.12, white);
      }
    }
    // K19c_ garis tepi geometri (±5,5 m): pengganti garis tepi R7 yang
    // dihapus — tepi jalan harus tetap terbaca, tapi tajam.
    // K24_ (Fase 5): lebar 0,15 -> 0,12 m — garis tepi putih yang
    // terlalu tebal terbaca sebagai "potongan" di sambungan jalan.
    for (const off of [-5.5, 5.5]) {
      for (let s = 0; s < bounds.length - 1; s++) {
        const a = bounds[s] + (s === 0 ? 0 : 7);
        const b = bounds[s + 1] - (s === bounds.length - 2 ? 0 : 7);
        if (b - a < 4) continue;
        solid.add((a + b) / 2, Y, c.z + off, b - a, 0.06, 0.12, white);
      }
    }
    // zebra: 5 bilah 0,6 m x 11 m, spasi 2,4 m, di tiap persimpangan
    // K24_ (Fase 5): 7 bilah 0,5 m, spasi 1,5 m — zebra nyata
    // berpalang rapat, bukan 5 papan terpisah dengan celah besar;
    // +18 kotak = +216 tris (batas Fase 5: <550.000).
    for (const a of c.crossings) {
      for (let k = -3; k <= 3; k++) {
        solid.add(a + k * 1.5, Y, c.z, 0.5, 0.06, 11, white);
      }
    }
  }
  // K19b_ dressing permukaan koridor z=240 (foreground chase/cover):
  // tambalan + tar snake + retak GEOMETRI di dekat kamera (x -180..-10)
  // — permukaan jalan butuh fitur skala meteran yang tajam, bukan hanya
  // speckle tekstur (temuan B: permukaan 30%). Posisi literal, dicek
  // terhadap mobil staged (hero 0, cruiser -30/-42, traffic
  // -55/-68/-95/-110), marka K19 di atas, dan dressing K16/K18 —
  // tidak ada yang bertumpuk sebidang (semua di y 0,10..0,16 yang sama
  // tapi footprint tidak bersentuhan; yang bersilangan hanya beda
  // tinggi dengan item K16/K18 di y 0,06..0,12). 16 kotak = ~192 tris.
  // K24_ (Fase 5): tambalan DITERANGKAN (#2e2f33 -> #3d4046) +
  // diputar sedikit (deterministik, +-0,11 rad) + DIPERKECIL
  // (3,0-3,4 -> 2,6-3,0 m) — tambalan 3x2 m hitam pekat tepat di
  // depan hero (x -14, z 238,5) terbaca sebagai lubang hitam di
  // shot cover; sekarang perbaikan jalan yang menyatu.
  const K19_patch = (x, z, w, d) => solid.add(x, Y, z, w, 0.06, d, '#3d4046', (hash2(Math.round(x * 10), Math.round(z * 10), 419) - 0.5) * 0.22);
  const K19_snake = (x, z, len) => solid.add(x, Y, z, len, 0.06, 0.35, '#0d0d0f');
  const K19_crack = (x, z, len, ry) => solid.add(x, Y, z, len, 0.06, 0.22, '#101012', ry);
  K19_patch(-14, 238.5, 2.6, 1.8);
  K19_patch(-38, 241.5, 2.8, 1.8);
  K19_patch(-80, 238.5, 2.6, 1.8);
  K19_patch(-120, 241.5, 3.0, 1.8);
  K19_patch(-160, 238.5, 2.6, 1.8);
  K19_snake(-24, 238.5, 6);
  K19_snake(-60, 241.5, 7);
  K19_snake(-100, 238.5, 6);
  K19_snake(-140, 241.5, 7);
  K19_snake(-180, 238.5, 6);
  K19_crack(-18, 242, 2.5, 0.5);
  K19_crack(-48, 238, 2.5, -0.4);
  K19_crack(-72, 242.5, 2.5, 0.7);
  K19_crack(-88, 241.5, 2.5, -0.6);
  K19_crack(-130, 238, 2.5, 0.4);
  K19_crack(-155, 242, 2.5, -0.5);
}

// ---- 4. TEKSTUR ASPAL BUTIR HALUS (tile 3 m, 170 px/m) --------------
// Satu plane Lambert transparan di atas grid kota (y 0,052 — di atas
// overlay K17 6 m dan K18 24 m, di bawah plane R7 0,06): speckle padat
// + retak mikro + agregat pucat. Inilah yang membuat aspal terbaca
// tajam di foreground 2K — butirnya 1-2 px di kanvas 512 px / 3 m,
// bukan blotch lembut 24 m. +1 draw call, +2 tris.
export function K19_fineAsphaltTexture() {
  const S = 512;
  const cv = K19_canvas(S, S);
  const ctx = cv.getContext('2d');
  const draw = mulberry32(19001);
  // K19b_ speckle 1-2 px SAJA tidak cukup (temuan B): di sudut menunduk
  // minifikasi mipmap (sudut ~5x) melenyapkan dot 0,6-1,2 cm. Yang
  // bertahan adalah fitur skala 10-30 cm kontras KUAT — bercak keras
  // 15-40 px (9-24 cm), retak tebal 2 px, agregat 3-5 px — jadi tile
  // ini sekarang didominasi fitur itu, speckle hanya pengisi.
  // speckle padat: butir gelap + terang 1-2 px, alpha dinaikkan
  for (let i = 0; i < 2600; i++) {
    const light = draw() < 0.45;
    ctx.fillStyle = light
      ? `rgba(198,210,228,${0.3 + draw() * 0.3})` // K23_ didinginkan lagi ke biru-abu (dulu 208,214,224)
      : `rgba(10,10,12,${0.3 + draw() * 0.32})`;
    ctx.fillRect(draw() * S, draw() * S, 1 + Math.floor(draw() * 2), 1 + Math.floor(draw() * 2));
  }
  // bercak keras skala 10-30 cm: elips tepi tegas (bukan gradient
  // lembut), gelap + pucat, alpha 0,35-0,55 — inilah butir yang terbaca
  // di foreground 2K setelah minifikasi
  for (let i = 0; i < 90; i++) {
    const x = draw() * S, y = draw() * S;
    const rx = 8 + draw() * 22, ry = 6 + draw() * 14;
    const pale = draw() < 0.42;
    ctx.fillStyle = pale
      ? `rgba(182,194,212,${0.32 + draw() * 0.22})` // K23_ didinginkan lagi (dulu 190,198,210)
      : `rgba(12,12,16,${0.34 + draw() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, draw() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // agregat pucat: batu 3-5 px, kontras kuat, memantulkan senja
  // K20_ alpha dinaikkan (0.35 -> 0.45) + didinginkan — ACES meredupkan
  // agregat, kontras harus dipertahankan.
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(182,194,212,${0.45 + draw() * 0.25})`; // K23_ didinginkan lagi (dulu 190,198,210)
    const s = 3 + Math.floor(draw() * 3);
    ctx.fillRect(draw() * S, draw() * S, s, s);
  }
  // retak tebal: polyline 2 px, alpha 0,65, panjang sampai ~60 px
  // (35 cm), dijaga di dalam tile (margin 20 px) supaya tidak ada
  // jahitan saat mengulang
  ctx.strokeStyle = 'rgba(12,12,14,0.65)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
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
  // blotch kecil lembut (bukan besar-kabur seperti K18): variasi nada
  // skala 1-2 m saja
  for (let i = 0; i < 26; i++) {
    const x = draw() * S, y = draw() * S;
    const r = 18 + draw() * 34;
    const pale = draw() < 0.4;
    const a = 0.06 + draw() * 0.06;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pale ? `rgba(182,194,212,${a})` : `rgba(12,12,16,${a})`); // K23_ didinginkan lagi (dulu 190,198,210)
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---- 5. PELEPAH PALEM MELENGKUNG (ganti bilah kotak) -----------------
// Pita (ribbon) 3 segmen, DoubleSide, 6 tris — LEBIH MURAH dari kotak
// (12 tris) tapi melengkung: naik sedikit dari pucuk, lalu menjuntai
// ke bawah di ujung, dan meruncing (lebar 0,62 -> 0,10). Pelepah tidak
// lagi terpancang lurus seperti papan. Geometri memanjang +X (seperti
// kotak lama yang di-translate 0,5), lebar di Z, lengkung di Y; rotasi
// yaw/pitch per instance tetap seperti sebelumnya.
export function K19_bentFrondGeometry() {
  // [x, y, halfWidth] per penampang: pangkal -> tengah -> ujung
  const sec = [
    [0.0, 0.00, 0.31],
    [1.1, 0.30, 0.275],
    [2.2, 0.14, 0.17],
    [3.2, -0.72, 0.05],
  ];
  const pos = [];
  const nor = [];
  const uv = [];
  for (const [x, y, hw] of sec) {
    pos.push(x, y, -hw, x, y, hw);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(x / 3.2, 0, x / 3.2, 1);
  }
  // 3 quad = 6 segitiga (indeks per penampang: 2 vert)
  const idx = [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
