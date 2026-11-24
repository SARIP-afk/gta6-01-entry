// K25_ Fase 6 (ronde #20) — HERO VISUAL UPGRADE + Fase 6A REFINEMENT
// (ronde #20b, 23 Nov 2026, verdict syarif 12:14 WIB: HERO BELUM LAYAK).
// Scope keras: HERO ON FOOT saja. NPC + kendaraan TIDAK disentuh di file
// ini. Semua helper deterministik (hash sin, tanpa Math.random) seperti
// K17-K24. Kaos HITAM + cargo + sneakers putih (poster target Fase 6).
//
// Audit Fase 6A (dari checkpoint K25, lihat verify-shots-phase6/):
//  1. WAJAH masih balok: kepala kubus + fitur datar menempel. Perbaikan:
//     tengkorak + rahang + dagu terpisah (dahi lebih lebar dari dagu),
//     mata sklera+ pupil, alis miring, hidung bridge + ujung, bibir
//     atas/bawah, telinga + inner, pipi shading, rambut poni 3 panel +
//     side panel + sideburn (bukan lagi topi kotak).
//  2. TANGAN mitten diganti telapak + 4 jari box + ibu jari; jam tangan
//     hitam di pergelangan kiri (poster); transisi bahu: shoulder cap +
//     sleeve hem; siku + pergelangan: lengan bawah meruncing ke wrist.
//  3. CARGO: lipatan vertikal TERBACA di depan paha (ridge terang),
//     knee crease, saku belakang, kancing flap logam, belt loop,
//     cuff pergelangan kaki; grafis punggung BESAR huruf gothic putih
//     (canvas texture "Boing / Palak", ikut render HASIL AKHIR poster).
//  4. KAKI + SEPATU: paha/betis terpisah (lutut = pivot betis), sepatu
//     ikut betis; sneakers + lidah + 3 tali + heel tab.
//  5. ANIMASI — BUG K25 DIPERBAIKI: ayun lengan/kaki K25 pakai
//     rotation.x, padahal model menghadap +x lokal — terbukti lewat uji
//     three.js node (/tmp/axistest.mjs): rotation.x mengayun kaki ke
//     SAMPING (komponen forward 0.000, lateral -0.082), bukan maju.
//     Sumbu ayun yang benar adalah rotation.z (kaki maju komponen
//     forward 0.192, lateral 0 dari ayun). Pivot juga diperbaiki: dulu
//     mesh berputar di tengah badan (y 0,4 / 1,27); kini grup lengan di
//     bahu (y 1,42), grup kaki di pinggul (y 0,80), betis di lutut —
//     plus tekuk lutut (calf) di gfx.js. Torso taper ikut dibalik:
//     K25 (0.72, 0.88) membuat bahu 37 cm < pinggang 46 cm (pear);
//     kini (1.00, 0.85): bahu 52 cm > pinggang 44 cm.
// Anggaran Hero 6A: ~+66 mesh box (12 tris) + plane grafis (2 tris,
// mengganti box 12) = ~+780 tris, +~66 draw call. Total tetap jauh di
// bawah 550.000 tris / 400 calls.

import * as THREE from '../vendor/three.module.min.js';
import { K23_taperBox } from './K23_phase4.js';
import { K24_contactShadowTexture } from './K24_phase5.js';

const K25_h = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

// Tekstur kain prosedural: dasar + anyaman halus + lipatan vertikal
// lembut (0 tris — hanya map pada material Lambert yang sudah ada).
function K25_fabricTexture(base, foldAlpha) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  // anyaman: garis 1 px berselang, alpha sangat rendah
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fillRect(x, 0, 1, 128);
  }
  // lipatan kain: 5 pita vertikal lembut, posisi deterministik
  for (let f = 0; f < 5; f++) {
    const cx = 8 + K25_h(f * 3 + 1) * 112;
    const w = 6 + K25_h(f * 3 + 2) * 10;
    const dark = K25_h(f * 3 + 3) > 0.5;
    const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
    const col = dark ? '0,0,0' : '255,255,255';
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(0.5, `rgba(${col},${foldAlpha})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - w, 0, w * 2, 128);
  }
  // noda / variasi tonal halus
  for (let b = 0; b < 8; b++) {
    const bx = K25_h(b * 5 + 1) * 128, by = K25_h(b * 5 + 2) * 128;
    const br = 10 + K25_h(b * 5 + 3) * 22;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, `rgba(0,0,0,${(0.03 + K25_h(b * 5 + 4) * 0.04).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Grafis punggung: huruf display putih besar "Boing / Palak" (ikut
// render HASIL AKHIR poster) + flourish, di atas transparan. 0 tris
// tambahan (plane, bukan box).
function K25_backGraphicTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4efe4';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 4;
  ctx.font = 'bold 78px Georgia, "Times New Roman", serif';
  ctx.strokeText('Boing', 128, 108);
  ctx.fillText('Boing', 128, 108);
  ctx.font = 'bold 62px Georgia, "Times New Roman", serif';
  ctx.strokeText('Palak', 128, 182);
  ctx.fillText('Palak', 128, 182);
  // flourish: garis ganda + titik di bawah teks
  ctx.strokeStyle = '#f4efe4';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(48, 208); ctx.lineTo(208, 208); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(78, 220); ctx.lineTo(178, 220); ctx.stroke();
  ctx.fillStyle = '#f4efe4';
  ctx.beginPath(); ctx.arc(128, 236, 5, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Membangun grup hero jalan kaki. Sumbu lokal: +x = depan (arah hadap),
// z = lateral (kiri/kanan), y = atas. Tinggi total ~1,86 m.
// Mengembalikan { group, armL, armR, legL, legR, foreL, foreR, calfL,
// calfR, torso, head } — grup (bukan mesh) supaya pivot ayun di bahu /
// pinggul / lutut / siku, bukan di tengah badan.
export function K25_buildHeroWalk() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
  const skinDark = new THREE.MeshLambertMaterial({ color: 0xc98f4e });
  const hairM = new THREE.MeshLambertMaterial({ color: 0x14100c });
  const darkM = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const tee = new THREE.MeshLambertMaterial({
    color: 0xffffff, map: K25_fabricTexture('#17181c', 0.10),
  });
  const pantsM = new THREE.MeshLambertMaterial({
    color: 0xffffff, map: K25_fabricTexture('#33363d', 0.08),
  });
  const pantsDarkM = new THREE.MeshLambertMaterial({
    color: 0xffffff, map: K25_fabricTexture('#26282e', 0.08),
  });
  const foldLightM = new THREE.MeshLambertMaterial({ color: 0x4a4f5a });
  const shoeM = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  const soleM = new THREE.MeshLambertMaterial({ color: 0x1e2024 });
  const laceM = new THREE.MeshLambertMaterial({ color: 0xd8d8d2 });
  const metalM = new THREE.MeshLambertMaterial({ color: 0xc8ccd4 });
  const logoM = new THREE.MeshLambertMaterial({ color: 0xd8d2c4 });
  const scleraM = new THREE.MeshLambertMaterial({ color: 0xf5f0e6 });
  const lipM = new THREE.MeshLambertMaterial({ color: 0x8a4636 });
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x14100c });

  const add = (parent, w, h, d, mat, x, y, z, geo) => {
    const m = new THREE.Mesh(geo || new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // ---- kaki: paha (grup pinggul) + betis (grup lutut) --------------
  // Pivot kaki di pinggul (y 0,80), betis di lutut (y 0,40) — sepatu
  // anak betis, jadi ikut tekuk lutut dan tidak menembus tanah.
  const mkLeg = (zSide) => {
    const leg = new THREE.Group();
    leg.position.set(0, 0.8, zSide);
    g.add(leg);
    // paha: meruncing ke lutut, bahu paha lebih lebar dari lutut
    add(leg, 0.19, 0.40, 0.19, pantsM, 0, -0.20, 0,
      K23_taperBox(0.19, 0.40, 0.19, 1.12, 0.92));
    // saku cargo di sisi luar paha + flap + kancing logam
    const oz = zSide > 0 ? 0.115 : -0.115;
    const os = zSide > 0 ? 1 : -1;
    add(leg, 0.16, 0.20, 0.05, pantsM, 0, -0.12, oz);
    add(leg, 0.17, 0.06, 0.055, pantsM, 0, -0.01, oz);
    add(leg, 0.03, 0.03, 0.02, metalM, 0, -0.03, oz + os * 0.028);
    // saku belakang (dada kain lebih gelap, di belakang paha)
    add(leg, 0.03, 0.15, 0.13, pantsDarkM, -0.10, -0.14, 0);
    // lipatan kain TERBACA: 2 ridge vertikal terang di depan paha
    for (const fz of [-0.05, 0.05]) {
      add(leg, 0.02, 0.30, 0.025, foldLightM, 0.10, -0.20, fz);
    }
    // knee crease: garis gelap melintang di depan lutut
    add(leg, 0.02, 0.035, 0.16, darkM, 0.10, -0.40, 0);
    // betis: grup di lutut, meruncing ke pergelangan kaki
    const calf = new THREE.Group();
    calf.position.set(0, -0.40, 0);
    leg.add(calf);
    add(calf, 0.16, 0.38, 0.16, pantsM, 0, -0.19, 0,
      K23_taperBox(0.16, 0.38, 0.16, 0.95, 0.78));
    // tempurung lutut (depan) + cuff pergelangan kaki
    add(calf, 0.03, 0.08, 0.12, pantsM, 0.085, -0.02, 0);
    add(calf, 0.18, 0.05, 0.18, pantsDarkM, 0, -0.36, 0);
    // sepatu: sneakers putih + sol gelap + ujung + lidah + tali + heel
    add(calf, 0.26, 0.10, 0.20, shoeM, 0.02, -0.34, 0);
    add(calf, 0.27, 0.045, 0.21, soleM, 0.02, -0.378, 0);
    add(calf, 0.06, 0.07, 0.20, shoeM, 0.15, -0.345, 0);
    add(calf, 0.03, 0.08, 0.16, darkM, -0.115, -0.32, 0);
    add(calf, 0.08, 0.05, 0.12, shoeM, 0.08, -0.27, 0);
    for (let l = 0; l < 3; l++) {
      add(calf, 0.025, 0.015, 0.13, laceM, 0.05 + l * 0.035, -0.265, 0);
    }
    return { leg, calf };
  };
  const legL = mkLeg(0.11);
  const legR = mkLeg(-0.11);

  // ---- torso: kaos hitam, bahu 0,52 > pinggang 0,44 -----------------
  // K25a: taper (0.72, 0.88) terbalik (bahu 37 < pinggang 46) — kini
  // (1.00, 0.85): bahu penuh 0,52, pinggang 0,44.
  const torso = add(g, 0.32, 0.62, 0.52, tee, 0, 1.11, 0,
    K23_taperBox(0.32, 0.62, 0.52, 1.00, 0.85));
  // sabuk + gesper logam + belt loop (depan 2, belakang 1)
  add(g, 0.34, 0.09, 0.54, darkM, 0, 0.84, 0);
  add(g, 0.02, 0.06, 0.10, metalM, 0.18, 0.84, 0);
  for (const lz of [0.15, -0.15]) add(g, 0.02, 0.10, 0.04, darkM, 0.18, 0.84, lz);
  add(g, 0.02, 0.10, 0.04, darkM, -0.18, 0.84, 0);
  // logo dada kecil (depan)
  add(g, 0.02, 0.09, 0.14, logoM, 0.17, 1.22, 0);
  // grafis punggung BESAR (plane + canvas gothic, bukan lagi patch
  // polos): menghadap -x (belakang), y 1,02..1,36
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshLambertMaterial({
      map: K25_backGraphicTexture(), transparent: true,
    }),
  );
  back.position.set(-0.167, 1.19, 0);
  back.rotation.y = -Math.PI / 2;
  g.add(back);
  // kerah: pita gelap di leher
  add(g, 0.22, 0.05, 0.36, darkM, 0, 1.43, 0);

  // ---- leher + kepala + wajah ---------------------------------------
  // Tengkorak (dahi lebar) + rahang (lebih sempit) + dagu — kepala
  // tidak lagi satu balok; dahi > pipi > dagu.
  add(g, 0.10, 0.14, 0.10, skin, 0, 1.47, 0);
  const head = add(g, 0.26, 0.28, 0.26, skin, 0, 1.58, 0,
    K23_taperBox(0.26, 0.28, 0.26, 0.92, 0.68));
  add(g, 0.20, 0.13, 0.20, skin, 0.01, 1.455, 0,
    K23_taperBox(0.20, 0.13, 0.20, 0.95, 0.72));
  add(g, 0.12, 0.05, 0.11, skin, 0.05, 1.415, 0);
  // pipi: shading halus di sisi wajah
  for (const zSide of [0.128, -0.128]) {
    add(g, 0.08, 0.07, 0.015, skinDark, 0.03, 1.55, zSide);
  }
  // mata: sklera putih + pupil gelap; alis miring (ujung dalam turun)
  for (const zSide of [0.06, -0.06]) {
    add(g, 0.015, 0.045, 0.055, scleraM, 0.132, 1.61, zSide);
    add(g, 0.018, 0.03, 0.03, eyeM, 0.143, 1.61, zSide);
    const brow = add(g, 0.015, 0.018, 0.06, hairM, 0.135, 1.645, zSide);
    brow.rotation.z = zSide > 0 ? -0.18 : 0.18;
  }
  // hidung: bridge + ujung
  add(g, 0.03, 0.09, 0.04, skinDark, 0.14, 1.575, 0);
  add(g, 0.045, 0.04, 0.06, skin, 0.15, 1.53, 0);
  // mulut: bibir atas + bibir bawah
  add(g, 0.015, 0.014, 0.07, lipM, 0.115, 1.50, 0);
  add(g, 0.015, 0.018, 0.055, skinDark, 0.115, 1.482, 0);
  // telinga: lebih kecil + inner
  for (const zSide of [0.135, -0.135]) {
    add(g, 0.03, 0.07, 0.025, skin, 0, 1.58, zSide);
    add(g, 0.015, 0.04, 0.012, skinDark, -0.005, 1.58,
      zSide + (zSide > 0 ? 0.008 : -0.008));
  }
  // rambut: topi meruncing + poni 3 panel + panel samping + panel
  // belakang panjang + sideburn di depan telinga (bukan lagi kubus)
  add(g, 0.28, 0.12, 0.28, hairM, 0, 1.75, 0,
    K23_taperBox(0.28, 0.12, 0.28, 0.85, 1.0));
  for (let f = 0; f < 3; f++) {
    add(g, 0.14, 0.07, 0.085, hairM, 0.09, f === 1 ? 1.685 : 1.70, -0.085 + f * 0.085);
  }
  for (const zSide of [0.125, -0.125]) {
    add(g, 0.10, 0.14, 0.05, hairM, -0.02, 1.66, zSide);
    add(g, 0.04, 0.10, 0.03, hairM, 0.10, 1.56, zSide);
  }
  add(g, 0.12, 0.26, 0.26, hairM, -0.09, 1.62, 0);

  // ---- lengan: grup bahu + lengan bawah (grup siku) + tangan --------
  // Pivot lengan di bahu (y 1,42), lengan bawah di siku — siku menekuk
  // mengikuti ayun, tangan bukan lagi mitten.
  const mkArm = (zSide) => {
    const arm = new THREE.Group();
    arm.position.set(0, 1.42, zSide);
    g.add(arm);
    // shoulder cap (deltoid, kaos) + lengan atas + sleeve hem
    add(arm, 0.15, 0.12, 0.15, tee, 0, -0.03, 0,
      K23_taperBox(0.15, 0.12, 0.15, 0.9, 1.1));
    add(arm, 0.13, 0.28, 0.13, tee, 0, -0.16, 0);
    add(arm, 0.14, 0.04, 0.14, darkM, 0, -0.29, 0);
    // lengan bawah: grup di siku, meruncing ke pergelangan
    const fore = new THREE.Group();
    fore.position.set(0, -0.30, 0);
    arm.add(fore);
    add(fore, 0.12, 0.30, 0.12, skin, 0, -0.15, 0,
      K23_taperBox(0.12, 0.30, 0.12, 1.05, 0.80));
    // jam tangan hitam di pergelangan KIRI (zSide > 0), poster panel 1
    // K25c (hand refinement): muka jam pindah ke sisi LUAR pergelangan
    // (z+) + bezel metal + dial gelap — dari samping terbaca sebagai jam.
    const outer = zSide > 0 ? 1 : -1;
    if (zSide > 0) {
      add(fore, 0.13, 0.035, 0.13, darkM, 0, -0.27, 0);
      add(fore, 0.05, 0.04, 0.012, metalM, 0, -0.27, outer * 0.068);
      add(fore, 0.04, 0.03, 0.012, darkM, 0, -0.27, outer * 0.074);
    }
    // tangan (K25c hand refinement): telapak taper + thenar, jari 2
    // segmen + curl + splay + celah 10 mm, ibu jari 2 segmen di sisi
    // LUAR telapak ~45°. Telapak menghadap +x (depan); jari tersusun
    // sepanjang z; ibu jari kiri yang benar ada di sisi luar (+z).
    const hand = new THREE.Group();
    hand.position.set(0, -0.31, 0);
    fore.add(hand);
    // telapak: lebar di buku jari, menyempit ke pergelangan
    add(hand, 0.10, 0.11, 0.09, skin, 0, -0.05, 0,
      K23_taperBox(0.10, 0.11, 0.09, 0.82, 1.06));
    // thenar (gundukan ibu jari) di sisi luar telapak
    add(hand, 0.03, 0.05, 0.035, skin, 0.02, -0.045, outer * 0.032);
    // jari: panjang total per jari (tengah terpanjang, kelingking
    // terpendek); kiri: kelingking di z-, telunjuk di z+ (dekat ibu
    // jari); kanan: cermin. Proksimal 60% + distal 40% (skinDark supaya
    // sendi terbaca, 0 tris tambahan).
    const fingerLen = zSide > 0
      ? [0.075, 0.10, 0.105, 0.095]
      : [0.095, 0.105, 0.10, 0.075];
    for (let f = 0; f < 4; f++) {
      const total = fingerLen[f];
      const prox = total * 0.6, dist = total * 0.4;
      const fz = -0.042 + f * 0.028;
      const finger = new THREE.Group();
      finger.position.set(0.005, -0.10, fz);
      // splay: ujung jari mengembang menjauhi jari tengah
      finger.rotation.x = -fz * 1.5;
      hand.add(finger);
      add(finger, 0.022, prox, 0.018, skin, 0, -prox / 2, 0);
      const distal = new THREE.Group();
      distal.position.set(0, -prox, 0);
      // curl: ujung jari menekuk ke depan (+x, arah telapak) ~0,3 rad
      distal.rotation.z = 0.3;
      finger.add(distal);
      add(distal, 0.02, dist, 0.016, skinDark, 0, -dist / 2, 0,
        K23_taperBox(0.02, dist, 0.016, 1.0, 0.75));
    }
    // ibu jari: 2 segmen, basis di sisi LUAR telapak, sudut ~45° ke
    // depan-luar (rotation.z +0,8 = condong +x; rotation.x =
    // -outer*0,5 = mengembang ke sisi luar).
    const thumb = new THREE.Group();
    thumb.position.set(0.01, -0.055, outer * 0.05);
    thumb.rotation.z = 0.8;
    thumb.rotation.x = -outer * 0.5;
    hand.add(thumb);
    add(thumb, 0.025, 0.045, 0.025, skin, 0, -0.0225, 0);
    const thumbTip = new THREE.Group();
    thumbTip.position.set(0, -0.045, 0);
    thumbTip.rotation.z = 0.25;
    thumb.add(thumbTip);
    add(thumbTip, 0.022, 0.035, 0.022, skinDark, 0, -0.0175, 0,
      K23_taperBox(0.022, 0.035, 0.022, 1.0, 0.75));
    return { arm, fore, hand };
  };
  // K25c: lengan z 0,26 (bukan 0,24 seperti rencana analisis) — paha
  // bertaper membuat permukaan luar paha di z≈0,212 (bukan 0,205 tanpa
  // taper); pada 0,24 jari kelingking (z=0,198) masih terbenam 14 mm
  // di paha; pada 0,26 kelingking di z=0,218, lepas ~6 mm dari paha.
  // Bahu tetap menempel torso (shoulder cap tumpang tindih 0,075).
  const armL = mkArm(0.26);
  const armR = mkArm(-0.26);

  // ---- bayangan kontak: blob lembut di bawah kaki (ShadowMap OFF) ---
  const shadowTex = K24_contactShadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.9),
    new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 3;
  g.add(shadow);

  return {
    group: g,
    armL: armL.arm, armR: armR.arm,
    foreL: armL.fore, foreR: armR.fore,
    handL: armL.hand, handR: armR.hand,
    legL: legL.leg, legR: legR.leg,
    calfL: legL.calf, calfR: legR.calf,
    torso, head,
  };
}
