# Polish #14 — Builder B verification notes (interim, K19 mid-edit)

Waktu: 22 Nov 2026, 09:30 WIB. HEAD saat tulis: 908bb7a (K18).
Grafik K19 Builder A BELUM commit (game/src/gfx.js modified, game/src/K19_golden.js
untracked, terakhir diubah 08:43 UTC). Semua render/tes di bawah memakai working
tree saat itu (K19 mid-edit) KECUALI k18-*-baseline (HEAD murni).

## Harness
- `driver-polish14.mjs` — render 2560x1440 native (Emulation.setDeviceMetricsOverride,
  quality med, pixelRatio 1, backing store == viewport, terbukti di log).
  Port CDP 9231 + profil /tmp/fresh-2k-profile-d (ISOLASI: tab sempat dicuri 2x —
  driver A pakai 9226, probe A pakai 9227; driver ini punya watchdog timeout 60 dtk
  + guard URL shot, dan me-skip shot bila tab dicuri).
- Server: 8080 (2K driver), 8091 (playtest). Recorder #14 jalan sepanjang ronde.

## 2K renders (ready=true, 0 console error semua)
| shot | calls | tris | catatan |
|---|---|---|---|
| play (K18 baseline) | 179 | 487.910 | k18-play-baseline-2k.png |
| play (K19 mid-edit + HUD 2x) | 189 | 484.174 | play-2k.png / k19-play-ui-2k.png |
| chase (K19 mid-edit) | 224 | 485.202 | chase-2k.png |
| cover (K19 mid-edit) | 240 | 486.364 | cover-2k.png |
| beach-hero (K19 mid-edit) | 137 | 480.982 | beach-hero-2k.png |
| cover (K18 baseline) | — | — | k18-cover-baseline-2k.png (render A) |

Budget: calls ≤350–400 ✓ (max 240), tris <500k ✓ tapi ME PET: 480–488k
(96–97,6% budget). Geometri tambahan K19 (kabin heli sphere, frond) untungnya
net MENGURANGI tris (frond 6 tris vs kotak 12).

## Tiga keluhan syarif (screenshot beranotasi 15:34 WIB) — K18 vs K19 mid-edit
1. HELI KOTAK → MEMBAIK BESAR. Kabin kini ellipsoid membulat (sphere 1.9x),
   hidung hitam membulat, boom meruncing + cincin emas, skid, rotor + tail rotor,
   searchlight. Cover side-on: terbaca sebagai helikopter. Sisa: kaca samping
   hanya celah hitam kecil; hidung hitam terbaca seperti gumpalan, bukan kaca;
   rotor disc masih piringan datar pucat.
2. PALEM BILAH PAPAN → MEMBAIK BESAR. Pelepah K19 melengkung/menjuntai,
   panjang bervariasi, ada bilah cokelat campur. Sisa: batang masih kolom
   bersegmen (sambungan kelihatan); pelepah masih bidang datar tanpa leaflet.
3. ASPAL BLUR PARAH → MARKA MEMBAIK, PERMUKAAN BELUM. Garis kuning ganda +
   dash putih + zebra kini GEOMETRI (tajam, tepi keras, terbukti di crop native).
   TAPI permukaan aspal foreground MASIH blur halus tanpa butir — butir halus
   K19 (tile 3 m, 170 px/m, opasitas 0,5) TIDAK TERBACA di sudut pandang
   menunduk: dot 1–2 px hilang oleh minifikasi mipmap (sudut ~5x), blotch
   alpha 0,05–0,11 x 0,5 nyaris nol. Perlu fitur skala 10–30 cm kontras
   KUAT (tambalan/tar snake/retak besar), bukan speckle 1–2 px.
   DUA CACAT TAMBAHAN:
   a. Overlay butir K17/K18/K19 (plane 576x522, z -288..234) TIDAK MENUTUPI
      jalan z=240 (boulevard cover/chase/hero) — berhenti tepat di tepi utara
      jalan. Jalan z=240 hanya dapat kanvas ground 5,3 px/m (blur) + marka R7.
      Plane pasir mulai z=246, jadi overlay bisa diperpanjang ke z=246 tanpa
      tabrakan. Jalan z=-144 (play) TERTUTUPI — tapi butirnya tetap tak terbaca
      (alasan minifikasi di atas).
   b. "GARIS CAHAYA ANEH" diagonal di foreground MASIH ADA. Penyebab
      terdiagnosis: sunGlare (gfx.js ~2099) — plane 720x720, AdditiveBlending,
      opacity 0,8 saat senja, diposisikan di matahari (620 m, rendah di
      horizon) + billboard ke kamera. Bidang sebesar itu menutupi setengah
      bawah frame termasuk jalan. Obat: perkecil / naikkan / pudarkan bagian
      bawah glare supaya tetap di langit.

## Per elemen vs referensi (skor jujur, K19 mid-edit)
- Jalan: marka 90% (tajam), permukaan 30% (blur) → 55%
- Mobil: terbaca, roda + spoiler + lampu ada, tapi panel datar, kaca hitam
  datar, hero dari belakang gelap → 60%
- Palem: pelepah melengkung 75%, batang bersegmen 40% → 65%
- NPC: siluet polos, kecil, 1 warna baju, tanpa detail → 30%
- Gedung: fasad warna + jendela menyala bervariasi → 75%
- Pantai: pasir BUTIR TERBACA di beach-hero (satu-satunya permukaan yang HD),
  tapi wash datar di play/chase, payung kecil → 55%
- Kapal: perahu kecil di laut, nyaris tak terbaca → 25%
- Heli: bentuk membulat + boom + skid 75%, kaca/rotor 40% → 65%
- Langit/cahaya: magenta-ungu masih dominan di atas (referensi oranye-pink
  hangat); matahari disc datar; cahaya sore terasa tapi belum golden → 60%
- Komposisi chase: kamera lebih rendah + gedung kanan mendominasi (referensi
  lebih terbuka, skyline jauh, jalan melengkung); pantai kiri terlalu luas
  dan kosong → 55%
- KESELURUHAN vs referensi chase: ~58% (K18 ~45%). Target 90% BELUM tercapai.
  Penghalang utama bersifat struktural (sudut kamera staging, penempatan
  gedung, kecerahan jalan, warna langit) + permukaan aspal.

## UI (Builder B, sudah diimplementasi)
- `game/index.html` + `game/src/hud.js`: wrapper #hud-scale, skala HUD
  s = max(1, min(vw/1280, vh/720)) — di 2560x1440 s=2, di 1280x720 s=1
  (pixel-identik, koordinat playtest tidak berubah). Minimap canvas backing
  store = cssSize * s (264 px di 2K) + drawMapOn setTransform supaya marker
  tetap proporsional — minimap 2K TAJAM (terbukti di play-2k.png).
- Hasil di 2K: panel misi BESAR (600 px ≈ 23% lebar, ref 26%), cash, senjata,
  kru, distrik, vitals semua terbaca. SISA GAP vs referensi: angka kecepatan
  88 px (6,1% tinggi; ref ~11,7%) dan minimap 264 px (10,3% lebar; ref ~15%)
  — masih ~50% ukuran referensi; butuh boost khusus di luar skala seragam
  bila syarif mau persis (tidak dilakukan — berisiko ubah layout 1280
  terverifikasi; dilaporkan saja).

## Playtest penuh (tree K19 mid-edit + UI B)
- `node playtest/pt.mjs all`, 09:03–09:24 WIB: runner ok:true,
  consoleErrors: 0, 48/48 skenario TEREKSEKUSI.
- Inner-ok: 46/48. mission-3 (tail-reenter) + mission-4 (drive-safehouse /
  cant-enter-car) GAGAL di run ini — KEDUANYA TERBUKTI FLAKE TIMING, bukan
  regresi: sim.js/layout.js/pt-inpage.js byte-identik dengan K18; re-run
  `node playtest/pt.mjs missions` → mission-1..4 SEMUA ok:true, dengan waktu
  leg mission-1/2 IDENTIK dengan run k15b (17,9 / 56,5 / 94,4 dtk).
  Penyebab: rAF live-stepping saat jeda antar-skenario mengubah posisi
  van/polisi/traffic (drift) — tail sensitif terhadap itu.
- Bukti UI tidak merusak: systems-minimap-travel ✓ (klik minimap fast-travel
  tepat), systems-day-night ✓ (jam HUD 13:00), hud-720/360 ✓.
- Perf playtest (1280x720): calls 82–238, tris 470–488k — dalam budget.
- results.json (48 skenario, full run) dipulihkan setelah re-run missions;
  tetap UNTRACKED, jangan di-commit.

## Yang masih menunggu
- Commit K19 Builder A → re-render final k19-*.png di HEAD tersebut +
  playtest penuh ulang (gate 48/48) → commit B (K19_).
- Rekomendasi untuk A (bukan perintah): (1) perpanjang overlay aspal ke
  z=246 + butir kontras kuat skala 10–30 cm; (2) kecilkan/naikkan sunGlare;
  (3) kaca heli lebih terbaca; (4) NPC bervariasi bila budget mengizinkan
  (tris tinggal ~12–20k).
