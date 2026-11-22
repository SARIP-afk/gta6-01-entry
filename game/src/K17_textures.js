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
