// K17_ terrain textures — Solmarina texture round (pasir / laut / langit).
// Everything here is procedural canvas work generated at boot: no external
// image files, so the repo stays self-contained and every cover is a real
// in-game screenshot. All variation is deterministic (seeded mulberry32 /
// coordinate hash) — never Math.random — so the same seed always builds
// the same beach. Written fresh for this round; nothing copied verbatim
// from the older R7 / sandGrain / seaTexture helpers.
//
// Why the old look failed, in one line each:
// - sand: the 4096 px ground canvas gives ~5 px per metre, so its 3 px
//   speckles are half-metre blobs; the two grain overlays sat at opacity
//   0.14 / 0.10, i.e. invisible. Close sand therefore read as one flat
//   tan wash. Fix: per-pixel value-noise detail + tone layers, at real
//   opacity, on Lambert (lit) overlays.
// - sea: the old texture was 260 straight horizontal white strokes on a
//   flat blue — at 2K it reads as ruled lines. Fix: curved crest arcs,
//   swell blotches and sparkle, plus a real foam wash at the waterline.
// - clouds: low-segment spheres (8x5) with flat facets read as pale
//   hexagons. Fix: soft alpha-gradient wisps on merged vertical planes
//   facing the city, same 12 draw calls, ~30x fewer triangles.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, hash2, clamp } from './util.js';

// ---- deterministic lattice value noise (tileable) ----
// K17_lattice returns a size x size grid of 0..1 values from a seed.
// K17_sample reads it with smooth (smoothstep) interpolation and wraps
// at the edges, so any texture built from it tiles seamlessly.
function K17_lattice(size, seed) {
  const draw = mulberry32(seed);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = draw();
  return { size, grid };
}
function K17_sample(lat, x, y) {
  const { size, grid } = lat;
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % size) + size) % size;
  const x1 = (x0 + 1) % size;
  const y0 = ((yi % size) + size) % size;
  const y1 = (y0 + 1) % size;
  const a = grid[y0 * size + x0], b = grid[y0 * size + x1];
  const c = grid[y1 * size + x0], d = grid[y1 * size + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// K17_fbm: fractal sum over lattice octaves. `freq` is the lattice
// frequency of the first octave in texture space (u,v in 0..1).
function K17_fbm(lattices, u, v, freq, octaves) {
  let sum = 0, amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const lat = lattices[o % lattices.length];
    sum += K17_sample(lat, u * freq, v * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}
function K17_canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function K17_texture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---- 1. PASIR ---------------------------------------------------------
// K17_sandDetailTexture: 512 px tile, per-pixel. Low-frequency fbm gives
// broad warm tonal drift (deep gold <-> pale cream), mid-frequency fbm
// gives soft darker patches, and a per-pixel grain hash gives the
// close-up speckle. Wind-ripple arcs + shell flecks are drawn on top.
// Meant to tile at ~6 m per tile (repeat ~128 over the 768 m beach).
export function K17_sandDetailTexture() {
  const S = 512;
  const cv = K17_canvas(S, S);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;
  const lattices = [K17_lattice(32, 17001), K17_lattice(32, 17002), K17_lattice(32, 17003), K17_lattice(32, 17004)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const tone = K17_fbm(lattices, u, v, 3, 3);      // broad warm drift
      const patch = K17_fbm(lattices, u + 0.37, v + 0.61, 7, 3); // soft patches
      const grain = hash2(x, y, 17011);                 // per-pixel speckle
      // base sand: pale cream (244,227,184) -> deep gold (207,167,99)
      let r = 244 - 37 * tone - 22 * (patch - 0.5);
      let g = 227 - 60 * tone - 18 * (patch - 0.5);
      let b = 184 - 85 * tone - 12 * (patch - 0.5);
      // grain: ~12% of pixels go darker, ~10% go lighter, the rest stay
      if (grain < 0.12) { r *= 0.62; g *= 0.58; b *= 0.52; }
      else if (grain > 0.90) { r = Math.min(255, r * 1.10); g = Math.min(255, g * 1.08); b = Math.min(255, b * 1.06); }
      else { const n = (grain - 0.12) / 0.78 - 0.5; r += n * 14; g += n * 12; b += n * 10; }
      const i = (y * S + x) * 4;
      data[i] = clamp(r, 0, 255);
      data[i + 1] = clamp(g, 0, 255);
      data[i + 2] = clamp(b, 0, 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // wind ripples: long shallow curves, never straight lines
  const draw = mulberry32(17021);
  for (let i = 0; i < 46; i++) {
    const x0 = draw() * S, y0 = draw() * S;
    const len = 60 + draw() * 180;
    const sag = (draw() - 0.5) * 26;
    ctx.strokeStyle = draw() < 0.5
      ? `rgba(150,112,66,${0.05 + draw() * 0.08})`
      : `rgba(255,240,200,${0.05 + draw() * 0.07})`;
    ctx.lineWidth = 1.5 + draw() * 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + len / 2, y0 + sag, x0 + len, y0 + (draw() - 0.5) * 10);
    ctx.stroke();
  }
  // shell flecks: pale + pink dots, a few with a darker rim arc
  for (let i = 0; i < 90; i++) {
    const x = draw() * S, y = draw() * S, r = 1.5 + draw() * 2.5;
    ctx.fillStyle = draw() < 0.6 ? 'rgba(255,246,230,0.9)' : 'rgba(238,178,168,0.9)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return K17_texture(cv);
}

// K17_sandToneTexture: 256 px tile, low-frequency fbm only — big soft
// tonal blotches (warm gold / pale cream / cool mauve-grey) that break
// the flat wash at mid distance. Meant to tile at ~128 m per tile.
export function K17_sandToneTexture() {
  const S = 256;
  const cv = K17_canvas(S, S);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;
  const lattices = [K17_lattice(32, 17031), K17_lattice(32, 17032), K17_lattice(32, 17033)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const tone = K17_fbm(lattices, u, v, 2, 3);
      const cool = K17_fbm(lattices, u + 0.53, v + 0.29, 3, 2);
      // pale cream -> warm gold, with a cool mauve-grey drift at high `cool`
      let r = 238 - 34 * tone - 14 * cool;
      let g = 220 - 52 * tone - 6 * cool;
      let b = 182 - 72 * tone + 14 * cool;
      const i = (y * S + x) * 4;
      data[i] = clamp(r, 0, 255);
      data[i + 1] = clamp(g, 0, 255);
      data[i + 2] = clamp(b, 0, 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return K17_texture(cv);
}

// K17_wetSandTexture: 512x64 vertical strip. Alpha ramps from 0 at the
// dry (inland) edge to a dark wet brown at the waterline, with a wavy
// top edge so the wet band never reads as a ruled stripe. The plane
// using it sits with its dark edge at the waterline.
export function K17_wetSandTexture() {
  const W = 512, H = 64;
  const cv = K17_canvas(W, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const draw = mulberry32(17041);
  // wavy dry edge: one sine sum per column, 8..30 px down from the top
  const edge = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    edge[x] = 16 + 8 * Math.sin(x * 0.021 + 1.3) + 5 * Math.sin(x * 0.047 + 4.1) + draw() * 2;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = clamp((y - edge[x]) / (H - edge[x]), 0, 1); // 0 dry -> 1 wet
      const a = t * t * 0.62;
      // wet sand: dark warm brown, deepening toward the water
      const i = (y * W + x) * 4;
      data[i] = 122 - 18 * t;
      data[i + 1] = 92 - 12 * t;
      data[i + 2] = 58 - 8 * t;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return K17_texture(cv);
}

// ---- 2. LAUT ----------------------------------------------------------
// K17_seaTexture: 1024x512 tile. Per-pixel swell blotches (two blues +
// a teal drift) and sparkle, then ~140 curved crest arcs of varying
// length, curvature and angle — no straight horizontal strokes. The
// sea material still tints warm at sunset, so the texture stays cool.
export function K17_seaTexture() {
  const W = 1024, H = 512;
  const cv = K17_canvas(W, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const lattices = [K17_lattice(32, 17051), K17_lattice(32, 17052), K17_lattice(32, 17053)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const swell = K17_fbm(lattices, u, v, 3, 3);
      const teal = K17_fbm(lattices, u + 0.41, v + 0.73, 5, 2);
      const spark = hash2(x, y, 17061);
      // deep #2b6f92 -> light #63b8d6, teal drift toward #3a9ab0
      let r = 43 + 56 * swell - 8 * teal;
      let g = 111 + 73 * swell - 6 * teal;
      let b = 146 + 68 * swell + 4 * teal;
      if (spark > 0.992) { r += 70; g += 70; b += 60; }       // sun sparkle
      else if (spark < 0.012) { r *= 0.8; g *= 0.82; b *= 0.85; } // dark fleck
      const i = (y * W + x) * 4;
      data[i] = clamp(r, 0, 255);
      data[i + 1] = clamp(g, 0, 255);
      data[i + 2] = clamp(b, 0, 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // crest arcs: curved, angled, never full-width straight lines
  const draw = mulberry32(17071);
  ctx.lineCap = 'round';
  for (let i = 0; i < 150; i++) {
    const x0 = draw() * W, y0 = draw() * H;
    const len = 26 + draw() * 110;
    const ang = (draw() - 0.5) * 0.5;              // +- ~14 deg off horizontal
    const sag = (draw() - 0.5) * 22;
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    ctx.strokeStyle = `rgba(255,255,255,${0.07 + draw() * 0.16})`;
    ctx.lineWidth = 1 + draw() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + dx / 2 - Math.sin(ang) * sag, y0 + dy / 2 + Math.cos(ang) * sag, x0 + dx, y0 + dy);
    ctx.stroke();
  }
  // a few long S-curves: the swell lines a real sea shows at distance
  for (let i = 0; i < 22; i++) {
    const x0 = draw() * W, y0 = draw() * H;
    const len = 180 + draw() * 260;
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + draw() * 0.07})`;
    ctx.lineWidth = 2 + draw() * 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + len * 0.3, y0 - 14 - draw() * 10, x0 + len * 0.7, y0 + 14 + draw() * 10, x0 + len, y0 + (draw() - 0.5) * 12);
    ctx.stroke();
  }
  return K17_texture(cv);
}

// K17_foamTexture: 1024x64 wash strip for the waterline. Scalloped
// bubble edge along the bottom (seaward) side fading to a soft white
// haze inland, so the sea meets the sand with foam instead of a hard
// cut. Meant to scroll slowly in x (see gfx update()).
export function K17_foamTexture() {
  const W = 1024, H = 64;
  const cv = K17_canvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const draw = mulberry32(17081);
  // soft haze band over the whole strip
  const haze = ctx.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  haze.addColorStop(1, 'rgba(255,255,255,0.42)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);
  // scallop row: overlapping bubbles along the seaward edge
  for (let x = 4; x < W; x += 9 + draw() * 14) {
    const r = 5 + draw() * 11;
    const cy = H - 4 - draw() * 10;
    const g = ctx.createRadialGradient(x, cy, 0, x, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${0.55 + draw() * 0.3})`);
    g.addColorStop(0.7, `rgba(255,255,255,${0.28 + draw() * 0.2})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  // bubble speckle above the edge
  for (let i = 0; i < 240; i++) {
    const x = draw() * W, y = 8 + draw() * (H - 16);
    const r = 0.8 + draw() * 2.2;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + draw() * 0.45})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return K17_texture(cv);
}

// ---- 3. LANGIT / AWAN --------------------------------------------------
// K17_cloudTexture: 256x128 soft wisp. A dozen overlapping horizontal
// radial-gradient blobs + a few hair-thin streaks, alpha fading to zero
// at every edge — no hard outline, no facets, no hexagon silhouette.
// Three seeded variants so neighbouring clusters do not repeat visibly.
export function K17_cloudTexture(variant = 0) {
  const W = 256, H = 128;
  const cv = K17_canvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const draw = mulberry32(17091 + variant * 101);
  const blob = (cx, cy, rx, ry, alpha) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // main band: wide flat blobs clustered around the middle
  for (let i = 0; i < 14; i++) {
    const cx = 28 + draw() * (W - 56);
    const cy = 44 + (draw() - 0.5) * 36;
    blob(cx, cy, 26 + draw() * 44, 8 + draw() * 12, 0.16 + draw() * 0.20);
  }
  // thin wispy streaks above and below the band
  for (let i = 0; i < 6; i++) {
    const cx = 30 + draw() * (W - 60);
    const cy = draw() < 0.5 ? 18 + draw() * 18 : 92 + draw() * 18;
    blob(cx, cy, 34 + draw() * 52, 3 + draw() * 5, 0.10 + draw() * 0.12);
  }
  // a brighter core so the sunlit top reads against the magenta sky
  for (let i = 0; i < 4; i++) {
    const cx = 60 + draw() * (W - 120);
    const cy = 46 + (draw() - 0.5) * 22;
    blob(cx, cy, 18 + draw() * 22, 6 + draw() * 7, 0.22 + draw() * 0.14);
  }
  return K17_texture(cv);
}

// K17_buildClouds: 12 wide flat layered clusters, same layout seed as
// the old K16_ rings (azimuth / radius / height), but each puff is a
// soft-textured vertical plane facing the city centre instead of a
// faceted sphere. One mesh per cluster (12 draw calls, unchanged),
// 2 triangles per puff (~290 total vs ~9,200 for the spheres).
// Returns { groups, materials } — groups drift in update() like before,
// materials get the sunset/night tint in update().
export function K17_buildClouds(scene) {
  const K17_h = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const materials = [0, 1, 2].map((v) => new THREE.MeshBasicMaterial({
    map: K17_cloudTexture(v), transparent: true, opacity: 0.45,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  const groups = [];
  // unit quad in the XY plane, centred, 2 triangles
  const quad = new THREE.PlaneGeometry(1, 1);
  const qp = quad.attributes.position.array;
  const qu = quad.attributes.uv.array;
  for (let c = 0; c < 12; c++) {
    const az = (c / 12) * Math.PI * 2 + (K17_h(c * 13 + 5) - 0.5) * 0.55;
    const rad = 520 + K17_h(c * 17 + 2) * 180;
    const cy = 105 + K17_h(c * 19 + 3) * 175;
    const cs = 0.85 + K17_h(c * 23 + 7) * 0.95;
    const nPuff = 10 + Math.floor(K17_h(c * 29 + 11) * 5);
    const pos = new Float32Array(nPuff * qp.length);
    const uv = new Float32Array(nPuff * qu.length);
    const idx = [];
    for (let p = 0; p < nPuff; p++) {
      const px = (K17_h(c * 101 + p * 7 + 1) - 0.5) * 190 * cs;
      const py = (K17_h(c * 101 + p * 7 + 2) - 0.5) * 12 * cs;
      const pz = (K17_h(c * 101 + p * 7 + 3) - 0.5) * 90 * cs;
      const pw = (30 + K17_h(c * 101 + p * 7 + 4) * 60) * cs;
      const ph = (5 + K17_h(c * 101 + p * 7 + 5) * 8) * cs;
      const rot = (K17_h(c * 101 + p * 7 + 6) - 0.5) * 0.36;
      const co = Math.cos(rot), si = Math.sin(rot);
      const base = p * qp.length;
      for (let v = 0; v < qp.length; v += 3) {
        const lx = qp[v] * pw, ly = qp[v + 1] * ph;
        pos[base + v] = lx * co - ly * si + px;
        pos[base + v + 1] = lx * si + ly * co + py;
        pos[base + v + 2] = pz;
      }
      const ub = p * qu.length;
      for (let v = 0; v < qu.length; v++) uv[ub + v] = qu[v];
      const vb = p * 4;
      idx.push(vb, vb + 1, vb + 2, vb, vb + 2, vb + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, materials[c % 3]);
    const group = new THREE.Group();
    group.position.set(Math.cos(az) * rad, cy, Math.sin(az) * rad);
    group.add(mesh);
    // face the city centre: lookAt points +Z at the target for a
    // non-camera object, so the planes face the cameras downtown.
    group.lookAt(0, cy, 0);
    groups.push(group);
    scene.add(group);
  }
  return { groups, materials };
}
// DRAFT — K17_ urban textures (aspal / fasad). Disalin ke game/src/K17_textures.js
// setelah baseline driver-2k selesai. Ditulis baru; bukan salinan verbatim.

// ---- 4. ASPAL ----------------------------------------------------------
// K17_asphaltDetailTexture: 512 px tile, latar transparan — hanya speckle
// dan bercak tonal halus, tanpa retak panjang (retak panjang akan
// mengulang tiap 6 m dan terbaca sebagai pola). Dipakai sebagai overlay
// Lambert di atas grid kota (tile ~6 m), opacity ~0.25, jadi aspal
// close-up berbutir tanpa menutup marka jalan di bawahnya.
export function K17_asphaltDetailTexture() {
  const S = 512;
  const cv = K17_canvas(S, S);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;
  const lattices = [K17_lattice(32, 17121), K17_lattice(32, 17122), K17_lattice(32, 17123)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const tone = K17_fbm(lattices, u, v, 4, 2); // bercak tonal lembut
      const grain = hash2(x, y, 17131);
      const i = (y * S + x) * 4;
      // dasar: transparan; hanya butir + bercak yang menulis alpha
      let a = 0, r = 0, g = 0, b = 0;
      if (grain < 0.09) { r = 12; g = 12; b = 14; a = 52 + tone * 40; }
      else if (grain > 0.93) { r = 218; g = 220; b = 222; a = 42 + tone * 34; } // K20_ didinginkan (dulu 225,222,210)
      else if (tone < 0.32) { r = 20; g = 20; b = 24; a = 14; }   // bercak gelap
      else if (tone > 0.72) { r = 196; g = 198; b = 202; a = 12; } // bercak pucat aus — K20_ didinginkan (dulu 200,196,182)
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = Math.round(a);
    }
  }
  ctx.putImageData(img, 0, 0);
  // retak pendek (8-30 px ~ 10-35 cm di tile 6 m): cukup pendek untuk
  // tidak membentuk pola saat tile mengulang
  const draw = mulberry32(17141);
  ctx.strokeStyle = 'rgba(12,12,15,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    let cx = draw() * S, cy = draw() * S;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (let k = 0; k < 3; k++) {
      cx += (draw() - 0.5) * 26; cy += (draw() - 0.5) * 26;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  return K17_texture(cv);
}

// K17_paintAsphaltWear: aus jalan + trotoar, dilukis LANGSUNG ke kanvas
// ground 4096 px (5,3 px/m) — di bawah marka jalan R7, jadi zebra/garis
// tengah tetap terbaca. Dipanggil dari groundTexture() di gfx.js setelah
// speckle lama, sebelum lane furniture. Semua posisi dari hash2, jadi
// deterministik; tidak ada alokasi tekstur baru, 0 draw call, 0 tris.
// Argumen: ctx kanvas ground, px/pz pemeta dunia->kanvas, mpp px per
// meter, roadLines garis jalan, roadHalf setengah lebar jalan.
export function K17_paintAsphaltWear(ctx, px, pz, mpp, roadLines, roadHalf, gridMin, gridMax, roadStep, beachZ) {
  const roadPoint = (i, salt) => {
    const line = roadLines[Math.floor(hash2(i, salt, 1) * roadLines.length) % roadLines.length];
    const along = gridMin + hash2(i, salt + 1, 1) * (gridMax - gridMin);
    const off = (hash2(i, salt + 2, 1) - 0.5) * 2 * (roadHalf - 0.5);
    return hash2(i, salt + 3, 1) < 0.5
      ? { x: along, z: line + off }
      : { x: line + off, z: along };
  };
  // 170 bercak tonal ekstra: gelap (basah/aus) + pucat (terbakar matahari)
  for (let i = 0; i < 170; i++) {
    const p = roadPoint(i, 201);
    const pale = hash2(i, 202, 1) < 0.38;
    ctx.fillStyle = pale
      ? `rgba(198,200,202,${0.05 + hash2(i, 203, 1) * 0.09})` // K20_ didinginkan (dulu 210,205,190)
      : `rgba(18,18,22,${0.08 + hash2(i, 204, 1) * 0.13})`;
    ctx.beginPath();
    ctx.ellipse(px(p.x), pz(p.z), (3 + hash2(i, 205, 1) * 15) * mpp, (2 + hash2(i, 206, 1) * 8) * mpp, hash2(i, 207, 1) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 110 retak bergerigi, sebagian bercabang dari titik tengahnya
  ctx.strokeStyle = 'rgba(12,12,15,0.42)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 110; i++) {
    const p = roadPoint(i, 211);
    let cx = px(p.x), cz = pz(p.z);
    const pts = [[cx, cz]];
    ctx.beginPath(); ctx.moveTo(cx, cz);
    for (let k = 0; k < 6; k++) {
      cx += (hash2(i, 212 + k, 1) - 0.5) * 9 * mpp;
      cz += (hash2(i, 217 + k, 1) - 0.5) * 9 * mpp;
      pts.push([cx, cz]);
      ctx.lineTo(cx, cz);
    }
    ctx.stroke();
    if (hash2(i, 223, 1) < 0.45) {
      const [bx, bz] = pts[2 + Math.floor(hash2(i, 224, 1) * 3)];
      ctx.beginPath(); ctx.moveTo(bx, bz);
      let dx = bx, dz = bz;
      for (let k = 0; k < 3; k++) {
        dx += (hash2(i, 225 + k, 1) - 0.5) * 7 * mpp;
        dz += (hash2(i, 228 + k, 1) - 0.5) * 7 * mpp;
        ctx.lineTo(dx, dz);
      }
      ctx.stroke();
    }
  }
  // 60 tar snake: garis aspal cair bergelombang menutup retak lama
  ctx.strokeStyle = 'rgba(10,10,12,0.4)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 60; i++) {
    const p = roadPoint(i, 231);
    const horiz = hash2(i, 232, 1) < 0.5;
    const len = (6 + hash2(i, 233, 1) * 14) * mpp;
    const x0 = px(p.x), z0 = pz(p.z);
    const wob = (hash2(i, 234, 1) - 0.5) * 3 * mpp;
    ctx.beginPath();
    ctx.moveTo(x0, z0);
    if (horiz) ctx.quadraticCurveTo(x0 + len / 2, z0 + wob, x0 + len, z0 + (hash2(i, 235, 1) - 0.5) * 2 * mpp);
    else ctx.quadraticCurveTo(x0 + wob, z0 + len / 2, x0 + (hash2(i, 235, 1) - 0.5) * 2 * mpp, z0 + len);
    ctx.stroke();
  }
  // 36 tambalan perbaikan, abu-abu bervariasi + jahitan pucat
  for (let i = 0; i < 36; i++) {
    const p = roadPoint(i, 241);
    const w = (2 + hash2(i, 242, 1) * 3) * mpp, d = (1.5 + hash2(i, 243, 1) * 2) * mpp;
    const tone = 24 + Math.floor(hash2(i, 244, 1) * 22);
    ctx.fillStyle = `rgba(${tone},${tone},${tone + 3},0.5)`;
    ctx.fillRect(px(p.x) - w / 2, pz(p.z) - d / 2, w, d);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px(p.x) - w / 2, pz(p.z) - d / 2, w, d);
  }
  // 18 noda oli ekstra dengan kilau tipis
  for (let i = 0; i < 18; i++) {
    const p = roadPoint(i, 251);
    const r = (0.7 + hash2(i, 252, 1) * 1.3) * mpp;
    const grad = ctx.createRadialGradient(px(p.x), pz(p.z), 0, px(p.x), pz(p.z), r);
    grad.addColorStop(0, 'rgba(8,8,12,0.55)');
    grad.addColorStop(0.6, 'rgba(20,16,30,0.3)');
    grad.addColorStop(1, 'rgba(12,12,16,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), r, 0, Math.PI * 2); ctx.fill();
  }
  // ---- trotoar: sabuk 1,5 m di tepi dalam tiap blok, pelat 2 m + nat ----
  // Digambar di atas isi lot (rumput/beton/tanah) tapi di bawah marka:
  // trotoar akhirnya terbaca sebagai beton berpelat di tepi jalan.
  // Blok plaza market (gx -96, gz -120) dan stadion (gx -216, gz 120)
  // dilewati supaya ubin plaza / mangkuk stadion tidak tertutup.
  const slab = 2 * mpp, band = 1.5 * mpp;
  for (let bx = gridMin; bx < gridMax; bx += roadStep) {
    for (let bz = gridMin; bz < gridMax; bz += roadStep) {
      if (bz >= beachZ) continue;
      if (bx === -96 && bz === -120) continue;
      if (bx === -216 && bz === 120) continue;
      const x0 = px(bx + roadHalf), z0 = pz(bz + roadHalf);
      const w = (roadStep - 2 * roadHalf) * mpp, d = (roadStep - 2 * roadHalf) * mpp;
      const strips = [
        { x: x0, y: z0, ww: w, hh: band, horiz: true },
        { x: x0, y: z0 + d - band, ww: w, hh: band, horiz: true },
        { x: x0, y: z0, ww: band, hh: d, horiz: false },
        { x: x0 + w - band, y: z0, ww: band, hh: d, horiz: false },
      ];
      for (const s of strips) {
        const n = Math.floor((s.horiz ? s.ww : s.hh) / slab);
        for (let k = 0; k < n; k++) {
          const h = hash2(bx + k, bz + (s.horiz ? 1 : 2), 261);
          ctx.fillStyle = h < 0.5
            ? `rgba(0,0,0,${0.04 + h * 0.12})`
            : `rgba(255,255,255,${0.03 + (h - 0.5) * 0.10})`;
          if (s.horiz) ctx.fillRect(s.x + k * slab, s.y, slab, s.hh);
          else ctx.fillRect(s.x, s.y + k * slab, s.ww, slab);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
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

// ---- 5. FASAD ----------------------------------------------------------
// K17_facadeTexture: atlas 512x512 pengganti facadeTexture() lama.
// Separuh kiri (x 0..256) memuat 2 bay x 2 lantai — 4 jendela BERBEDA —
// bukan 1 bay yang mengulang ke seluruh kota: bay A lantai ganjil =
// kaca terang + tirai putih, bay B lantai ganjil = kaca gelap, bay A
// lantai genap = kaca hangat menyala + tirai krem, bay B lantai genap =
// kaca gelap + kerai. Separuh kanan tetap putih polos (semua kotak
// non-fasad mengambilnya, warna vertex lolos utuh). Dinding tiap
// kuadran nyaris putih dengan tint + kotoran berbeda, jadi warna fasad
// jenuh Kumala per bangunan tetap dominan. BoxSoup memakai
// uvOpts.tileBays=2 / tileFloors=2 untuk atlas ini.
export function K17_facadeTexture() {
  const cv = K17_canvas(512, 512);
  const ctx = cv.getContext('2d');
  const paintBay = (ox, oy, kind) => {
    const wall = { bright: '#f6f2e8', dark: '#f0ebe0', lit: '#f7f1e4', blinds: '#eee8db' }[kind];
    ctx.fillStyle = wall;
    ctx.fillRect(ox, oy, 128, 256);
    // bintik plester
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + hash2(ox + i, oy, 271) * 0.05})`;
      ctx.fillRect(ox + 4 + hash2(i, oy, 272) * 120, oy + 150 + hash2(ox, i, 273) * 90, 2, 2);
    }
    // kotoran: gradasi bawah lantai + coreng di bawah ambang jendela
    const grime = ctx.createLinearGradient(0, oy + 200, 0, oy + 256);
    grime.addColorStop(0, 'rgba(60,50,40,0)');
    grime.addColorStop(1, 'rgba(60,50,40,0.16)');
    ctx.fillStyle = grime;
    ctx.fillRect(ox, oy + 200, 128, 56);
    for (let s = 0; s < 4; s++) {
      const sx = ox + 40 + hash2(s, oy, 274) * 48;
      ctx.fillStyle = `rgba(70,60,50,${0.05 + hash2(ox, s, 275) * 0.06})`;
      ctx.fillRect(sx, oy + 140, 3 + hash2(s, ox, 276) * 3, 40 + hash2(oy, s, 277) * 30);
    }
    // garis tepi kuadran + garis lantai bawah
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(ox, oy, 128, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(ox, oy, 4, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(ox, oy + 244, 128, 12);
    // K21_ pilaster: strip terang di tepi kiri + bayangan di tepi kanan
    // tiap bay — dinding fasad dapat relief dangkal, bukan bidang rata.
    ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(ox + 4, oy, 6, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(ox + 118, oy, 6, 256);
    // kusen
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(ox + 36, oy + 4, 56, 128);
    // kaca per varian
    const glass = ctx.createLinearGradient(0, oy + 12, 0, oy + 124);
    if (kind === 'bright') { glass.addColorStop(0, '#8fa8bc'); glass.addColorStop(1, '#54748c'); }
    else if (kind === 'lit') { glass.addColorStop(0, '#ffcf7a'); glass.addColorStop(1, '#e89b3c'); }
    else if (kind === 'blinds') { glass.addColorStop(0, '#2c3644'); glass.addColorStop(1, '#1a2230'); }
    else { glass.addColorStop(0, '#232c3a'); glass.addColorStop(1, '#161d29'); }
    ctx.fillStyle = glass;
    ctx.fillRect(ox + 40, oy + 12, 48, 112);
    // kilau diagonal (dua untuk terang, satu samar untuk lainnya)
    const slash = (x0, x1, alpha) => {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(ox + x0, oy + 124); ctx.lineTo(ox + x0 + 12, oy + 12);
      ctx.lineTo(ox + x1, oy + 12); ctx.lineTo(ox + x1 - 12, oy + 124);
      ctx.closePath(); ctx.fill();
    };
    if (kind === 'bright') { slash(8, 20, 0.30); slash(34, 42, 0.18); }
    else if (kind === 'lit') { slash(10, 20, 0.14); }
    else if (kind === 'dark') { slash(12, 20, 0.10); }
    else { slash(14, 22, 0.08); }
    // tirai / kerai
    if (kind === 'bright') {
      ctx.fillStyle = 'rgba(246,243,232,0.88)';
      ctx.fillRect(ox + 40, oy + 12, 22, 112);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(ox + 48, oy + 12, 2, 112);
      ctx.fillRect(ox + 56, oy + 12, 2, 112);
    } else if (kind === 'lit') {
      ctx.fillStyle = 'rgba(250,240,210,0.90)';
      ctx.fillRect(ox + 64, oy + 12, 24, 112);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(ox + 72, oy + 12, 2, 112);
      ctx.fillRect(ox + 80, oy + 12, 2, 112);
    } else if (kind === 'blinds') {
      ctx.fillStyle = 'rgba(232,230,222,0.55)';
      for (const by of [30, 55, 80]) ctx.fillRect(ox + 40, oy + by, 48, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (const by of [35, 60, 85]) ctx.fillRect(ox + 40, oy + by, 48, 1);
    }
    // mullion + ambang
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(ox + 62, oy + 12, 4, 112);
    ctx.fillRect(ox + 40, oy + 64, 48, 4);
    ctx.fillStyle = '#ddd5c0';
    ctx.fillRect(ox + 34, oy + 132, 60, 8);
  };
  paintBay(0, 0, 'bright');
  paintBay(128, 0, 'dark');
  paintBay(0, 256, 'lit');
  paintBay(128, 256, 'blinds');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(256, 0, 256, 512);
  return K17_texture(cv);
}
