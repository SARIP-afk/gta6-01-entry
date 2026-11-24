// K22_ Fase 3 (ronde #17) — kualitas visual aset, lanjutan Fase 2.
// Semua helper Fase 3 tinggal di sini supaya diff gfx.js tetap kecil
// dan setiap tahap bisa di-rollback dengan melepas satu pemanggilan.
// TIDAK ada perubahan gameplay / sistem — hanya aset visual.

import * as THREE from '../vendor/three.module.min.js';

// ---- Tahap 1: fill light buritan hero ---------------------------------
// Matahari senja datang dari barat (-x) + sedikit selatan; buritan hero
// menghadap timur (+x) sehingga TIDAK PERNAH kena sinar matahari
// langsung — hanya hemi (langit/ground) yang hangat-gelap. Fill light
// hangat ini menempel di grup heroCar (ikut mobil), 5,5 m di belakang
// buritan, 2,6 m di atas jalan, jangkauan 16 m: hanya buritan + aspal
// di sekitarnya yang terangkat, bukan pencahayaan global.
// Three r160 = physical lights: intensitas candela, decay 2 — pada
// jarak ~3,5 m ke muka buritan, I=30 memberi ~2,4 (diuji I=18 dulu:
// buritan (87,34,8)->(163,76,22); I=30 -> (190,98,30), lebih dekat
// ke Kumala (227,97,71) tanpa blow-out; genangan cahaya di aspal
// belakang mobil tetap halus).
export function K22_makeHeroFill() {
  const light = new THREE.PointLight(0xffa860, 30, 16, 2);
  light.position.set(-5.5, 2.6, 0);
  return light;
}

// ---- Tahap 3: skyline latar -------------------------------------------
// Menara-menara JAUH di luar grid playable (ujung barat jalan pantai +
// baris utara jauh), murni backdrop: TIDAK masuk layout.buildings
// (jadi tidak mengubah camBlockers, minimap, collision, atau sim).
// Tiap menara hanya: badan (facade atlas — jendela TERLUKIS di
// tekstur, 0 tris jendela instanced) + cornice + parapet + atap
// + bulkhead = 5 kotak = 60 tris. 14 menara ≈ 840 tris. Warna fasad
// dari ujung jenuh palet K9 (magenta/pink/teal/biru/emas — terbukti
// K16 bertahan di sisi bayangan; oranye/cokelat terseret jadi cokelat
// oleh hemiGround). Tinggi 55-110 m, bervariasi, supaya skyline di
// ujung jalan + horizon utara tidak lagi datar.
// Koordinat dicek terhadap WORLD (x0 -336, z0 -336, x1 432, z1 336):
// klaster barat x -330..-312 (di ujung jalan z=240, kaki di darat,
// BUKAN di laut — laut baru mulai z>312); baris utara z -330..-312.
export const K22_SKYLINE_TOWERS = [
  // Klaster barat — ujung Boulevard (terlihat lurus ke depan di
  // chase/play/cover, mengisi horizon tengah yang sekarang kosong).
  { x: -322, z: 168, w: 22, d: 20, h: 120, face: '#d81159', roof: '#495057' },
  { x: -318, z: 196, w: 18, d: 18, h: 90, face: '#118ab2', roof: '#3d405b' },
  { x: -324, z: 222, w: 24, d: 22, h: 140, face: '#e84393', roof: '#4a4e69' },
  { x: -316, z: 232, w: 16, d: 16, h: 70, face: '#2ec4b6', roof: '#3d405b' },
  { x: -320, z: 142, w: 20, d: 18, h: 105, face: '#ffd166', roof: '#495057' },
  { x: -326, z: 120, w: 18, d: 20, h: 80, face: '#06d6a0', roof: '#6c757d' },
  // Baris utara jauh — horizon kanan di chase/play/cover + latar
  // skyline dari sudut mana pun yang menghadap utara.
  { x: -240, z: -322, w: 24, d: 22, h: 105, face: '#e84393', roof: '#4a4e69' },
  { x: -160, z: -318, w: 20, d: 20, h: 80, face: '#f4845f', roof: '#3d405b' },
  { x: -80, z: -324, w: 26, d: 22, h: 125, face: '#118ab2', roof: '#495057' },
  { x: 0, z: -320, w: 22, d: 20, h: 95, face: '#d81159', roof: '#3d405b' },
  { x: 80, z: -322, w: 20, d: 18, h: 75, face: '#2ec4b6', roof: '#6c757d' },
  { x: 160, z: -318, w: 24, d: 22, h: 110, face: '#ffd166', roof: '#4a4e69' },
  { x: 240, z: -324, w: 18, d: 18, h: 85, face: '#e84393', roof: '#3d405b' },
  { x: 310, z: -320, w: 22, d: 20, h: 100, face: '#06d6a0', roof: '#495057' },
];
