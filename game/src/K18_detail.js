// K18_ surface detailing — Solmarina polish round #13 (definitive brief).
// Two procedural canvas textures, no external images, deterministic
// (seeded hash only, never Math.random):
// - K18_facadeTextureB: a second 2x2-bay facade atlas. Half the city's
//   buildings use it (see gfx.js: bodies split by hash between the K17_
//   atlas and this one), so the skyline stops repeating one window.
//   Same 512x512 layout as the K17_ atlas — 4 bays of 128x256 on the
//   left half, plain white right half — so the BoxSoup UV math
//   (tileBays=2, tileFloors=2) works unchanged. Differences from K17_:
//   bigger glass (taller, wider), shutters on one bay, a lit bay with
//   an AC grille below the glass, a railed (Juliet) bay, and a darker
//   plinth strip at the base of every bay so the ground floor reads.
// - K18_beachToneTexture: 256 px tile of very large soft tonal patches
//   (warm gold / pale cream / pink-grey) for a third sand overlay at
//   ~256 m per tile, so the beach mid-ground is not one flat wash.
//   Used as a Lambert overlay plane next to the K17_ sand layers.
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

// ---- facade atlas B ----------------------------------------------------
// Bay kinds: 'shutter' (tall glass + white side shutters),
// 'blinds' (dark glass + many blind slats), 'litAC' (warm lit glass +
// cream curtains + AC grille below), 'rail' (cool glass + Juliet rail
// bars across the lower half). Same 128x256 bay box as K17_.
export function K18_facadeTextureB() {
  const cv = K18_canvas(512, 512);
  const ctx = cv.getContext('2d');
  const paintBay = (ox, oy, kind) => {
    const wall = { shutter: '#f3ecdc', blinds: '#ece5d3', litAC: '#f5eedd', rail: '#eae2cf' }[kind];
    ctx.fillStyle = wall;
    ctx.fillRect(ox, oy, 128, 256);
    // plaster speckle
    for (let i = 0; i < 52; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + hash2(ox + i, oy, 271) * 0.05})`;
      ctx.fillRect(ox + 4 + hash2(i, oy, 272) * 120, oy + 150 + hash2(ox, i, 273) * 90, 2, 2);
    }
    // grime: gradient at the base + streaks under the sill
    const grime = ctx.createLinearGradient(0, oy + 200, 0, oy + 256);
    grime.addColorStop(0, 'rgba(60,50,40,0)');
    grime.addColorStop(1, 'rgba(60,50,40,0.18)');
    ctx.fillStyle = grime;
    ctx.fillRect(ox, oy + 200, 128, 56);
    for (let s = 0; s < 4; s++) {
      const sx = ox + 40 + hash2(s, oy, 274) * 48;
      ctx.fillStyle = `rgba(70,60,50,${0.05 + hash2(ox, s, 275) * 0.06})`;
      ctx.fillRect(sx, oy + 150, 3 + hash2(s, ox, 276) * 3, 40 + hash2(oy, s, 277) * 30);
    }
    // bay edge + floor line + dark plinth strip at the base
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(ox, oy, 128, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(ox, oy, 4, 256);
    // K21_ pilaster (sama seperti atlas A): strip terang kiri +
    // bayangan kanan tiap bay — relief dangkal di dinding fasad.
    ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(ox + 4, oy, 6, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(ox + 118, oy, 6, 256);
    // K23_ Target C (Fase 4): cornice lukis di puncak tiap bay (sama
    // seperti atlas A) — garis atap per lantai; 0 tris.
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(ox, oy, 128, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(ox, oy + 9, 128, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(ox, oy + 244, 128, 12);
    ctx.fillStyle = '#6b5d4f'; ctx.fillRect(ox, oy + 226, 128, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(ox, oy + 226, 128, 2);
    // frame: bigger than K17_ (glass 64x150 inside a 128x256 bay)
    ctx.fillStyle = '#23282f';
    ctx.fillRect(ox + 28, oy + 4, 72, 158);
    // glass per variant
    const glass = ctx.createLinearGradient(0, oy + 12, 0, oy + 154);
    if (kind === 'shutter') { glass.addColorStop(0, '#9db4c4'); glass.addColorStop(1, '#5d7f95'); }
    else if (kind === 'litAC') { glass.addColorStop(0, '#ffd98a'); glass.addColorStop(1, '#ef9d3e'); }
    else if (kind === 'rail') { glass.addColorStop(0, '#6f8ea6'); glass.addColorStop(1, '#3c5a72'); }
    else { glass.addColorStop(0, '#2c3644'); glass.addColorStop(1, '#161d29'); }
    ctx.fillStyle = glass;
    ctx.fillRect(ox + 32, oy + 12, 64, 142);
    // diagonal glint (two for the bright bays, one faint for the rest)
    const slash = (x0, x1, alpha) => {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(ox + x0, oy + 154); ctx.lineTo(ox + x0 + 14, oy + 12);
      ctx.lineTo(ox + x1, oy + 12); ctx.lineTo(ox + x1 - 14, oy + 154);
      ctx.closePath(); ctx.fill();
    };
    if (kind === 'shutter') { slash(6, 20, 0.30); slash(36, 46, 0.16); }
    else if (kind === 'litAC') { slash(10, 22, 0.14); }
    else if (kind === 'rail') { slash(12, 22, 0.12); }
    else { slash(14, 24, 0.08); }
    // shutters: white side panels with a louvre line each
    if (kind === 'shutter') {
      ctx.fillStyle = 'rgba(246,243,232,0.92)';
      ctx.fillRect(ox + 32, oy + 12, 12, 142);
      ctx.fillRect(ox + 84, oy + 12, 12, 142);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (const sy of [40, 70, 100, 130]) {
        ctx.fillRect(ox + 32, oy + sy, 12, 2);
        ctx.fillRect(ox + 84, oy + sy, 12, 2);
      }
    }
    // lit bay: cream curtains both sides + AC grille below the glass
    if (kind === 'litAC') {
      ctx.fillStyle = 'rgba(250,240,210,0.92)';
      ctx.fillRect(ox + 32, oy + 12, 14, 142);
      ctx.fillRect(ox + 82, oy + 12, 14, 142);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(ox + 40, oy + 12, 2, 142);
      ctx.fillRect(ox + 88, oy + 12, 2, 142);
      ctx.fillStyle = '#3a3f45';
      ctx.fillRect(ox + 38, oy + 168, 52, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      for (const gy of [174, 180, 186]) ctx.fillRect(ox + 42, oy + gy, 44, 2);
    }
    // blinds: many horizontal slats over dark glass
    if (kind === 'blinds') {
      ctx.fillStyle = 'rgba(232,230,222,0.55)';
      for (const by of [26, 48, 70, 92, 114, 136]) ctx.fillRect(ox + 32, oy + by, 64, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (const by of [31, 53, 75, 97, 119, 141]) ctx.fillRect(ox + 32, oy + by, 64, 1);
    }
    // Juliet rail: two dark horizontal bars + thin verticals across
    // the lower half of the glass
    if (kind === 'rail') {
      ctx.fillStyle = '#23282f';
      ctx.fillRect(ox + 32, oy + 92, 64, 5);
      ctx.fillRect(ox + 32, oy + 122, 64, 5);
      for (const vx of [40, 56, 72, 88]) ctx.fillRect(ox + vx, oy + 92, 3, 35);
    }
    // mullion cross + sill (wider glass => mullion at the middle)
    ctx.fillStyle = '#23282f';
    ctx.fillRect(ox + 62, oy + 12, 4, 142);
    ctx.fillRect(ox + 32, oy + 80, 64, 4);
    ctx.fillStyle = '#ddd5c0';
    ctx.fillRect(ox + 26, oy + 162, 76, 8);
  };
  paintBay(0, 0, 'shutter');
  paintBay(128, 0, 'blinds');
  paintBay(0, 256, 'litAC');
  paintBay(128, 256, 'rail');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(256, 0, 256, 512);
  return K18_texture(cv);
}

// ---- beach tone overlay --------------------------------------------------
// K18_beachToneTexture: 256 px tile, low-frequency fbm only — very large
// soft tonal patches (warm gold / pale cream / pink-grey) that break the
// flat wash at long distance. Meant to tile at ~256 m per tile, as a
// third Lambert overlay over the sand (after the K17_ tone + detail
// layers), opacity ~0.35.
export function K18_beachToneTexture() {
  const S = 256;
  const cv = K18_canvas(S, S);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;
  const lat = (size, seed) => {
    const draw = mulberry32(seed);
    const grid = new Float32Array(size * size);
    for (let i = 0; i < grid.length; i++) grid[i] = draw();
    return { size, grid };
  };
  const sample = (l, x, y) => {
    const { size, grid } = l;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % size) + size) % size, x1 = (x0 + 1) % size;
    const y0 = ((yi % size) + size) % size, y1 = (y0 + 1) % size;
    const a = grid[y0 * size + x0], b = grid[y0 * size + x1];
    const c = grid[y1 * size + x0], d = grid[y1 * size + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (lattices, u, v, freq, octaves) => {
    let sum = 0, amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += sample(lattices[o % lattices.length], u * freq, v * freq) * amp;
      total += amp; amp *= 0.5; freq *= 2;
    }
    return sum / total;
  };
  const lattices = [lat(16, 18001), lat(16, 18002), lat(16, 18003)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const tone = fbm(lattices, u, v, 2, 3);
      const pink = fbm(lattices, u + 0.47, v + 0.31, 3, 2);
      // pale cream -> warm gold, with a pink-grey drift at high `pink`
      const r = 240 - 36 * tone - 6 * pink;
      const g = 222 - 54 * tone - 2 * pink;
      const b = 184 - 74 * tone + 16 * pink;
      const i = (y * S + x) * 4;
      data[i] = clamp(r, 0, 255);
      data[i + 1] = clamp(g, 0, 255);
      data[i + 2] = clamp(b, 0, 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // a few pale shell flecks so the tile is not pure gradient
  const draw = mulberry32(18011);
  for (let i = 0; i < 40; i++) {
    const x = draw() * S, y = draw() * S, r = 1 + draw() * 2;
    ctx.fillStyle = draw() < 0.6 ? 'rgba(255,246,230,0.85)' : 'rgba(238,178,168,0.85)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return K18_texture(cv);
}
