// K18_ asphalt wear — Solmarina polish round #13 (Builder A).
// Ronde K17_ sudah melukis aus ke kanvas ground (170 bercak, 110 retak,
// 60 tar snake, 36 tambalan) + overlay butir 6 m — tapi di thumbnail
// semuanya hampir tak terlihat: alpha 0.05-0.21, garis 1-1.5 px di
// kanvas 5,3 px/m, dan tersebar ke seluruh kota sehingga jalan yang
// masuk frame kamera cuma kebagian 1-2 retak. Ronde ini menaikkan
// KONTRAS dan UKURAN, bukan jumlah titik: bercak 2-3x lebih besar dan
// 2x lebih gelap/pucat, retak 2,5-3 px dengan alpha 0.6, tar snake
// 3,5 px sampai 25 m, plus jaring alligator-cracking — dan semuanya
// dikonsentrasikan ke koridor kamera play (jalan z=-144, tempat mobil
// hero di detik ke-20 shot play) + jalan cover/chase z=240, di bawah
// marka jalan (dilukis sebelum lane furniture, jadi zebra/garis tengah
// tetap di atas).
// Koridor kamera play (diukur probe 13:41 WIB, ?shot=play seed 1):
// hero spawn (-72,0) lalu sim mengantarnya ke jalan z=-144, dan di
// detik ke-20 mobil di (89.6,-144.1) menghadap timur — kamera chase di
// belakangnya melihat aspal z=-144, x ~70..200. Jadi 72% cat koridor
// dijatuhkan di z=-144 (terberat x 40..220), sisanya di z=0 (kaki awal
// rute). Jalan cover z=240 tetap ditangani dressing geometri di bawah.
// Semua prosedural (canvas 2D + BoxSoup), 0 file gambar, 0 draw call
// baru untuk cat kanvas, +1 draw call untuk overlay kasar, dressing
// geometri masuk solid soup yang sudah ada. Deterministik (hash2 /
// mulberry32) — tidak ada Math.random.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, hash2, clamp } from './util.js';

function K18_canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function K18_texture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---- 1. CAT KANVAS: aus kontras tinggi ---------------------------------
// K18_paintAsphaltWear: pass kedua di atas K17_paintAsphaltWear, tetap
// di bawah lane furniture. Argumen sama dengan K17_ + causewayZ (jalan
// causeway z=24 dari GRID_MAX ke PIER bukan bagian roadLines).
export function K18_paintAsphaltWear(ctx, px, pz, mpp, roadLines, roadHalf, gridMin, gridMax, roadStep, causewayZ) {
  const roadPoint = (i, salt, lines) => {
    const ls = lines || roadLines;
    const line = ls[Math.floor(hash2(i, salt, 1) * ls.length) % ls.length];
    const along = gridMin + hash2(i, salt + 1, 1) * (gridMax - gridMin);
    const off = (hash2(i, salt + 2, 1) - 0.5) * 2 * (roadHalf - 0.5);
    return hash2(i, salt + 3, 1) < 0.5
      ? { x: along, z: line + off }
      : { x: line + off, z: along };
  };
  // Titik di koridor play: jalan z=-144 (E-W, tempat kamera play) +
  // jalan z=0 (kaki awal rute dari spawn).
  const corridorPoint = (i, salt) => {
    if (hash2(i, salt, 1) < 0.72) {
      // jalan z=-144, x 40..220 (terberat di frame kamera play)
      return {
        x: 40 + hash2(i, salt + 1, 1) * 180,
        z: -144 + (hash2(i, salt + 2, 1) - 0.5) * 2 * (roadHalf - 0.5),
      };
    }
    // jalan z=0, x -72 (spawn) .. 128
    return {
      x: -72 + hash2(i, salt + 1, 1) * 200,
      z: (hash2(i, salt + 2, 1) - 0.5) * 2 * (roadHalf - 0.5),
    };
  };

  // 150 bercak BESAR kontras tinggi: gelap (aus/basah) + pucat
  // (terbakar matahari). Radius 3-7 m — di kanvas 16-37 px, di layar
  // play ~1-2 m per bercak terbaca sebagai noda, bukan noise.
  // K24_ (Fase 5): DIPERKECIL (rx 3-15 -> 2-7 m, rz 2-9 -> 1,5-4,5 m)
  // + DIJINAKKAN (alpha gelap 0,14-0,32 -> 0,08-0,18; pucat
  // 0,10-0,24 -> 0,06-0,14) — bercak raksasa inilah "noda
  // hitam/cokelat" di shot chase; aus tetap ada, hanya tidak lagi
  // mendominasi jalan.
  for (let i = 0; i < 150; i++) {
    const p = i < 70 ? corridorPoint(i, 301) : roadPoint(i, 301);
    const pale = hash2(i, 302, 1) < 0.36;
    ctx.fillStyle = pale
      ? `rgba(196,198,202,${0.06 + hash2(i, 303, 1) * 0.08})` // K20_ didinginkan (dulu 208,202,186 krem)
      : `rgba(14,14,18,${0.08 + hash2(i, 304, 1) * 0.10})`;
    ctx.beginPath();
    ctx.ellipse(px(p.x), pz(p.z), (2 + hash2(i, 305, 1) * 5) * mpp, (1.5 + hash2(i, 306, 1) * 3) * mpp, hash2(i, 307, 1) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 90 retak TEBAL + panjang: garis 2,5 px (~0,5 m), alpha 0.6, 5-8
  // segmen sampai ~20 m, 45% bercabang — retak K17 (1,5 px, alpha
  // 0.42, max ~9 m) tenggelam di thumbnail; yang ini tidak.
  // K24_ (Fase 5): garis 2,5 -> 2 px, alpha 0,5-0,7 -> 0,32-0,45.
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const p = i < 42 ? corridorPoint(i, 311) : roadPoint(i, 311);
    ctx.strokeStyle = `rgba(10,10,13,${0.32 + hash2(i, 312, 1) * 0.13})`;
    ctx.lineWidth = 2;
    let cx = px(p.x), cz = pz(p.z);
    const pts = [[cx, cz]];
    ctx.beginPath(); ctx.moveTo(cx, cz);
    const segs = 5 + Math.floor(hash2(i, 313, 1) * 4);
    for (let k = 0; k < segs; k++) {
      cx += (hash2(i, 314 + k, 1) - 0.5) * 7 * mpp;
      cz += (hash2(i, 319 + k, 1) - 0.5) * 7 * mpp;
      pts.push([cx, cz]);
      ctx.lineTo(cx, cz);
    }
    ctx.stroke();
    if (hash2(i, 324, 1) < 0.45) {
      const [bx, bz] = pts[2 + Math.floor(hash2(i, 325, 1) * 3)];
      ctx.beginPath(); ctx.moveTo(bx, bz);
      let dx = bx, dz = bz;
      for (let k = 0; k < 3; k++) {
        dx += (hash2(i, 326 + k, 1) - 0.5) * 6 * mpp;
        dz += (hash2(i, 329 + k, 1) - 0.5) * 6 * mpp;
        ctx.lineTo(dx, dz);
      }
      ctx.stroke();
    }
  }
  // 50 tar snake: garis aspal cair 3,5 px, alpha 0.5, panjang 8-25 m
  // K24_ (Fase 5): garis 3,5 -> 2,5 px, alpha 0,42-0,58 -> 0,30-0,42.
  for (let i = 0; i < 50; i++) {
    const p = i < 24 ? corridorPoint(i, 331) : roadPoint(i, 331);
    ctx.strokeStyle = `rgba(8,8,10,${0.30 + hash2(i, 332, 1) * 0.12})`;
    ctx.lineWidth = 2.5;
    const horiz = hash2(i, 333, 1) < 0.5;
    const len = (8 + hash2(i, 334, 1) * 17) * mpp;
    const x0 = px(p.x), z0 = pz(p.z);
    const wob = (hash2(i, 335, 1) - 0.5) * 4 * mpp;
    ctx.beginPath();
    ctx.moveTo(x0, z0);
    if (horiz) ctx.quadraticCurveTo(x0 + len / 2, z0 + wob, x0 + len, z0 + (hash2(i, 336, 1) - 0.5) * 2 * mpp);
    else ctx.quadraticCurveTo(x0 + wob, z0 + len / 2, x0 + (hash2(i, 336, 1) - 0.5) * 2 * mpp, z0 + len);
    ctx.stroke();
  }
  // 30 tambalan: lebih besar (2,5-5 m) + lebih gelap + jahitan pucat
  // yang lebih tegas, supaya kotak tambalan terbaca sebagai perbaikan
  // jalan, bukan noda samar.
  // K24_ (Fase 5): DITERANGKAN (tone 22-40 -> 40-58, alpha 0,55 ->
  // 0,35) + jahitan pucat 0,16 -> 0,06 — kotak gelap bertepi terang
  // adalah sumber utama kesan "potongan kotak" di jalan.
  for (let i = 0; i < 30; i++) {
    const p = i < 14 ? corridorPoint(i, 341) : roadPoint(i, 341);
    const w = (2.5 + hash2(i, 342, 1) * 2.5) * mpp, d = (2 + hash2(i, 343, 1) * 1.5) * mpp;
    const tone = 40 + Math.floor(hash2(i, 344, 1) * 18);
    ctx.fillStyle = `rgba(${tone},${tone},${tone + 3},0.35)`;
    ctx.fillRect(px(p.x) - w / 2, pz(p.z) - d / 2, w, d);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px(p.x) - w / 2, pz(p.z) - d / 2, w, d);
  }
  // 24 noda oli: inti lebih gelap (0.6) + kilau tipis di tepi
  // K24_ (Fase 5): inti 0,62 -> 0,50.
  for (let i = 0; i < 24; i++) {
    const p = i < 12 ? corridorPoint(i, 351) : roadPoint(i, 351);
    const r = (0.9 + hash2(i, 352, 1) * 1.5) * mpp;
    const grad = ctx.createRadialGradient(px(p.x), pz(p.z), 0, px(p.x), pz(p.z), r);
    grad.addColorStop(0, 'rgba(6,6,10,0.50)');
    grad.addColorStop(0.6, 'rgba(18,14,28,0.34)');
    grad.addColorStop(1, 'rgba(12,12,16,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), r, 0, Math.PI * 2); ctx.fill();
  }
  // 26 gugus alligator-cracking: jaring retak pendek yang saling
  // bersilangan di atas cucian gelap 2-3,5 m — tanda klasik aspal
  // lelah yang terbaca dari jauh sebagai tekstur, bukan garis.
  // K24_ (Fase 5): cucian 0,14-0,24 -> 0,09-0,15; retak 0,55 -> 0,38.
  for (let i = 0; i < 26; i++) {
    const p = i < 12 ? corridorPoint(i, 361) : roadPoint(i, 361);
    const cx = px(p.x), cz = pz(p.z);
    const r = (2 + hash2(i, 362, 1) * 1.5) * mpp;
    ctx.fillStyle = `rgba(12,12,15,${0.09 + hash2(i, 363, 1) * 0.06})`;
    ctx.beginPath(); ctx.ellipse(cx, cz, r, r * 0.7, hash2(i, 364, 1) * Math.PI, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(10,10,13,0.38)';
    ctx.lineWidth = 2;
    const seeds = [];
    for (let s = 0; s < 7; s++) {
      seeds.push([cx + (hash2(i, 365 + s, 1) - 0.5) * 2 * r, cz + (hash2(i, 372 + s, 1) - 0.5) * 1.4 * r]);
    }
    for (let s = 0; s < seeds.length; s++) {
      for (let t = s + 1; t < seeds.length; t++) {
        const d = Math.hypot(seeds[s][0] - seeds[t][0], seeds[s][1] - seeds[t][1]);
        if (d < r * 0.9) {
          ctx.beginPath(); ctx.moveTo(seeds[s][0], seeds[s][1]);
          ctx.lineTo((seeds[s][0] + seeds[t][0]) / 2 + (hash2(i, 380 + s * 7 + t, 1) - 0.5) * 6, (seeds[s][1] + seeds[t][1]) / 2 + (hash2(i, 387 + s * 7 + t, 1) - 0.5) * 6);
          ctx.lineTo(seeds[t][0], seeds[t][1]); ctx.stroke();
        }
      }
    }
  }
  // Jejak roda putus-putus: band aus di jalur ban (+/-1,8 m dari
  // garis tengah) yang terpotong-potong — aus nyata tidak berupa
  // garis kontinu. Digambar per jalan, segmen 2-6 m, jeda 1-4 m.
  // K24_ (Fase 5): alpha 0,26 -> 0,18.
  ctx.fillStyle = 'rgba(16,16,20,0.18)';
  for (const v of roadLines) {
    for (const off of [-1.8, 1.8]) {
      let u = gridMin;
      let k = 0;
      while (u < gridMax) {
        const segLen = 2 + hash2(v + k, 391, 1) * 4;
        const gap = 1 + hash2(v + k, 392, 1) * 3;
        ctx.fillRect(px(u), pz(v + off - 0.6), segLen * mpp, 1.2 * mpp);
        ctx.fillRect(px(v + off - 0.6), pz(u), 1.2 * mpp, segLen * mpp);
        u += segLen + gap;
        k++;
      }
    }
  }
  // ---- trotoar: nat lebih tegas + garis curb pucat ----
  // K17_ sudah melukis pelat 2 m + nat (alpha 0.22); di sudut play
  // trotoar tetap terbaca sebagai beton polos. K18_ menegaskan nat
  // (0.34) dan menambah garis curb pucat di tepi jalan (0.22) supaya
  // batas jalan/trotoar terbaca di thumbnail.
  const slab = 2 * mpp, band = 1.5 * mpp;
  for (let bx = gridMin; bx < gridMax; bx += roadStep) {
    for (let bz = gridMin; bz < gridMax; bz += roadStep) {
      if (bz >= 240) continue; // BEACH_Z: pantai tidak punya trotoar
      if (bx === -96 && bz === -120) continue; // plaza market
      if (bx === -216 && bz === 120) continue; // stadion
      const x0 = px(bx + roadHalf), z0 = pz(bz + roadHalf);
      const w = (roadStep - 2 * roadHalf) * mpp, d = (roadStep - 2 * roadHalf) * mpp;
      // garis curb pucat di keempat tepi dalam blok
      // K24_ (Fase 5): curb 0,22 -> 0,12 — garis terang di tepi jalan
      // ikut membentuk kesan "potongan kotak" di sambungan jalan.
      ctx.strokeStyle = 'rgba(235,230,214,0.12)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, z0, w, d);
      // nat pelat: garis gelap tiap 2 m di keempat sabuk
      // K24_ (Fase 5): nat 0,34 -> 0,20, garis 1,5 -> 1 px — nat
      // trotoar yang terlalu tegas adalah sumber "pola kotak-kotak"
      // di trotoar foreground shot play.
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      ctx.lineWidth = 1;
      const strips = [
        { x: x0, y: z0, ww: w, hh: band, horiz: true },
        { x: x0, y: z0 + d - band, ww: w, hh: band, horiz: true },
        { x: x0, y: z0, ww: band, hh: d, horiz: false },
        { x: x0 + w - band, y: z0, ww: band, hh: d, horiz: false },
      ];
      for (const s of strips) {
        const n = Math.floor((s.horiz ? s.ww : s.hh) / slab);
        for (let k = 0; k <= n; k++) {
          ctx.beginPath();
          if (s.horiz) { ctx.moveTo(s.x + k * slab, s.y); ctx.lineTo(s.x + k * slab, s.y + s.hh); }
          else { ctx.moveTo(s.x, s.y + k * slab); ctx.lineTo(s.x + s.ww, s.y + k * slab); }
          ctx.stroke();
        }
      }
    }
  }
}

// ---- 2. OVERLAY KASAR ----------------------------------------------------
// K18_asphaltCoarseTexture: 512 px tile, ~24 m per tile — satu skala di
// atas overlay butir K17_ (6 m). Bercak besar lembut (gelap + pucat,
// alpha sampai 0.28) + speckle tegas + retak pendek yang dijaga tetap
// di dalam tile (margin 30 px) supaya tidak ada jahitan saat mengulang.
// Dipakai sebagai satu plane Lambert transparan kedua di atas grid kota
// (y 0.045, di bawah marka R7 di y 0.06): +1 draw call, +2 tris.
export function K18_asphaltCoarseTexture() {
  const S = 512;
  const cv = K18_canvas(S, S);
  const ctx = cv.getContext('2d');
  const draw = mulberry32(18001);
  // bercak besar: radial gradient lembut, gelap + pucat
  for (let i = 0; i < 80; i++) {
    const x = draw() * S, y = draw() * S;
    const r = 30 + draw() * 80;
    const pale = draw() < 0.38;
    const a = pale ? 0.08 + draw() * 0.12 : 0.10 + draw() * 0.18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pale ? `rgba(182,194,212,${a})` : `rgba(12,12,16,${a})`); // K23_ didinginkan lagi (dulu 190,198,210)
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // speckle tegas: butir gelap + terang 1-2 px
  for (let i = 0; i < 520; i++) {
    const light = draw() < 0.42;
    ctx.fillStyle = light
      ? `rgba(198,210,228,${0.15 + draw() * 0.2})` // K23_ didinginkan lagi (dulu 208,214,224)
      : `rgba(10,10,12,${0.15 + draw() * 0.22})`;
    ctx.fillRect(draw() * S, draw() * S, 1 + Math.floor(draw() * 2), 1 + Math.floor(draw() * 2));
  }
  // retak pendek di dalam tile (margin 30 px dari tepi)
  ctx.strokeStyle = 'rgba(10,10,13,0.4)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
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
  return K18_texture(cv);
}

// ---- 3. DRESSING GEOMETRI -------------------------------------------------
// K18_dressRoads(solid): kotak-kotak tipis (0,06 m, puncak y 0,12 — sama
// seperti dressing K16_) yang masuk ke solid soup yang sudah ada: 0 draw
// call baru, ~72 kotak x 12 tris = ~864 tris. Isinya yang tidak bisa
// dibaca dari cat kanvas di sudut grazing: tar snake panjang, tambalan
// dengan tepi tegas, manhole, noda oli pekat, dan gugus retak sebagai
// kotak-kotak tipis bergerigi. Semua di jalur ban / tepi jalur (offset
// 2-5 m dari garis tengah) — TIDAK pernah menutup marka tengah, zebra,
// atau garis tepi; dan tidak menabrak mobil staged / hero.
// Koridor play: jalan z=-144 (diukur probe: mobil shot play di
// (89.6,-144) menghadap timur) + causeway z=24.
// Jalan cover: z=240, koordinat literal yang dicek terhadap kotak K16_.
export function K18_dressRoads(solid) {
  const Y = 0.09; // kotak 0,06 m: alas 0,06, puncak 0,12
  const crack = (x, z, len, ry) => solid.add(x, Y, z, len, 0.06, 0.22, '#101012', ry);
  const snake = (x, z, len, ry) => solid.add(x, Y, z, len, 0.06, 0.35, '#0d0d0f', ry);
  // K24_ (Fase 5): tambalan DITERANGKAN (#2e2f33 -> #3d4046) + diputar
  // sedikit (deterministik dari posisi, +-0,11 rad) supaya tidak lagi
  // sejajar sempurna dengan grid jalan — kotak gelap yang sejajar
  // grid inilah yang terbaca sebagai "potongan kotak" di foreground.
  const patch = (x, z, w, d, tone) => solid.add(x, Y, z, w, 0.06, d, tone || '#3d4046', (hash2(Math.round(x * 10), Math.round(z * 10), 417) - 0.5) * 0.22);
  // K24_ (Fase 5): noda oli DITERANGKAN (#14161a -> #26292e) + diputar
  // sedikit (deterministik, +-0,11 rad) — kotak hampir-hitam 2x1,2 m
  // di koridor cover (-14, 244,8, tepat di depan hero) terbaca sebagai
  // lubang hitam di shot cover; noda oli nyata gelap, bukan hitam pekat.
  const oil = (x, z, w, d) => solid.add(x, Y, z, w, 0.06, d, '#26292e', (hash2(Math.round(x * 10), Math.round(z * 10), 418) - 0.5) * 0.22);

  // --- koridor play: jalan z=-144, x 30 .. 230 ---
  // Mobil hero di shot play (detik ke-20) ada di (89.6,-144) menghadap
  // timur; kamera chase melihat aspal x ~70..200. Spot tiap ~16 m
  // (hash jitter +-4 m), dilewati kalau <8 m dari persimpangan (garis
  // jalan tiap 48 m) supaya tidak menutup zebra.
  for (let k = 0; k < 13; k++) {
    const x = 30 + k * 16 + (hash2(k, 401, 1) - 0.5) * 8;
    if (x > 230) break;
    const nearestX = Math.round(x / 48) * 48;
    if (Math.abs(x - nearestX) < 8) continue;
    const lane = hash2(k, 402, 1) < 0.5 ? -1 : 1;
    const off = lane * (2.2 + hash2(k, 403, 1) * 2.6);
    const z = -144 + off;
    const kind = hash2(k, 404, 1);
    if (kind < 0.34) {
      // tambalan + satu retak pendek di sampingnya
      patch(x, z, 2.6 + hash2(k, 405, 1) * 1.4, 1.7 + hash2(k, 406, 1) * 0.7);
      crack(x + 3.4, z + (hash2(k, 407, 1) - 0.5) * 1.2, 2.2, (hash2(k, 408, 1) - 0.5) * 0.9);
    } else if (kind < 0.67) {
      // tar snake panjang sejajar jalan + noda oli
      snake(x, z, 5 + hash2(k, 409, 1) * 4, (hash2(k, 410, 1) - 0.5) * 0.12);
      oil(x - 4.5, -off * 0.7, 1.6, 1.1);
    } else {
      // gugus retak: 3 kotak tipis bergerigi
      crack(x, z, 2.6, 0.3 + hash2(k, 411, 1) * 0.5);
      crack(x + 1.8, z + 0.7, 2.0, -0.4 - hash2(k, 412, 1) * 0.5);
      crack(x - 1.6, z - 0.6, 1.8, 0.9 + hash2(k, 413, 1) * 0.4);
    }
  }
  // --- causeway z=24, x 300 .. 380 (jalan ke pier) ---
  for (let k = 0; k < 5; k++) {
    const x = 302 + k * 19 + (hash2(k, 421, 1) - 0.5) * 6;
    const z = 24 + (hash2(k, 422, 1) < 0.5 ? -1 : 1) * (2.4 + hash2(k, 423, 1) * 2.2);
    if (hash2(k, 424, 1) < 0.5) snake(x, z, 6 + hash2(k, 425, 1) * 3, (hash2(k, 426, 1) - 0.5) * 0.1);
    else patch(x, z, 3.0, 2.0);
  }
  // --- jalan cover z=240: literal, dicek terhadap kotak K16_ ---
  // (zebra x -11,6..-8,4; dash x -24/-18/4,5 di z=240; manhole
  // (-16,243,5); oli (-6,237,5) + (2,243,8); ban (-14,238,2/241,8);
  // curb z 246,1 / 234; hero (0,240); cruiser (-30,237)/(-42,243,5);
  // traffic -68/-88/-104/-120.)
  snake(-26, 236.5, 8, 0.04);
  crack(-34, 242, 2.6, 0.5);
  crack(-32.4, 242.7, 2.0, -0.6);
  crack(-35.6, 241.3, 1.8, 1.1);
  patch(-52, 238.5, 3.2, 2.0);
  oil(-58, 243, 1.8, 1.2);
  snake(-70, 239, 7, -0.06);
  patch(-96, 238.5, 3.6, 2.2, '#33343a');
  crack(-100, 243, 2.4, 0.4);
  crack(-98.4, 243.6, 1.9, -0.7);
  solid.add(-120, Y, 237.5, 1.3, 0.06, 1.3, '#33363d'); // manhole #2 (K24_: diterangkan, sama seperti manhole K16)
  snake(-40, 236.8, 6, 0.05);
  oil(-14, 244.8, 2.0, 1.2);
  crack(-8, 245.2, 2.2, 0.3);
  crack(-6.2, 245.4, 1.7, -0.5);
}
