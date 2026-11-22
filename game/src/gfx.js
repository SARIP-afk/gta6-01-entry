// Solmarina — renderer, rewritten fresh for the repair round.
// Blocky but detailed: no flat surfaces. Static geometry is merged into
// a few vertex-coloured soups; anything repeated (windows, fronds,
// wheels, bulbs, peds) lives in InstancedMesh pools. Emissive-looking
// detail uses MeshBasicMaterial so it stays readable at night without
// touching the day/night light rig. All variation comes from hash2 /
// seeded mulberry32 — never Math.random — so rendering can never move
// the sim trace.
import * as THREE from '../vendor/three.module.min.js';
import { hash2, mulberry32, clamp, lerp } from './util.js';
import {
  ROAD_STEP, GRID_MIN, GRID_MAX, ROAD_HALF, BEACH_Z, SEA_Z, PIER,
  CAUSEWAY_Z, MARKET, STADIUM, WORLD,
} from './layout.js';
import {
  K17_sandDetailTexture, K17_sandToneTexture, K17_wetSandTexture,
  K17_seaTexture, K17_foamTexture, K17_buildClouds,
} from './K17_textures.js';

// Day parts. The sun disc, sky dome, sea tint and glitter all read from
// here through paletteAt(hour), which blends between the keys.
const DAY = { sun: 0xffdf9e, hemiSky: 0xbfd9ff, hemiGround: 0x8a7a5a, fog: 0xcfe0ee, bg: 0x87b5d9, sunI: 1.25, hemiI: 0.85 };
const SUNSET = { sun: 0xff9a4d, hemiSky: 0xe8a06a, hemiGround: 0x5a4a3a, fog: 0xe8a06a, bg: 0xf2a35e, sunI: 1.2, hemiI: 0.95 };
const NIGHT = { sun: 0x8fa8ff, hemiSky: 0x1c2440, hemiGround: 0x0e0c10, fog: 0x141a2e, bg: 0x0d1226, sunI: 0.4, hemiI: 0.5 };
const SUNSET_ZENITH = new THREE.Color(0x4a2358); // purple top of a sunset sky
const SUNSET_MID = new THREE.Color(0xa83a68);    // pink mid-sky
const SUNSET_SEA = new THREE.Color(0xff8a4d);    // orange band at the horizon
const AWN_ACCENTS = ['#f28482', '#81b29a', '#f4a261', '#a78bfa', '#4fc3f7', '#f2c94c'];
const CORNICE_ACCENTS = ['#3fa8a0', '#b3402e', '#d4af37', '#2c4a6b', '#e8e0cc'];
// K9_ saturated facades: one loud colour per building (pink / teal /
// yellow / green / orange / gold / magenta / sea-blue), picked by hash,
// so the skyline reads as a coloured city at cover distance instead of
// one mauve-brown mass. The old wash (15-35% tint over a brown base)
// let the brown base dominate — that is gone.
const K9_FACADE_COLORS = ['#e84393', '#2ec4b6', '#ffd166', '#06d6a0', '#f4845f', '#e9c46a', '#d81159', '#118ab2'];

function rgbFromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function tinted(hex, f) {
  const [r, g, b] = rgbFromHex(hex);
  return [clamp(r * f, 0, 1), clamp(g * f, 0, 1), clamp(b * f, 0, 1)];
}
function pickFrom(arr, h) {
  return arr[Math.floor(h * arr.length) % arr.length];
}

/**
 * Merged vertex-coloured boxes. A box can carry facade options (uvOpts):
 * its side faces then sample the window-bay tile of the facade atlas,
 * one bay across per bay width and one floor up per floor height. Boxes
 * without those options — and every roof/floor face — sample the plain
 * white half of the atlas, so their vertex colour passes through
 * unchanged. UVs carry raw repeat counts and the texture wraps, which
 * is what makes the tile repeat across a whole face from corner
 * vertices alone.
 */
export class BoxSoup {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.idx = []; this.uv = [];
    this.v = 0;
  }
  add(x, y, z, sx, sy, sz, color, ry = 0, rz = 0, rx = 0, uvOpts = null) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Matrix4();
    m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const ix = g.index.array;
    const tuv = g.attributes.uv.array;
    const c = typeof color === 'string' ? rgbFromHex(color) : color;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      // Bake a little top light / bottom shade into the vertex colour.
      const f = n[i + 1] > 0.5 ? 1.12 : n[i + 1] < -0.5 ? 0.82 : 1;
      this.col.push(clamp(c[0] * f, 0, 1), clamp(c[1] * f, 0, 1), clamp(c[2] * f, 0, 1));
      if (!uvOpts || Math.abs(n[i + 1]) > 0.5) { this.uv.push(0.75, 0.5); continue; }
      const alongX = Math.abs(n[i]) > 0.5;
      const span = alongX ? sz : sx;
      const bay = alongX ? uvOpts.bz : uvOpts.bx;
      const repeats = tuv[(i / 3) * 2] * (span / bay);
      const floorsUp = (p[i + 1] - uvOpts.y0) / uvOpts.floorH;
      this.uv.push(0.5 * repeats, floorsUp);
    }
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + this.v);
    this.v += p.length / 3;
    g.dispose();
  }
  build(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return new THREE.Mesh(g, material);
  }
}

function lambertVertex() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}
function basicVertex() {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

/** 4096 px ground canvas: block lots, market tiles, sand, asphalt. */
function groundTexture(layout) {
  const S = 4096;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const W = WORLD.x1 - WORLD.x0, H = WORLD.z1 - WORLD.z0;
  const px = (x) => ((x - WORLD.x0) / W) * S;
  const pz = (z) => ((z - WORLD.z0) / H) * S;
  const mpp = S / W; // pixels per metre
  // base: weathered concrete
  ctx.fillStyle = '#8f8f86'; ctx.fillRect(0, 0, S, S);
  // block interiors: grass / concrete / dirt lots, hash-shaded + speckled
  for (let bx = GRID_MIN; bx < GRID_MAX; bx += ROAD_STEP) {
    for (let bz = GRID_MIN; bz < GRID_MAX; bz += ROAD_STEP) {
      const h = hash2(bx, bz, 3);
      const x0 = px(bx + ROAD_HALF), z0 = pz(bz + ROAD_HALF);
      const w = (ROAD_STEP - 2 * ROAD_HALF) * mpp, d = (ROAD_STEP - 2 * ROAD_HALF) * mpp;
      if (bz >= BEACH_Z) continue;
      if (h < 0.3) ctx.fillStyle = '#7d9b62';
      else if (h < 0.55) ctx.fillStyle = '#98998e';
      else if (h < 0.75) ctx.fillStyle = '#a89a7d';
      else ctx.fillStyle = '#8a8d84';
      ctx.fillRect(x0, z0, w, d);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.03 + hash2(bx + i, bz, 5) * 0.06})`;
        ctx.fillRect(x0 + hash2(i, bz, 6) * w, z0 + hash2(bx, i, 7) * d, 3, 3);
      }
    }
  }
  // --- market plaza: 4 m tiles, grout + per-tile shade ---
  const tx0 = px(MARKET.x - 24), tz0 = pz(MARKET.z - 24);
  const tw = 48 * mpp;
  ctx.fillStyle = '#b8a88f'; ctx.fillRect(tx0, tz0, tw, tw);
  const tile = 4 * mpp;
  for (let ix = 0; ix < 12; ix++) {
    for (let iz = 0; iz < 12; iz++) {
      const h = hash2(ix, iz, 9);
      ctx.fillStyle = h < 0.33 ? '#c2b096' : h < 0.66 ? '#b3a184' : '#cbb99e';
      ctx.fillRect(tx0 + ix * tile + 1, tz0 + iz * tile + 1, tile - 2, tile - 2);
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
  for (let i = 0; i <= 12; i++) {
    ctx.beginPath(); ctx.moveTo(tx0 + i * tile, tz0); ctx.lineTo(tx0 + i * tile, tz0 + tw); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx0, tz0 + i * tile); ctx.lineTo(tx0 + tw, tz0 + i * tile); ctx.stroke();
  }
  // --- beach sand: dune bands, soft blotches, speckle, pebbles ---
  const sandZ = pz(BEACH_Z), sandH = pz(SEA_Z) - sandZ;
  ctx.fillStyle = '#e8d5a3'; ctx.fillRect(0, sandZ, S, sandH);
  for (let b = 0; b < 8; b++) {
    ctx.fillStyle = b % 2 ? 'rgba(190,160,110,0.35)' : 'rgba(255,240,200,0.3)';
    ctx.fillRect(0, sandZ + b * (sandH / 8), S, sandH / 16);
  }
  const blotchTones = ['rgba(210,180,130,', 'rgba(240,220,170,', 'rgba(170,140,95,'];
  for (let i = 0; i < 140; i++) {
    const tone = blotchTones[Math.floor(hash2(i, 21, 1) * blotchTones.length) % blotchTones.length];
    ctx.fillStyle = `${tone}${0.05 + hash2(i, 22, 1) * 0.09})`;
    const bw = 8 + hash2(i, 23, 1) * 34, bh = 5 + hash2(i, 24, 1) * 18;
    ctx.beginPath();
    ctx.ellipse(hash2(i, 25, 1) * S, sandZ + hash2(i, 26, 1) * sandH, bw, bh, hash2(i, 27, 1) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(120,95,60,${0.08 + hash2(i, 77, 1) * 0.12})`;
    ctx.fillRect(hash2(i, 3, 2) * S, sandZ + hash2(i, 5, 2) * sandH, 3, 2);
  }
  // chunky gravel: bigger grey pebbles so the sand reads granular up close
  for (let i = 0; i < 220; i++) {
    const grey = 100 + Math.floor(hash2(i, 31, 1) * 100);
    ctx.fillStyle = `rgba(${grey},${grey - 8},${grey - 18},0.85)`;
    const s = 2 + Math.floor(hash2(i, 34, 1) * 3);
    ctx.fillRect(hash2(i, 32, 1) * S, sandZ + hash2(i, 33, 1) * sandH, s, s);
  }
  // wet waterline strip, then the enriched foreground dressing
  ctx.fillStyle = 'rgba(160,130,90,0.45)';
  ctx.fillRect(0, pz(SEA_Z - 6), S, 6 * mpp);
  // 60 wandering footprint trails across the beach
  ctx.fillStyle = 'rgba(120,95,60,0.28)';
  for (let trail = 0; trail < 60; trail++) {
    const startX = hash2(trail, 11, 1) * S;
    const startZ = sandZ + hash2(trail, 12, 1) * sandH;
    for (let step = 0; step < 8; step++) {
      ctx.fillRect(startX + step * 4, startZ + Math.sin(step * 0.8) * 6, 3, 2);
    }
  }
  // 180 shell flecks, pale and pink
  for (let speck = 0; speck < 180; speck++) {
    const pale = hash2(speck, 13, 1) < 0.5;
    ctx.fillStyle = pale ? 'rgba(255,245,230,0.85)' : 'rgba(230,180,180,0.85)';
    ctx.fillRect(hash2(speck, 14, 1) * S, sandZ + hash2(speck, 15, 1) * sandH, 2, 2);
  }
  // seaweed strokes washed up near the waterline
  for (let wI = 0; wI < 90; wI++) {
    ctx.strokeStyle = `rgba(40,90,45,${0.25 + hash2(wI, 41, 1) * 0.3})`;
    ctx.lineWidth = 2;
    const wx = hash2(wI, 42, 1) * S;
    const wz = pz(SEA_Z - 8) + hash2(wI, 43, 1) * 8 * mpp;
    ctx.beginPath(); ctx.moveTo(wx, wz);
    ctx.lineTo(wx + (hash2(wI, 44, 1) - 0.5) * 14, wz + (hash2(wI, 45, 1) - 0.5) * 6);
    ctx.stroke();
  }
  // --- roads: asphalt + edge lines + centre dashes + crosswalks ---
  ctx.fillStyle = '#45484d';
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) {
    ctx.fillRect(0, pz(v - ROAD_HALF), S, 2 * ROAD_HALF * mpp);
    ctx.fillRect(px(v - ROAD_HALF), 0, 2 * ROAD_HALF * mpp, S);
  }
  ctx.fillRect(px(GRID_MAX), pz(CAUSEWAY_Z - ROAD_HALF), px(PIER.x) - px(GRID_MAX), 2 * ROAD_HALF * mpp);
  // Kumala asphalt wear, all hash-placed on the road strips:
  // twin tyre-wear bands per road, 90 wear blotches, 40 cracks,
  // 16 repair patches, 24 oil stains, 1400 speckle grains.
  const roadLines = [];
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) roadLines.push(v);
  const roadPoint = (i, salt) => {
    const line = roadLines[Math.floor(hash2(i, salt, 1) * roadLines.length) % roadLines.length];
    const along = GRID_MIN + hash2(i, salt + 1, 1) * (GRID_MAX - GRID_MIN);
    const off = (hash2(i, salt + 2, 1) - 0.5) * 2 * (ROAD_HALF - 0.5);
    return hash2(i, salt + 3, 1) < 0.5
      ? { x: along, z: line + off }
      : { x: line + off, z: along };
  };
  // tyre-wear bands: two dark wheel tracks either side of each centreline
  ctx.fillStyle = 'rgba(18,18,22,0.20)';
  for (const v of roadLines) {
    for (const off of [-1.8, 1.8]) {
      ctx.fillRect(0, pz(v + off - 0.6), S, 1.2 * mpp);
      ctx.fillRect(px(v + off - 0.6), 0, 1.2 * mpp, S);
    }
  }
  // 90 soft wear blotches
  for (let i = 0; i < 90; i++) {
    const p = roadPoint(i, 101);
    ctx.fillStyle = `rgba(25,25,28,${0.10 + hash2(i, 102, 1) * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(px(p.x), pz(p.z), (4 + hash2(i, 103, 1) * 10) * mpp, (2 + hash2(i, 104, 1) * 5) * mpp, hash2(i, 105, 1) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 40 jagged cracks
  ctx.strokeStyle = 'rgba(15,15,18,0.4)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) {
    const p = roadPoint(i, 111);
    let cx = px(p.x), cz = pz(p.z);
    ctx.beginPath(); ctx.moveTo(cx, cz);
    for (let k = 0; k < 5; k++) {
      cx += (hash2(i, 112 + k, 1) - 0.5) * 10 * mpp;
      cz += (hash2(i, 117 + k, 1) - 0.5) * 10 * mpp;
      ctx.lineTo(cx, cz);
    }
    ctx.stroke();
  }
  // 16 darker repair patches with a pale seam
  for (let i = 0; i < 16; i++) {
    const p = roadPoint(i, 121);
    const w = (2 + hash2(i, 122, 1) * 2) * mpp, d = (1.5 + hash2(i, 123, 1) * 1.5) * mpp;
    ctx.fillStyle = 'rgba(28,28,32,0.45)';
    ctx.fillRect(px(p.x) - w / 2, pz(p.z) - d / 2, w, d);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    ctx.strokeRect(px(p.x) - w / 2, pz(p.z) - d / 2, w, d);
  }
  // 24 oil stains near the centrelines
  for (let i = 0; i < 24; i++) {
    const p = roadPoint(i, 131);
    const r = (0.8 + hash2(i, 132, 1) * 1.4) * mpp;
    const grad = ctx.createRadialGradient(px(p.x), pz(p.z), 0, px(p.x), pz(p.z), r);
    grad.addColorStop(0, 'rgba(10,10,14,0.5)');
    grad.addColorStop(0.7, 'rgba(12,12,16,0.28)');
    grad.addColorStop(1, 'rgba(12,12,16,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), r, 0, Math.PI * 2); ctx.fill();
  }
  // 1400 speckle grains across the asphalt
  for (let i = 0; i < 1400; i++) {
    const p = roadPoint(i, 141);
    const light = hash2(i, 142, 1) < 0.4;
    ctx.fillStyle = light ? `rgba(220,220,210,${0.05 + hash2(i, 143, 1) * 0.08})` : `rgba(0,0,0,${0.05 + hash2(i, 144, 1) * 0.09})`;
    ctx.fillRect(px(p.x), pz(p.z), 2, 2);
  }
  // lane furniture: edge lines, yellow centre dashes, crosswalks
  ctx.fillStyle = '#f7f3e0';
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) {
    ctx.fillRect(0, pz(v - ROAD_HALF) + 2, S, 2);
    ctx.fillRect(0, pz(v + ROAD_HALF) - 4, S, 2);
    ctx.fillRect(px(v - ROAD_HALF) + 2, 0, 2, S);
    ctx.fillRect(px(v + ROAD_HALF) - 4, 0, 2, S);
  }
  ctx.fillStyle = '#e8c33c';
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) {
    for (let u = GRID_MIN; u <= GRID_MAX; u += 12) {
      ctx.fillRect(px(u), pz(v) - 1.5, 6 * mpp, 3);
      ctx.fillRect(px(v) - 1.5, pz(u), 3, 6 * mpp);
    }
  }
  ctx.fillStyle = 'rgba(247,243,224,0.9)';
  for (let a = GRID_MIN; a <= GRID_MAX; a += ROAD_STEP) {
    for (let b = GRID_MIN; b <= GRID_MAX; b += ROAD_STEP) {
      for (let k = -2; k <= 2; k++) {
        ctx.fillRect(px(a + k * 2.4) - 2, pz(b - ROAD_HALF), 4, 3 * mpp);
        ctx.fillRect(px(a - ROAD_HALF), pz(b + k * 2.4) - 2, 3 * mpp, 4);
      }
    }
  }
  // sidewalk borders around each block
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
  for (let bx = GRID_MIN; bx < GRID_MAX; bx += ROAD_STEP) {
    for (let bz = GRID_MIN; bz < GRID_MAX; bz += ROAD_STEP) {
      if (bz >= BEACH_Z) continue;
      ctx.strokeRect(px(bx + ROAD_HALF), pz(bz + ROAD_HALF), (ROAD_STEP - 2 * ROAD_HALF) * mpp, (ROAD_STEP - 2 * ROAD_HALF) * mpp);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Sand grain tile, seeded — never Math.random. Two planes sample it at
 * different repeats over the beach so the close sand reads granular
 * instead of one flat wash.
 */
function sandGrainCanvas(seed = 20261121) {
  const draw = mulberry32(seed);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = draw() * S, y = draw() * S;
    const dark = draw() < 0.55;
    ctx.fillStyle = dark ? `rgba(120,95,60,${0.10 + draw() * 0.22})` : `rgba(255,240,200,${0.10 + draw() * 0.22})`;
    const s = 1 + Math.floor(draw() * 2);
    ctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(140,110,70,${0.08 + draw() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(draw() * S, draw() * S, 4 + draw() * 10, 3 + draw() * 6, draw() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fine speckle tile tiled over the whole ground as one overlay plane. */
function groundGrainCanvas() {
  const draw = mulberry32(20261121 + 99);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 3200; i++) {
    const x = draw() * S, y = draw() * S;
    ctx.fillStyle = draw() < 0.5
      ? `rgba(0,0,0,${0.06 + draw() * 0.12})`
      : `rgba(255,255,255,${0.05 + draw() * 0.10})`;
    ctx.fillRect(x, y, 1 + Math.floor(draw() * 2), 1 + Math.floor(draw() * 2));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(192, 168);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function seaTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#4a9ec2'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + hash2(i, 1, 1) * 0.16})`;
    ctx.lineWidth = 1 + hash2(i, 2, 1) * 2;
    const y = hash2(i, 3, 1) * 512, x = hash2(i, 4, 1) * 512, len = 20 + hash2(i, 5, 1) * 60;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + (hash2(i, 6, 1) - 0.5) * 8); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Facade atlas, 512x256. The left half is one window bay (6 m wide, one
 * 3.4 m floor tall): framed glass with TWO diagonal reflections — the
 * second one is what makes the glass read as glass instead of a grey
 * slab at 2K — plus mullion cross, sill and floor line. The right half
 * is plain white: every non-facade box samples it, so its vertex colour
 * is untouched. The tile ground is near-white, so it multiplies the
 * pastel facade colour instead of covering it.
 */
function facadeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  const paint = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  paint('#f6f2e8', 0, 0, 256, 256);
  paint('#ffffff', 256, 0, 256, 256);
  paint('rgba(0,0,0,0.10)', 0, 0, 256, 6);
  paint('rgba(0,0,0,0.20)', 0, 244, 256, 12);
  paint('rgba(0,0,0,0.08)', 0, 0, 6, 256);
  paint('rgba(0,0,0,0.08)', 250, 0, 6, 256);
  // frame: wide enough to read at cover distance, centred on the
  // instanced glass box (glass centre 2.6 m up the band = canvas y ~68)
  paint('#2a2f38', 72, 4, 112, 128);
  const glass = ctx.createLinearGradient(0, 12, 0, 124);
  glass.addColorStop(0, '#7a93a6');
  glass.addColorStop(1, '#4a6578');
  paint(glass, 80, 12, 96, 112);
  // first reflection: bright diagonal slash, top-left to bottom-right
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.moveTo(96, 124); ctx.lineTo(120, 12); ctx.lineTo(132, 12); ctx.lineTo(108, 124);
  ctx.closePath(); ctx.fill();
  // second reflection: fainter, steeper slash on the right half — the
  // double glint is what sells the pane as glass at 2K
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(140, 124); ctx.lineTo(158, 12); ctx.lineTo(166, 12); ctx.lineTo(148, 124);
  ctx.closePath(); ctx.fill();
  // mullion cross + sill
  paint('#2a2f38', 124, 12, 8, 112);
  paint('#2a2f38', 80, 64, 96, 8);
  paint('#ddd5c0', 68, 132, 120, 8);
  // faint plaster speckle so the wall is never one flat wash
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + hash2(i, 51, 1) * 0.05})`;
    ctx.fillRect(8 + hash2(i, 52, 1) * 240, 150 + hash2(i, 53, 1) * 90, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tapered car body: a box whose top vertices pull inward — sculpted, not a slab. */
function taperedBody(len, wid, hgt, taper = 0.82) {
  const g = new THREE.BoxGeometry(len, hgt, wid, 2, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) * taper); p.setZ(i, p.getZ(i) * 0.9); }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// The renderer proper.
// ---------------------------------------------------------------------------
const PALETTE_KEYS = [
  [0, NIGHT], [5, NIGHT], [7, DAY], [16, DAY], [18, SUNSET], [19.5, NIGHT], [24, NIGHT],
];
function paletteAt(hour) {
  let a = PALETTE_KEYS[0], b = PALETTE_KEYS[PALETTE_KEYS.length - 1];
  for (let i = 0; i < PALETTE_KEYS.length - 1; i++) {
    if (hour >= PALETTE_KEYS[i][0] && hour <= PALETTE_KEYS[i + 1][0]) { a = PALETTE_KEYS[i]; b = PALETTE_KEYS[i + 1]; break; }
  }
  const t = clamp((hour - a[0]) / Math.max(0.001, b[0] - a[0]), 0, 1);
  const mix = (ka) => {
    if (ka === 'sunI' || ka === 'hemiI') return lerp(a[1][ka], b[1][ka], t);
    const ca = new THREE.Color(a[1][ka]), cb = new THREE.Color(b[1][ka]);
    return ca.lerp(cb, t);
  };
  return { sun: mix('sun'), hemiSky: mix('hemiSky'), hemiGround: mix('hemiGround'), fog: mix('fog'), bg: mix('bg'), sunI: mix('sunI'), hemiI: mix('hemiI') };
}

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const sunDirTmp = new THREE.Vector3(); // reused: update() used to `new` one per frame

// ---- R7 fresh dressing: Kumala street / beach / sea dressing, repair round 7 ----
// Written fresh from the prose spec. Deterministic: every placement derives
// from an integer hash of its index, so repeated builds are identical.
const R7_CORNICE_COLORS = ['#3fa8a0', '#b3402e', '#d4af37', '#2c4a6b', '#e8e0cc'];
const R7_AWNING_COLORS = ['#f28482', '#81b29a', '#f4a261', '#a78bfa', '#4fc3f7', '#f2c94c'];
const R7_TOWEL_COLORS = ['#f28482', '#81b29a', '#f4a261', '#a78bfa', '#4fc3f7', '#f2c94c', '#ff595e', '#ffca3a'];
const R7_BOARD_COLORS = ['#f28482', '#f2c94c', '#4fc3f7', '#f5f2e8', '#81b29a', '#ff595e'];
const R7_ROAD_LINES = [-288, -240, -192, -144, -96, -48, 0, 48, 96, 144, 192, 240, 288];
const R7_EVEN_LINES = [-288, -192, -96, 0, 96, 192, 288];

function R7_hash(n) {
  let x = (Math.imul(n | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function R7_pick(list, n) { return list[Math.floor(R7_hash(n) * list.length) % list.length]; }
function R7_range(n, lo, hi) { return lo + R7_hash(n) * (hi - lo); }

const R7_unitBox = new THREE.BoxGeometry(1, 1, 1);
const R7_dummy = new THREE.Object3D();
function R7_put(mesh, i, x, y, z, rx, ry, rz, sx, sy, sz, order) {
  R7_dummy.position.set(x, y, z);
  R7_dummy.rotation.set(rx || 0, ry || 0, rz || 0, order || 'XYZ');
  R7_dummy.scale.set(sx || 1, sy || 1, sz || 1);
  R7_dummy.updateMatrix();
  mesh.setMatrixAt(i, R7_dummy.matrix);
}
function R7_soup(scene, geo, mat, count) {
  if (!count) return null;
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  scene.add(m);
  return m;
}
function R7_finish(mesh) {
  if (!mesh) return;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
function R7_canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function R7_canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function R7_asphaltTexture() {
  const W = 2048;
  const H = 1792;
  const [c, g] = R7_canvas(W, H);
  const px = (x) => (x + 336) * (W / 768);
  const py = (z) => (z + 336) * (H / 672);
  g.clearRect(0, 0, W, H);
  const line = (x0, y0, x1, y1, color, width, alpha) => {
    g.strokeStyle = color;
    g.globalAlpha = alpha;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.globalAlpha = 1;
  };
  for (const v of R7_ROAD_LINES) {
    line(px(v - 0.35), py(-288), px(v - 0.35), py(288), '#c19a2b', 2, 0.9);
    line(px(v + 0.35), py(-288), px(v + 0.35), py(288), '#c19a2b', 2, 0.9);
    line(px(v - 5.5), py(-288), px(v - 5.5), py(288), '#f5f2e8', 2, 0.7);
    line(px(v + 5.5), py(-288), px(v + 5.5), py(288), '#f5f2e8', 2, 0.7);
    line(px(-288), py(v - 0.35), px(288), py(v - 0.35), '#c19a2b', 2, 0.9);
    line(px(-288), py(v + 0.35), px(288), py(v + 0.35), '#c19a2b', 2, 0.9);
    line(px(-288), py(v - 5.5), px(288), py(v - 5.5), '#f5f2e8', 2, 0.7);
    line(px(-288), py(v + 5.5), px(288), py(v + 5.5), '#f5f2e8', 2, 0.7);
  }
  g.strokeStyle = '#f5f2e8';
  g.globalAlpha = 0.65;
  g.lineWidth = 2;
  g.setLineDash([8, 12]);
  for (const v of R7_ROAD_LINES) {
    for (const off of [-2.75, 2.75]) {
      g.beginPath();
      g.moveTo(px(v + off), py(-288));
      g.lineTo(px(v + off), py(288));
      g.stroke();
      g.beginPath();
      g.moveTo(px(-288), py(v + off));
      g.lineTo(px(288), py(v + off));
      g.stroke();
    }
  }
  g.setLineDash([]);
  g.globalAlpha = 1;
  g.fillStyle = '#f5f2e8';
  for (const vx of R7_EVEN_LINES) {
    for (const hz of R7_EVEN_LINES) {
      for (let k = -2; k <= 2; k++) {
        const off = k * 6;
        g.globalAlpha = 0.85;
        g.fillRect(px(vx + off) - 1.4, py(hz) - 6, 2.8, 12);
        g.fillRect(px(vx) - 6, py(hz + off) - 1.4, 12, 2.8);
      }
    }
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 240; i++) {
    const vert = R7_hash(i * 3 + 11) < 0.5;
    const road = R7_pick(R7_ROAD_LINES, i * 5 + 7);
    const along = R7_range(i * 7 + 1, -280, 280);
    const side = R7_range(i * 11 + 2, -5, 5);
    const cx = vert ? px(road + side) : px(along);
    const cy = vert ? py(along) : py(road + side);
    const rx = R7_range(i * 13 + 3, 5, 16);
    const ry = R7_range(i * 17 + 4, 4, 10);
    g.fillStyle = 'rgba(18,14,10,0.12)';
    g.globalAlpha = 0.6 + R7_hash(i * 19 + 5) * 0.4;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, R7_range(i * 23 + 6, 0, Math.PI), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 40; i++) {
    const vert = R7_hash(i * 3 + 21) < 0.5;
    const road = R7_pick(R7_ROAD_LINES, i * 5 + 31);
    let cx = vert ? px(road + R7_range(i * 7 + 41, -5, 5)) : px(R7_range(i * 7 + 41, -280, 280));
    let cy = vert ? py(R7_range(i * 11 + 51, -280, 280)) : py(road + R7_range(i * 11 + 51, -5, 5));
    g.strokeStyle = 'rgba(12,10,8,0.45)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, cy);
    for (let s = 0; s < 3; s++) {
      cx += R7_range(i * 29 + s * 7 + 61, -7, 7);
      cy += R7_range(i * 31 + s * 7 + 71, -7, 7);
      g.lineTo(cx, cy);
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(15,12,10,0.08)';
  g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const road = R7_ROAD_LINES[i % R7_ROAD_LINES.length];
    const off = (i % 2 === 0 ? -2.75 : 2.75) + (R7_hash(i + 101) - 0.5) * 0.4;
    const horiz = R7_hash(i + 201) < 0.5;
    const wob = R7_range(i + 301, -3, 3);
    g.beginPath();
    if (horiz) {
      g.moveTo(px(-288), py(road + off));
      g.quadraticCurveTo(px(0), py(road + off + wob), px(288), py(road + off));
    } else {
      g.moveTo(px(road + off), py(-288));
      g.quadraticCurveTo(px(road + off + wob), py(0), px(road + off), py(288));
    }
    g.stroke();
  }
  return R7_canvasTexture(c);
}
function R7_seaTexture() {
  const W = 1024;
  const H = 512;
  const [c, g] = R7_canvas(W, H);
  g.clearRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, 46);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, 46);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 0; x < W; x += 7) {
    const wob = 4 + R7_hash(x * 3 + 5) * 14;
    g.beginPath();
    g.arc(x, 6 + R7_hash(x * 7 + 9) * 8, wob, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const cx = R7_range(i * 13 + 3, 60, W - 60);
    const cy = R7_range(i * 17 + 7, 90, 300);
    const r = R7_range(i * 19 + 11, 42, 110);
    g.globalAlpha = 0.3 + R7_hash(i * 23 + 13) * 0.25;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 2;
  for (let i = 0; i < 110; i++) {
    const x = R7_range(i * 7 + 501, 10, W - 70);
    const y = R7_range(i * 11 + 601, 50, H - 20);
    const len = R7_range(i * 13 + 701, 18, 58);
    const dip = R7_range(i * 17 + 801, -4, 4);
    g.globalAlpha = 0.15 + R7_hash(i * 19 + 901) * 0.2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y + dip, x + len, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  return R7_canvasTexture(c);
}
function R7_sandGrainTexture() {
  const W = 1024;
  const H = 96;
  const [c, g] = R7_canvas(W, H);
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 7000; i++) {
    const x = R7_hash(i * 3 + 11) * W;
    const y = R7_hash(i * 5 + 23) * H;
    g.fillStyle = R7_hash(i * 7 + 37) < 0.5 ? 'rgba(255,244,214,0.5)' : 'rgba(120,90,50,0.45)';
    g.fillRect(x, y, 1.4, 1.4);
  }
  return R7_canvasTexture(c);
}
function R7_sandMarksTexture() {
  const W = 2048;
  const H = 192;
  const [c, g] = R7_canvas(W, H);
  g.clearRect(0, 0, W, H);
  for (let t = 0; t < 6; t++) {
    let x = R7_range(t * 31 + 7, 60, W - 300);
    let y = R7_range(t * 37 + 13, 24, H - 24);
    let dir = R7_range(t * 41 + 17, -0.4, 0.4) + (t % 2 === 0 ? 0 : Math.PI);
    for (let s = 0; s < 18; s++) {
      dir += R7_range(t * 53 + s * 7 + 3, -0.35, 0.35);
      x += Math.cos(dir) * 9;
      y += Math.sin(dir) * 9 * 0.6;
      if (x < 8 || x > W - 8 || y < 8 || y > H - 8) break;
      const side = (s % 2 === 0 ? 1 : -1) * 3.2;
      const nx = x + Math.cos(dir + Math.PI / 2) * side;
      const ny = y + Math.sin(dir + Math.PI / 2) * side;
      g.fillStyle = 'rgba(90,64,32,0.5)';
      g.beginPath();
      g.ellipse(nx, ny, 4.2, 2.1, dir, 0, Math.PI * 2);
      g.fill();
    }
  }
  const shellCols = ['#ffd9c9', '#fff6e0', '#ffb08a', '#f2c94c', '#ffffff'];
  for (let i = 0; i < 42; i++) {
    const x = R7_range(i * 13 + 1001, 10, W - 10);
    const y = R7_range(i * 17 + 1101, 10, H - 10);
    const r = R7_range(i * 19 + 1201, 2.5, 5);
    g.fillStyle = R7_pick(shellCols, i * 23 + 1301);
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(150,90,60,0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, r * 0.55, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  return R7_canvasTexture(c);
}
function R7_roadSide(b) {
  const nx = Math.round(b.x / 48) * 48;
  const nz = Math.round(b.z / 48) * 48;
  const dx = Math.abs(b.x - nx);
  const dz = Math.abs(b.z - nz);
  if (dx <= dz) return { axis: 'x', sign: nx >= b.x ? 1 : -1, len: b.d };
  return { axis: 'z', sign: nz >= b.z ? 1 : -1, len: b.w };
}
// K12_ beach-hero surfboards + near-shore boat, rewritten from scratch.
// The K11 boards were boxes (1.1 x 2.4 x 0.1): at 2K they read as giant
// doors / monoliths flanking the hero, and the Lambert yellow went
// olive-brown under the orange sunset light. These boards are real
// surfboard silhouettes: a tapered outline (pointed nose, rounded tail,
// widest just behind the middle) via THREE.Shape + ExtrudeGeometry,
// 0.08 thick, 0.60 wide, ~2.3 long — a sane scale next to the ~1.8 m
// hero. Bodies use MeshBasicMaterial (unlit) so the yellow renders TRUE
// YELLOW at sunset instead of being dragged olive by the sunset hemi +
// directional lights; the extrude side faces get a slightly darker
// shade of the same hue for a hint of depth. A thin centre stripe +
// nose band follow the taper. Boards lean back ~17 deg and splay so the
// noses point up-and-outward from the hero. The boat is copied unchanged
// from K11 (it already read well) — position (-60, 0, 380), yaw -1.28.
function K12_boardShape(len, hw) {
  // len: total length, hw: half-width at the widest point. Outline in
  // local XY: +Y is nose-ward, +X is across the board. Nose pointed,
  // tail rounded, widest at ~40% up from the tail.
  const s = new THREE.Shape();
  const h = len / 2;
  s.moveTo(0, h);
  s.quadraticCurveTo(hw * 0.45, h * 0.82, hw * 0.72, h * 0.45);
  s.lineTo(hw, -h * 0.05);
  s.lineTo(hw * 0.98, -h * 0.55);
  s.quadraticCurveTo(hw * 0.95, -h * 0.92, hw * 0.55, -h * 0.98);
  s.quadraticCurveTo(hw * 0.28, -h, 0, -h);
  s.quadraticCurveTo(-hw * 0.28, -h, -hw * 0.55, -h * 0.98);
  s.quadraticCurveTo(-hw * 0.95, -h * 0.92, -hw * 0.98, -h * 0.55);
  s.lineTo(-hw, -h * 0.05);
  s.lineTo(-hw * 0.72, h * 0.45);
  s.quadraticCurveTo(-hw * 0.45, h * 0.82, 0, h);
  return s;
}
function K12_heroBeach(scene) {
  const K12_yellowFace = new THREE.MeshBasicMaterial({ color: 0xffd400 });
  const K12_yellowSide = new THREE.MeshBasicMaterial({ color: 0xeab800 });
  const K12_tealFace = new THREE.MeshBasicMaterial({ color: 0x14c8b8 });
  const K12_tealSide = new THREE.MeshBasicMaterial({ color: 0x0e9a8c });
  const K12_red = new THREE.MeshBasicMaterial({ color: 0xe23b2e });
  const K12_white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const K12_dark = new THREE.MeshLambertMaterial({ color: 0x3a2e22 });
  const K12_boatWhite = new THREE.MeshLambertMaterial({ color: 0xf7f2e6 }); // boat: K11 Lambert, untouched
  const K12_wood = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  const K12_navy = new THREE.MeshLambertMaterial({ color: 0x1d4e89 });
  const K12_box = (mat, w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const K12_put = (parent, mesh, x, y, z, rx, ry, rz) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
  };
  // Extruded tapered board: front/back caps + sides, centred on z = 0.
  const K12_extrude = (shape, depth, faceMat, sideMat) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
    g.translate(0, 0, -depth / 2);
    return new THREE.Mesh(g, [faceMat, sideMat]);
  };
  // Fin: small swept triangle, plane perpendicular to the board face.
  const K12_finGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.20, -0.05);
    s.lineTo(0.04, -0.30);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
    g.translate(0, 0, -0.015);
    return g;
  })();
  // --- surfboards: tapered, true-colour, sane scale, leaning in sand ---
  const K12_boards = [
    { x: 10.5, z: 308.5, yaw: 2.05, splay: -0.12, face: K12_yellowFace, side: K12_yellowSide, stripe: K12_red },
    { x: 10.3, z: 305.9, yaw: 1.60, splay: 0.12, face: K12_tealFace, side: K12_tealSide, stripe: K12_white },
  ];
  for (const K12_b of K12_boards) {
    const K12_g = new THREE.Group();
    K12_g.position.set(K12_b.x, 0, K12_b.z);
    K12_g.rotation.y = K12_b.yaw; // broad face toward the beach-hero camera
    scene.add(K12_g);
    const K12_lean = new THREE.Group();
    K12_lean.rotation.x = -0.30; // ~17 deg back, nose up-and-away
    K12_g.add(K12_lean);
    const K12_tilt = new THREE.Group();
    K12_tilt.position.set(0, 1.06, 0); // tail buried ~4 cm in the sand
    K12_tilt.rotation.z = K12_b.splay;
    K12_lean.add(K12_tilt);
    // body: 2.3 long, 0.60 max wide, 0.08 thick
    K12_tilt.add(K12_extrude(K12_boardShape(2.3, 0.30), 0.08, K12_b.face, K12_b.side));
    // centre stripe following the taper, proud of both faces
    K12_tilt.add(K12_extrude(K12_boardShape(1.9, 0.095), 0.10, K12_b.stripe, K12_b.stripe));
    // nose band: a tapered slice across the nose (y 0.72..0.95)
    const K12_band = new THREE.Shape();
    K12_band.moveTo(-0.20, 0.72);
    K12_band.lineTo(0.20, 0.72);
    K12_band.lineTo(0.14, 0.95);
    K12_band.lineTo(-0.14, 0.95);
    K12_band.closePath();
    K12_tilt.add(K12_extrude(K12_band, 0.10, K12_b.stripe, K12_b.stripe));
    // fin under the tail, sticking out the back face
    const K12_fin = new THREE.Mesh(K12_finGeo, K12_dark);
    K12_fin.position.set(0, -0.78, -0.05);
    K12_fin.rotation.y = Math.PI / 2;
    K12_tilt.add(K12_fin);
  }
  // --- near-shore boat at (-60, 380): unchanged from K11, broadside ---
  const K12_boat = new THREE.Group();
  K12_boat.position.set(-60, 0, 380);
  K12_boat.rotation.set(0, -1.28, 0);
  scene.add(K12_boat);
  K12_put(K12_boat, K12_box(K12_boatWhite, 6.5, 1.1, 2.4), 0, 0.55, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_red, 6.54, 0.3, 2.44), 0, 0.75, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_wood, 6.0, 0.25, 2.0), 0, 1.2, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_boatWhite, 2.2, 1.2, 1.6), 0, 1.9, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_navy, 2.24, 0.4, 1.64), 0, 2.0, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_red, 2.5, 0.15, 1.9), 0, 2.55, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_dark, 0.18, 4.5, 0.18), 2.2, 3.55, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(new THREE.MeshLambertMaterial({ color: 0xf2c200 }), 1.1, 0.7, 0.06), 2.75, 5.3, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_red, 0.8, 0.7, 1.4), 3.4, 0.9, 0, 0, 0, 0);
  K12_put(K12_boat, K12_box(K12_wood, 1.0, 0.5, 2.0), -2.6, 1.5, 0, 0, 0, 0);
}
function R7_dressing(scene, L) {
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(768, 672),
    new THREE.MeshLambertMaterial({ map: R7_asphaltTexture(), transparent: true, depthWrite: false })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(48, 0.06, 0);
  asphalt.renderOrder = 2;
  scene.add(asphalt);

  const cornices = [];
  const balconies = [];
  const awnings = [];
  for (let i = 0; i < L.buildings.length; i++) {
    const b = L.buildings[i];
    const side = R7_roadSide(b);
    if (R7_hash(i * 7 + 1) >= 0.19) cornices.push({ b, side, color: R7_pick(R7_CORNICE_COLORS, i * 11 + 2) });
    if (b.h >= 12 && balconies.length < 130 && R7_hash(i * 13 + 5) < 0.45) balconies.push({ b, side });
    if (awnings.length < 200 && R7_hash(i * 17 + 3) < 0.45) awnings.push({ b, side, color: R7_pick(R7_AWNING_COLORS, i * 19 + 4) });
  }
  if (cornices.length > 220) cornices.length = 220;
  const corniceMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), cornices.length);
  if (corniceMesh) {
    cornices.forEach((it, i) => {
      const b = it.b;
      const side = it.side;
      if (side.axis === 'x') R7_put(corniceMesh, i, b.x + side.sign * (b.w / 2 + 0.18), b.h + 0.02, b.z, 0, 0, 0, 0.55, 0.34, side.len + 0.5);
      else R7_put(corniceMesh, i, b.x, b.h + 0.02, b.z + side.sign * (b.d / 2 + 0.18), 0, 0, 0, side.len + 0.5, 0.34, 0.55);
      corniceMesh.setColorAt(i, new THREE.Color(it.color));
    });
    R7_finish(corniceMesh);
  }
  const balMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), balconies.length * 2);
  if (balMesh) {
    balconies.forEach((it, k) => {
      const b = it.b;
      const side = it.side;
      const y = Math.max(4.5, b.h * 0.5);
      const off = (R7_hash(k * 29 + 7) - 0.5) * Math.max(0, side.len - 3.5);
      if (side.axis === 'x') {
        const fx = b.x + side.sign * (b.w / 2);
        R7_put(balMesh, k * 2, fx + side.sign * 0.55, y, b.z + off, 0, 0, 0, 1.15, 0.16, 2.5);
        balMesh.setColorAt(k * 2, new THREE.Color('#d8d2c4'));
        R7_put(balMesh, k * 2 + 1, fx + side.sign * 1.08, y + 0.42, b.z + off, 0, 0, 0, 0.08, 0.7, 2.5);
        balMesh.setColorAt(k * 2 + 1, new THREE.Color('#2a2f38'));
      } else {
        const fz = b.z + side.sign * (b.d / 2);
        R7_put(balMesh, k * 2, b.x + off, y, fz + side.sign * 0.55, 0, 0, 0, 2.5, 0.16, 1.15);
        balMesh.setColorAt(k * 2, new THREE.Color('#d8d2c4'));
        R7_put(balMesh, k * 2 + 1, b.x + off, y + 0.42, fz + side.sign * 1.08, 0, 0, 0, 2.5, 0.7, 0.08);
        balMesh.setColorAt(k * 2 + 1, new THREE.Color('#2a2f38'));
      }
    });
    R7_finish(balMesh);
  }
  const awnMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), awnings.length);
  if (awnMesh) {
    awnings.forEach((it, i) => {
      const b = it.b;
      const side = it.side;
      const off = (R7_hash(i * 31 + 11) - 0.5) * Math.max(0, side.len - 4);
      if (side.axis === 'x') R7_put(awnMesh, i, b.x + side.sign * (b.w / 2 + 0.75), 3.3, b.z + off, 0, 0, -0.45 * side.sign, 1.4, 0.1, 3.2);
      else R7_put(awnMesh, i, b.x + off, 3.3, b.z + side.sign * (b.d / 2 + 0.75), 0.45 * side.sign, 0, 0, 3.2, 0.1, 1.4);
      awnMesh.setColorAt(i, new THREE.Color(it.color));
    });
    R7_finish(awnMesh);
  }

  const barGeo = new THREE.BoxGeometry(0.12, 0.14, 1.3);
  const frontBars = R7_soup(scene, barGeo, new THREE.MeshBasicMaterial({ color: 0xfff6c8 }), L.parked.length);
  const rearBars = R7_soup(scene, barGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a }), L.parked.length);
  if (frontBars && rearBars) {
    L.parked.forEach((p, i) => {
      const co = 2.24 * Math.cos(p.ry);
      const si = 2.24 * Math.sin(p.ry);
      R7_put(frontBars, i, p.x + co, 0.72, p.z - si, 0, p.ry, 0, 1, 1, 1);
      R7_put(rearBars, i, p.x - co, 0.72, p.z + si, 0, p.ry, 0, 1, 1, 1);
    });
    R7_finish(frontBars);
    R7_finish(rearBars);
  }

  const towelMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), L.umbrellas.length);
  if (towelMesh) {
    L.umbrellas.forEach((u, i) => {
      const a = R7_hash(i * 13 + 3) * Math.PI * 2;
      const d = R7_range(i * 17 + 5, 1.4, 2.1);
      const tx = Math.max(-330, Math.min(425, u.x + Math.cos(a) * d));
      const tz = Math.max(242, Math.min(310.5, u.z + Math.sin(a) * d));
      R7_put(towelMesh, i, tx, 0.08, tz, 0, u.ry + R7_range(i * 19 + 7, -0.4, 0.4), 0, 1.9, 0.06, 1.0);
      towelMesh.setColorAt(i, new THREE.Color(R7_pick(R7_TOWEL_COLORS, i * 23 + 9)));
    });
    R7_finish(towelMesh);
  }
  const boardMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), 8);
  if (boardMesh) {
    for (let i = 0; i < 8; i++) {
      const x = R7_range(i * 37 + 5, -260, 240);
      const z = R7_range(i * 41 + 9, 308.5, 311.5);
      const s = R7_range(i * 43 + 13, 0.9, 1.1);
      const yaw = R7_range(i * 47 + 17, -0.5, 0.5) + (i % 2 === 0 ? 0 : Math.PI);
      R7_put(boardMesh, i, x, 1.12 * s, z, 0.16, yaw, 0, 0.55 * s, 2.3 * s, 0.09);
      boardMesh.setColorAt(i, new THREE.Color(R7_pick(R7_BOARD_COLORS, i * 7 + 21)));
    }
    R7_finish(boardMesh);
  }
  const boatSpots = [
    { x: -160, z: 470, yaw: 0.4 },
    { x: 90, z: 580, yaw: 2.2 },
    { x: 270, z: 450, yaw: 5.1 },
  ];
  const hullMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), 3);
  const cabinMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), 3);
  const mastMesh = R7_soup(scene, R7_unitBox, new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), 3);
  const flagMesh = R7_soup(scene, R7_unitBox, new THREE.MeshBasicMaterial({ color: 0xffffff }), 3);
  const hullCols = ['#f5f2e8', '#b3402e', '#2c4a6b'];
  const flagCols = ['#f28482', '#f2c94c', '#4fc3f7'];
  if (hullMesh && cabinMesh && mastMesh && flagMesh) {
    boatSpots.forEach((sp, i) => {
      const co = Math.cos(sp.yaw);
      const si = Math.sin(sp.yaw);
      R7_put(hullMesh, i, sp.x, 0.55, sp.z, 0, sp.yaw, 0, 6.5, 1.1, 2.4);
      hullMesh.setColorAt(i, new THREE.Color(hullCols[i]));
      R7_put(cabinMesh, i, sp.x - 0.8 * co, 1.55, sp.z + 0.8 * si, 0, sp.yaw, 0, 2.6, 1.0, 1.8);
      cabinMesh.setColorAt(i, new THREE.Color('#e8e0cc'));
      R7_put(mastMesh, i, sp.x + 0.6 * co, 3.6, sp.z - 0.6 * si, 0, sp.yaw, 0, 0.14, 5.6, 0.14);
      R7_put(flagMesh, i, sp.x + 1.1 * co, 6.0, sp.z - 1.1 * si, 0, sp.yaw, 0, 0.95, 0.55, 0.04);
      flagMesh.setColorAt(i, new THREE.Color(flagCols[i]));
    });
    R7_finish(hullMesh);
    R7_finish(cabinMesh);
    R7_finish(mastMesh);
    R7_finish(flagMesh);
  }
  const grain = new THREE.Mesh(
    new THREE.PlaneGeometry(768, 72),
    new THREE.MeshLambertMaterial({ map: R7_sandGrainTexture(), transparent: true, opacity: 0.3, depthWrite: false })
  );
  grain.rotation.x = -Math.PI / 2;
  grain.position.set(48, 0.05, 276);
  grain.renderOrder = 2;
  scene.add(grain);
  const marks = new THREE.Mesh(
    new THREE.PlaneGeometry(768, 72),
    new THREE.MeshLambertMaterial({ map: R7_sandMarksTexture(), transparent: true, opacity: 0.9, depthWrite: false })
  );
  marks.rotation.x = -Math.PI / 2;
  marks.position.set(48, 0.07, 276);
  marks.renderOrder = 2;
  scene.add(marks);

  const frondMesh = R7_soup(scene, new THREE.BoxGeometry(1, 0.05, 0.62), new THREE.MeshLambertMaterial({ color: 0x2e6b2a }), L.palms.length * 5);
  if (frondMesh) {
    let fi = 0;
    L.palms.forEach((p, i) => {
      const ringY = 4.65 * p.s + 0.15;
      const base = R7_hash(i * 3 + 2) * Math.PI * 2;
      for (let j = 0; j < 5; j++) {
        const yaw = base + (j / 5) * Math.PI * 2;
        R7_put(frondMesh, fi, p.x, ringY, p.z, 0, yaw, -0.855, 3.0 * p.s, 1, 1, 'YZX');
        fi++;
      }
    });
    R7_finish(frondMesh);
  }

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 700),
    new THREE.MeshBasicMaterial({ map: R7_seaTexture(), transparent: true, opacity: 0.55, depthWrite: false })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(60, 0.45, 662);
  sea.renderOrder = 3;
  scene.add(sea);
}
export class Renderer {
  constructor(world, canvas, quality = 'med') {
    this.world = world;
    this.canvas = canvas;
    this.quality = quality;
    this.scene = new THREE.Scene();
    // Render at the canvas's real client size (the driver pins the
    // viewport; a fixed buffer used to stretch 11% vertically).
    const cw = canvas.clientWidth || 1280, ch = canvas.clientHeight || 720;
    this.camera = new THREE.PerspectiveCamera(62, cw / ch, 0.1, 1400);
    const scale = quality === 'low' ? 0.75 : quality === 'high' ? 1.5 : 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(cw, ch, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * scale);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.85);
    this.sun = new THREE.DirectionalLight(0xffdf9e, 1.25);
    this.scene.add(this.hemi, this.sun);
    this.scene.fog = new THREE.Fog(0xcfe0ee, 140, 560);
    this.camOverride = null;
    this.camPos = new THREE.Vector3(-72, 30, 40);
    this.camLook = new THREE.Vector3(-72, 0, 0);
    this.time = 0;
    this.buildStatic(world.layout);
    this.buildDynamic();
    this.K8_buildSky();
  }

  // ---- static city ----
  buildStatic(L) {
    const scene = this.scene;
    // building footprints for the follow-camera clamp
    this.camBlockers = L.buildings.map((b) => ({
      x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, h: b.h,
    }));
    // ground + sea
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.x1 - WORLD.x0, WORLD.z1 - WORLD.z0),
      new THREE.MeshLambertMaterial({ map: groundTexture(L) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((WORLD.x0 + WORLD.x1) / 2, 0, (WORLD.z0 + WORLD.z1) / 2);
    scene.add(ground);
    // One fine grain plane over the whole ground (768x672 m, repeat
    // 192x168, y = 0.03): a cheap procedural second layer so the
    // concrete, lots and asphalt never read as one flat colour.
    const grain = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.x1 - WORLD.x0, WORLD.z1 - WORLD.z0),
      new THREE.MeshBasicMaterial({ map: groundGrainCanvas(), transparent: true, opacity: 0.10, depthWrite: false }),
    );
    grain.rotation.x = -Math.PI / 2;
    grain.position.set((WORLD.x0 + WORLD.x1) / 2, 0.03, (WORLD.z0 + WORLD.z1) / 2);
    grain.renderOrder = 2;
    scene.add(grain);
    // K17_ sand: two procedural layers replace the old faint grain
    // overlays (opacity 0.14 / 0.10 — invisible at 2K). The tone layer
    // is big soft blotches at ~128 m/tile so mid-distance sand is not
    // one flat wash; the detail layer is per-pixel grain + ripples at
    // ~6 m/tile so close sand reads granular. Lambert, so both stay
    // lit like the ground beneath instead of glowing flat.
    for (const [make, repX, repZ, y, op] of [
      [K17_sandToneTexture, 6, 1, 0.04, 0.50],
      [K17_sandDetailTexture, 128, 12, 0.05, 0.55],
    ]) {
      const tile = make();
      tile.repeat.set(repX, repZ);
      const sg = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD.x1 - WORLD.x0, SEA_Z - BEACH_Z),
        new THREE.MeshLambertMaterial({ map: tile, transparent: true, opacity: op, depthWrite: false }),
      );
      sg.rotation.x = -Math.PI / 2;
      sg.position.set((WORLD.x0 + WORLD.x1) / 2, y, (BEACH_Z + SEA_Z) / 2);
      sg.renderOrder = 2;
      scene.add(sg);
    }
    // K17_ wet band: dark damp sand hugging the waterline (10 m deep,
    // wavy dry edge), + a scrolling foam wash right at the waterline.
    // Two planes, 2 draw calls, 4 triangles total.
    const K17_wet = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.x1 - WORLD.x0, 10),
      new THREE.MeshLambertMaterial({ map: K17_wetSandTexture(), transparent: true, depthWrite: false }),
    );
    K17_wet.rotation.x = -Math.PI / 2;
    K17_wet.position.set((WORLD.x0 + WORLD.x1) / 2, 0.06, SEA_Z - 5);
    K17_wet.renderOrder = 2;
    scene.add(K17_wet);
    this.K17_foamTex = K17_foamTexture();
    this.K17_foamTex.repeat.set(8, 1);
    const K17_foam = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.x1 - WORLD.x0, 7),
      new THREE.MeshBasicMaterial({ map: this.K17_foamTex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    K17_foam.rotation.x = -Math.PI / 2;
    K17_foam.position.set((WORLD.x0 + WORLD.x1) / 2, 0.5, SEA_Z + 1.5);
    K17_foam.renderOrder = 3;
    scene.add(K17_foam);
    // Procedural long shadows: one merged mesh, rebuilt when the hour
    // bucket moves (see rebuildShadows). Starts hidden until update().
    this.shadowMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.34, depthWrite: false }),
    );
    this.shadowMesh.renderOrder = 1;
    this.shadowMesh.visible = false;
    this.shadowBucket = null;
    scene.add(this.shadowMesh);
    // The sea is unlit (Basic): under the low sunset sun a Lambert sea
    // went black and read as a dark slit. Colour is driven by time of
    // day in update() — warm at sunset, dark at night.
    this.seaMat = new THREE.MeshBasicMaterial({ map: K17_seaTexture(), transparent: true, opacity: 0.92 });
    // the sea plane runs out to the sky dome (dome radius 950): the old
    // 260 m-deep plane ended at z = 572, so most of the "water" in a
    // beach frame was the dome's dark below-horizon half, not sea
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 700), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(60, 0.4, SEA_Z + 350);
    scene.add(sea);
    // marina water east of the grid (two planes, clear of the causeway
    // strip) so the moored boats float instead of sitting on concrete
    for (const [mz, mh] of [[-39.5, 113], [87.5, 113]]) {
      const mw = new THREE.Mesh(new THREE.PlaneGeometry(144, mh), this.seaMat);
      mw.rotation.x = -Math.PI / 2;
      mw.position.set(360, 0.2, mz);
      scene.add(mw);
    }

    const solid = new BoxSoup();   // lambert, vertex colours
    const glow = new BoxSoup();    // basic, vertex colours — reads at night
    const glassDark = [];
    const glassLit = [];
    const mullions = [];

    // --- buildings: body + cornice + parapet + roof trim + windows + shopfronts ---
    for (const b of L.buildings) {
      const bxr = Math.round(b.x), bzr = Math.round(b.z);
      const f = hash2(bxr, bzr, 13);
      const colsX = Math.max(2, Math.floor(b.w / 6.0));
      const colsZ = Math.max(2, Math.floor(b.d / 6.0));
      // K16_ facade: full rewrite of the K9 assignment. The K9 hash
      // still picks the base palette entry, but the cover render
      // proved the hash is not the whole story under sunset light:
      // the three orange (#f4845f) strand towers that stack along
      // the cover sightline — (-125.8, 215.9), (-76.9, 211.3) and
      // (-76.7, 222.1), the last two on top of each other — read as
      // ONE brown-terracotta mass mid-frame. Their south faces sit
      // in shade (sun is due west at 18.3) and only get the warm
      // brown hemisphere ground light, which drags orange to brown.
      // The same render proves magenta survives: the #d81159 tower
      // at (-19.4, 208.2) on the right edge stays vivid. So the
      // three are reassigned by exact rounded coordinate to the
      // saturated end of the K9 palette — magenta / pink — with a
      // contrasting string-course band each. Nothing else changes:
      // hash, brightness wobble and the K9 band rule are untouched
      // for every other building.
      const K16_BROWN_TOWERS = {
        '-126,216': { face: '#d81159', band: '#2ec4b6' },
        '-77,211': { face: '#d81159', band: '#2ec4b6' },
        '-77,222': { face: '#e84393', band: '#06d6a0' },
      };
      const K9_facadeIdx = Math.floor(hash2(bxr, bzr, 41) * K9_FACADE_COLORS.length) % K9_FACADE_COLORS.length;
      const K16_towerFix = K16_BROWN_TOWERS[bxr + ',' + bzr] || null;
      const facade = K16_towerFix
        ? tinted(K16_towerFix.face, 0.9 + f * 0.2)
        : tinted(K9_FACADE_COLORS[K9_facadeIdx], 0.9 + f * 0.2);
      solid.add(b.x, b.h / 2, b.z, b.w, b.h, b.d, facade, 0, 0, 0, { bx: b.w / colsX, bz: b.d / colsZ, floorH: 3.4, y0: 0 });
      // Cornice accent band just under the roofline, one accent colour
      // per building (teal / brick / gold / navy / cream), picked by
      // hash — the roofline finally has a colour edge instead of a
      // bare slab meeting the sky.
      const corniceCol = pickFrom(CORNICE_ACCENTS, hash2(bxr, bzr, 45));
      solid.add(b.x, b.h - 0.15, b.z, b.w + 0.3, 0.6, b.d + 0.3, corniceCol);
      // K9_ string course: one protruding mid-height band on the
      // strand row (z>=192, 24 buildings) — the row that lines the
      // cover/chase right edge. First K9 pass gated this on h>30, but
      // the render proved the cover frame's dominant buildings are the
      // strand row (h 10-30): downtown bands never showed from the
      // cover angle. The city has 266 buildings, so a band on every
      // one would cost 266 boxes / 3,192 tris, far over this round's
      // 1,500-tri budget. Colour is the palette entry 3 steps from
      // the facade, so the band never matches its own wall.
      if (b.z >= 192) {
        // K16_: a rescued tower keeps its contrasting band, now
        // matched to its NEW face (teal on magenta, green on pink)
        // instead of the band of the orange it used to be.
        const K16_band = K16_towerFix ? K16_towerFix.band : K9_FACADE_COLORS[(K9_facadeIdx + 3) % K9_FACADE_COLORS.length];
        solid.add(b.x, b.h / 2, b.z, b.w + 0.3, 0.3, b.d + 0.3, K16_band);
      }
      // Parapet height varies per building and rooftop bulkheads vary
      // in height too, so the skyline is not one flat line.
      const parapet = 0.7 + hash2(bxr, bzr, 39) * 0.9;
      solid.add(b.x, b.h + parapet / 2, b.z, b.w + 0.4, parapet, b.d + 0.4, tinted(b.roof, 1));
      solid.add(b.x, b.h + 0.15, b.z, b.w * 0.55, 0.7, b.d * 0.55, tinted(b.roof, 0.8));
      if (hash2(bxr, bzr, 37) < 0.6) {
        const bulkH = 1.5 + hash2(bxr, 7, 37) * 2.2;
        solid.add(b.x - b.w * 0.15, b.h + 0.5 + bulkH / 2, b.z + b.d * 0.1, b.w * 0.45, bulkH, b.d * 0.45, tinted(b.roof, 0.9));
        if (hash2(bxr, bzr, 47) < 0.3) {
          solid.add(b.x + b.w * 0.25, b.h + 1.0, b.z - b.d * 0.2, b.w * 0.2, 1.0, b.d * 0.2, tinted(b.roof, 0.75));
        }
      }
      if (b.sign) glow.add(b.x, b.h + parapet + 0.55, b.z + b.d / 2 + 0.1, Math.min(10, b.w * 0.6), 1.1, 0.3, b.signColor);
      // windows on all four faces
      for (let fl = 0; fl < b.floors; fl++) {
        const y = 2.6 + fl * 3.4;
        if (y > b.h - 1.5) break;
        for (let c = 0; c < colsX; c++) {
          const ox = -b.w / 2 + (c + 0.5) * (b.w / colsX);
          this.pushWindow(glassDark, glassLit, mullions, b, ox, y, b.z + b.d / 2 + 0.06, 0, b.h);
          this.pushWindow(glassDark, glassLit, mullions, b, ox, y, b.z - b.d / 2 - 0.06, Math.PI, b.h);
        }
        for (let c = 0; c < colsZ; c++) {
          const oz = -b.d / 2 + (c + 0.5) * (b.d / colsZ);
          this.pushWindow(glassDark, glassLit, mullions, b, b.x + b.w / 2 + 0.06, y, oz, Math.PI / 2, b.h, true);
          this.pushWindow(glassDark, glassLit, mullions, b, b.x - b.w / 2 - 0.06, y, oz, -Math.PI / 2, b.h, true);
        }
      }
      // shopfront on the south face, street level
      const sy = 1.5;
      solid.add(b.x - b.w * 0.22, sy, b.z + b.d / 2 + 0.08, b.w * 0.34, 2.6, 0.16, '#20262e');
      solid.add(b.x + b.w * 0.22, sy, b.z + b.d / 2 + 0.08, b.w * 0.34, 2.6, 0.16, '#20262e');
      // The entrance is a light frame around an accent-coloured door
      // with a step in front, so it reads at cover distance instead of
      // a dark slot in a dark wall.
      const DOOR_TINTS = ['#2f6f6a', '#b3402e', '#2c4a6b', '#7a4a21'];
      const doorTint = pickFrom(DOOR_TINTS, hash2(bxr, bzr, 43));
      const faceZ = b.z + b.d / 2;
      solid.add(b.x, 1.35, faceZ + 0.06, 1.7, 2.9, 0.1, '#e8e0cc');
      solid.add(b.x, 1.3, faceZ + 0.12, 1.3, 2.5, 0.12, doorTint);
      solid.add(b.x, 0.09, faceZ + 0.5, 2.0, 0.18, 0.8, '#9a938a');
      glow.add(b.x, 3.1, b.z + b.d / 2 + 0.12, b.w * 0.7, 0.5, 0.12, b.signColor);
      // striped shop awning above the shopfront: 3 alternating stripes,
      // sloped toward the street — merged into the soup, so the whole
      // city's awnings cost 0 extra draw calls
      const awAccent = pickFrom(AWN_ACCENTS, hash2(Math.round(b.x), Math.round(b.z), 29));
      const awW = (b.w * 0.7) / 3;
      for (let aI = 0; aI < 3; aI++) {
        solid.add(b.x - b.w * 0.35 + awW * (aI + 0.5), 3.65, b.z + b.d / 2 + 0.7, awW, 0.08, 1.4, aI % 2 ? '#f5efe0' : awAccent, 0, 0, 0.18);
      }
      // K9_ balconies: downtown set as before (h>30, hash<0.33 —
      // widening that to h>20 / <0.5 would add ~500 boxes / ~6,000
      // tris, far over this round's 1,500-tri budget) PLUS the strand
      // row (z>=192, h>15, seed 22 <0.5: 9 buildings incl. the cover's
      // pink (-19,208) and orange tower (-77,211)), one floor higher
      // (1-3) and in light cream, so slab and rail read against the
      // saturated facades instead of vanishing as dark grey. The
      // strand faces point south, toward the cover/chase camera.
      const K9_balcDowntown = b.h > 30 && hash2(Math.round(b.x), Math.round(b.z), 17) < 0.33;
      const K9_balcStrand = b.z >= 192 && b.h > 15 && hash2(Math.round(b.x), Math.round(b.z), 22) < 0.5;
      if (K9_balcDowntown || K9_balcStrand) {
        for (let fl = 1; fl <= 3; fl++) {
          const y = 3.4 * fl + 2.6;
          solid.add(b.x, y, b.z + b.d / 2 + 0.7, b.w * 0.5, 0.25, 1.5, '#e8e0cc');
          solid.add(b.x, y + 0.6, b.z + b.d / 2 + 1.4, b.w * 0.5, 0.9, 0.08, '#f5efe0');
        }
      }
      // K16_ tri budget: AC + roof tanks, rewritten from scratch.
      // K14 kept AC on ~85% of buildings (234 first units + 63 second
      // units = 297 boxes = 3,564 tris) and tanks on ~75% of low-rise
      // + ~35% of mid-rise (112 buildings x 2 boxes = 2,688 tris).
      // Both are sub-metre grey boxes on east faces and roofs: at
      // cover distance they are invisible, at street level they read
      // only as speckle. The debug-minimap phase sat at 498,290 tris
      // against the 500k cap, so K16 thins them by hash — same seeds,
      // same geometry, same placement rule, only lower thresholds, so
      // every surviving unit sits exactly where it sat before:
      // AC first unit 0.85 -> 0.60 (234 -> 167), second 0.35 -> 0.20
      // (63 -> 29): -1,212 tris. Tanks low-rise 0.75 -> 0.50 (75 ->
      // 55), mid-rise 0.35 -> 0.20 (37 -> 20): -888 tris. Facades,
      // balconies, strand row, palms and staged cars are untouched.
      if (hash2(Math.round(b.x), Math.round(b.z), 19) < 0.60) {
        const K16_fl = 1 + Math.floor(hash2(Math.round(b.x), 3, 19) * Math.max(1, b.floors - 1));
        const K16_ay = 2.6 + K16_fl * 3.4;
        if (K16_ay < b.h - 1) solid.add(b.x + b.w / 2 + 0.3, K16_ay, b.z + b.d * 0.2, 0.6, 0.5, 0.9, '#9a9a92');
        if (hash2(Math.round(b.x), Math.round(b.z), 27) < 0.20) {
          const K16_fl2 = 1 + Math.floor(hash2(Math.round(b.z), 5, 27) * Math.max(1, b.floors - 1));
          const K16_ay2 = 2.6 + K16_fl2 * 3.4;
          if (K16_ay2 < b.h - 1 && Math.abs(K16_ay2 - K16_ay) > 3) solid.add(b.x - b.w / 2 - 0.3, K16_ay2, b.z - b.d * 0.2, 0.6, 0.5, 0.9, '#8a8a82');
        }
      }
      if (b.h <= 20 && hash2(Math.round(b.x), Math.round(b.z), 23) < 0.50) {
        solid.add(b.x + b.w * 0.25, b.h + 1.6, b.z - b.d * 0.2, 1.7, 2.2, 1.7, '#7a7568');
        solid.add(b.x + b.w * 0.25, b.h + 2.8, b.z - b.d * 0.2, 1.9, 0.25, 1.9, '#5a5548');
      } else if (b.h > 20 && b.h <= 35 && hash2(Math.round(b.x), Math.round(b.z), 25) < 0.20) {
        solid.add(b.x - b.w * 0.25, b.h + 1.6, b.z + b.d * 0.2, 1.7, 2.2, 1.7, '#7a7568');
        solid.add(b.x - b.w * 0.25, b.h + 2.8, b.z + b.d * 0.2, 1.9, 0.25, 1.9, '#5a5548');
      }
    }
    // K16_ lighthouse, rewritten from scratch and moved. The old
    // one at (-280, 348) sat 292 m from the beach-hero camera,
    // 17 m tall, dead on the SOLMARINA sign axis — in the render it
    // is hidden behind the sign posts, the beach hut and the big
    // palm just right of the sign. It is also too far to read in
    // the cover.
    // New home (-150, 335), open sea, 170 m from the beach-hero
    // camera and 181 m from the cover camera: in beach-hero it
    // stands just right of the sign, clear of the palm fronds
    // (which start ~50 px further right) and above the hut roof;
    // in cover it stands in the sea left of the sun. Geometry note:
    // no sea point is screen-left in beach-hero AND in the cover
    // frame at once (the two cameras look ~28 deg apart, the sea
    // is south of both) — this is the closest point that is
    // clearly visible in both. The tower is taller (top ~24 m, was
    // ~17 m) with four alternating bands, so it reads at 170 m.
    const K16_LH = { x: -150, z: 335 };
    solid.add(K16_LH.x, 1.2, K16_LH.z, 18, 2.4, 16, '#6b5a4a');
    solid.add(K16_LH.x, 3.4, K16_LH.z, 12, 2.4, 11, '#7a6a58');
    solid.add(K16_LH.x, 6.5, K16_LH.z, 5.5, 4.5, 5.5, '#f5efe0');
    solid.add(K16_LH.x, 11, K16_LH.z, 5.5, 4.5, 5.5, '#c0392b');
    solid.add(K16_LH.x, 15.5, K16_LH.z, 5.5, 4.5, 5.5, '#f5efe0');
    solid.add(K16_LH.x, 20, K16_LH.z, 5.5, 4.5, 5.5, '#c0392b');
    solid.add(K16_LH.x, 22.8, K16_LH.z, 6, 1.2, 6, '#2f3540');
    glow.add(K16_LH.x, 24, K16_LH.z, 1.8, 1.8, 1.8, '#ffe9a8');
    // K16_ cover foreground asphalt dressing, written from scratch.
    // The ground texture already paints crosswalks, dashes, oil and
    // wear — but at 4096 px over a 768 m world (5.3 px/m) and a
    // grazing camera angle they wash out, so the bottom half of the
    // cover read as empty dark asphalt. These 16 flat boxes sit in
    // the merged solid soup (+192 tris, 0 extra draw calls), 0.06 m
    // thick with tops at y = 0.12 — above the ground grain (0.03)
    // and sand overlays (0.05), below every wheel — so they read
    // crisp at 300 px thumbnail. All of them lie on the z = 240
    // beach road in the cover camera's near field (camera at
    // (7.8, 2.7, 245.8) looking WSW; hero car at (0, 240), staged
    // cruisers at x -30/-42, traffic from x -68): nothing overlaps
    // the hero car, the heli, the palms or any staged figure.
    // Zebra crossing just ahead of the hero (x -11.6..-8.4): six
    // pale bars, long in the traffic direction, spaced across the
    // full 12 m road width.
    for (const K16_z of [235.8, 237.5, 239.2, 240.9, 242.6, 244.3]) {
      solid.add(-10, 0.09, K16_z, 3.2, 0.06, 0.55, '#f7f3e0');
    }
    // Yellow centre-line dashes, reinforcing the texture dashes:
    // two mid-frame west of the zebra, one right by the camera
    // east of the hero's rear.
    for (const K16_x of [-24, -18, 4.5]) {
      solid.add(K16_x, 0.09, 240, 3.0, 0.06, 0.3, '#e8c33c');
    }
    // Manhole in the south lane, two oil stains, and twin tyre-wear
    // bands on the +/-1.8 m wheel tracks the texture already draws.
    solid.add(-16, 0.09, 243.5, 1.3, 0.06, 1.3, '#1c1e22');
    solid.add(-6, 0.09, 237.5, 2.2, 0.06, 1.4, '#14161a');
    solid.add(2, 0.09, 243.8, 1.6, 0.06, 1.1, '#14161a');
    solid.add(-14, 0.09, 238.2, 6.0, 0.06, 0.45, '#1a1a1e');
    solid.add(-14, 0.09, 241.8, 6.0, 0.06, 0.45, '#1a1a1e');
    // Pale curb highlights on both road edges, running through the
    // near foreground: south edge under the camera, north edge past
    // the sidewalk peds.
    solid.add(-4, 0.09, 246.1, 20, 0.06, 0.35, '#d8d2c0');
    solid.add(-10, 0.09, 234, 20, 0.06, 0.35, '#d8d2c0');
    // the merged solid mesh carries the facade atlas: building bodies
    // map onto the window-bay tile, everything else samples the white
    // half
    scene.add(solid.build(new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeTexture() })));
    scene.add(glow.build(basicVertex()));

    // windows: two instanced pools (dark glass lambert, lit warm basic)
    const winGeo = new THREE.BoxGeometry(1.7, 1.5, 0.12);
    this.winDark = new THREE.InstancedMesh(winGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, glassDark.length));
    this.winLit = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, glassLit.length));
    glassDark.forEach((w, i) => { dummy.position.set(w.x, w.y, w.z); dummy.rotation.set(0, w.ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.winDark.setMatrixAt(i, dummy.matrix); this.winDark.setColorAt(i, tmpColor.set(w.color)); });
    glassLit.forEach((w, i) => { dummy.position.set(w.x, w.y, w.z); dummy.rotation.set(0, w.ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.winLit.setMatrixAt(i, dummy.matrix); this.winLit.setColorAt(i, tmpColor.set(w.color)); });
    this.winDark.count = glassDark.length; this.winLit.count = glassLit.length;
    scene.add(this.winDark, this.winLit);
    // mullions: one thin proud bar per pane, short buildings first
    const mulGeo = new THREE.BoxGeometry(0.09, 1.5, 0.2);
    this.mull = new THREE.InstancedMesh(mulGeo, new THREE.MeshLambertMaterial({ color: 0x2a2f38 }), Math.max(1, mullions.length));
    mullions.forEach((w, i) => { dummy.position.set(w.x, w.y, w.z); dummy.rotation.set(0, w.ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.mull.setMatrixAt(i, dummy.matrix); });
    this.mull.count = mullions.length;
    scene.add(this.mull);

    // --- market stalls: striped awnings, goods, crates, lanterns, string lights ---
    const stallSoup = new BoxSoup();
    const lanterns = [];
    const bulbs = [];
    const wires = new BoxSoup();
    for (const st of L.stalls) {
      const cy = Math.cos(st.ry), sy = Math.sin(st.ry);
      const local = (lx, lz) => ({ x: st.x + lx * cy - lz * sy, z: st.z + lx * sy + lz * cy });
      const c0 = local(0, 0);
      stallSoup.add(c0.x, 0.55, c0.z, 5.6, 1.1, 2.2, '#6b4a2f', st.ry);
      stallSoup.add(c0.x, 1.15, c0.z, 5.8, 0.12, 2.4, tinted(st.color, 0.85), st.ry);
      // striped awning: 5 alternating stripes, slightly sloped
      for (let sIdx = 0; sIdx < 5; sIdx++) {
        const p = local(-2.24 + sIdx * 1.12 + 0.56, -0.4);
        stallSoup.add(p.x, 2.9, p.z, 1.12, 0.1, 3.4, sIdx % 2 ? '#f5efe0' : st.color, st.ry, 0.12);
      }
      for (const px of [-2.6, 2.6]) {
        const p = local(px, -1.4);
        stallSoup.add(p.x, 1.5, p.z, 0.14, 3, 0.14, '#4a3520', st.ry);
      }
      // goods piles on the counter: coloured produce
      for (let gI = 0; gI < 6; gI++) {
        const p = local(-2 + gI * 0.8, (gI % 2 ? 0.4 : -0.5));
        stallSoup.add(p.x, 1.45, p.z, 0.6, 0.35 + hash2(gI, Math.round(st.x), 1) * 0.25, 0.6, st.goods[gI % 2], st.ry);
      }
      const cr = local(3.4, 0.8);
      stallSoup.add(cr.x, 0.4, cr.z, 0.9, 0.8, 0.9, '#8a6a42', st.ry);
      stallSoup.add(cr.x, 1.1, cr.z, 0.8, 0.6, 0.8, '#a08050', st.ry);
      // warm lanterns under the awning
      for (const lx of [-1.4, 1.4]) {
        const p = local(lx, -0.4);
        lanterns.push({ x: p.x, y: 2.45, z: p.z });
      }
    }
    scene.add(stallSoup.build(lambertVertex()));
    const lanSoup = new BoxSoup();
    for (const ln of lanterns) lanSoup.add(ln.x, ln.y, ln.z, 0.28, 0.4, 0.28, '#ffb347');
    scene.add(lanSoup.build(basicVertex()));
    // string lights between neighbouring stalls in each row
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const x0 = MARKET.x - 30 + i * 12 + 2.8, x1 = MARKET.x - 30 + (i + 1) * 12 - 2.8;
        const z = MARKET.z + (row === 0 ? -10 : 10);
        for (let bI = 0; bI <= 5; bI++) {
          const t = bI / 5;
          const sag = Math.sin(t * Math.PI) * 0.7;
          bulbs.push({ x: lerp(x0, x1, t), y: 3.4 - sag, z });
        }
        wires.add((x0 + x1) / 2, 3.35, z, x1 - x0, 0.05, 0.05, '#1c1a16');
      }
    }
    scene.add(wires.build(lambertVertex()));
    const bulbGeo = new THREE.SphereGeometry(0.14, 6, 5);
    this.bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffc46b }), bulbs.length);
    bulbs.forEach((b, i) => { dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.bulbs.setMatrixAt(i, dummy.matrix); });
    scene.add(this.bulbs);

    // --- palms: banded trunks + coconuts + a three-ring crown ---
    // Upper ring pitched up, middle ring near-flat, lower ring
    // drooping, 20 fronds per palm, so the palms read leafy from the
    // street and the beach instead of a few bare spikes. All fronds
    // live in one InstancedMesh, so the extra foliage costs 0 draw calls.
    const palmSoup = new BoxSoup();
    const fronds = [];
    const nuts = [];
    const frondRing = (pl, top, count, yawSeed, pitch, len, col) => {
      for (let k = 0; k < count; k++) {
        const yaw = (k / count) * Math.PI * 2 + hash2(Math.round(pl.x), k, yawSeed);
        fronds.push({ x: pl.x, y: top, z: pl.z, yaw, pitch, len: len * pl.s, col });
      }
    };
    for (const pl of L.palms) {
      const h = 5.2 * pl.s;
      for (let seg = 0; seg < 5; seg++) {
        const y = (seg + 0.5) * (h / 5);
        palmSoup.add(pl.x + Math.sin(seg * 1.7) * 0.12, y, pl.z, 0.34, h / 5 + 0.1, 0.34, seg % 2 ? '#8a6a42' : '#7a5a38');
      }
      palmSoup.add(pl.x, h * 0.45, pl.z, 0.44, 0.3, 0.44, '#6b4a2f');
      palmSoup.add(pl.x, h * 0.8, pl.z, 0.44, 0.3, 0.44, '#6b4a2f');
      for (let nI = 0; nI < 3; nI++) nuts.push({ x: pl.x + Math.cos(nI * 2.1) * 0.4, y: h - 0.3, z: pl.z + Math.sin(nI * 2.1) * 0.4 });
      frondRing(pl, h + 0.15, 6, 3, 0.45, 3.4, '#3f9e4d');
      frondRing(pl, h + 0.05, 6, 5, 0.05, 3.2, '#35873f');
      frondRing(pl, h - 0.1, 8, 4, -0.5, 3.0, '#2f8f3e');
    }
    scene.add(palmSoup.build(lambertVertex()));
    const frondGeo = new THREE.BoxGeometry(1, 0.05, 0.62);
    frondGeo.translate(0.5, 0, 0); // pivot at the crown
    this.fronds = new THREE.InstancedMesh(frondGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), fronds.length);
    fronds.forEach((f, i) => {
      dummy.position.set(f.x, f.y, f.z);
      dummy.rotation.set(0, -f.yaw, f.pitch, 'YXZ');
      dummy.scale.set(f.len, 1, 1);
      dummy.updateMatrix();
      this.fronds.setMatrixAt(i, dummy.matrix);
      this.fronds.setColorAt(i, tmpColor.set(f.col));
    });
    scene.add(this.fronds);
    const nutGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.nuts = new THREE.InstancedMesh(nutGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), nuts.length);
    nuts.forEach((n, i) => { dummy.position.set(n.x, n.y, n.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.nuts.setMatrixAt(i, dummy.matrix); });
    scene.add(this.nuts);

    // --- beach umbrellas: segmented canopy + finial + striped towel + balls ---
    // Four big panels tilted cone-style, outer edge down, so the canopy
    // reads from a low camera instead of edge-on.
    const umbSoup = new BoxSoup();
    const balls = [];
    for (const u of L.umbrellas) {
      const cy = Math.cos(u.ry), sy = Math.sin(u.ry);
      umbSoup.add(u.x, 1.3, u.z, 0.09, 2.6, 0.09, '#e8e0cc');
      for (let panel = 0; panel < 4; panel++) {
        const ang = (panel / 4) * Math.PI * 2 + u.ry;
        const panelX = u.x + Math.cos(ang) * 0.95;
        const panelZ = u.z + Math.sin(ang) * 0.95;
        const panelY = 2.6 + (panel % 2 ? 0.14 : 0);
        const panelCol = panel % 2 ? '#f5efe0' : u.color;
        umbSoup.add(panelX, panelY, panelZ, 1.9, 0.08, 1.9, panelCol, -ang, -0.35, 0);
      }
      umbSoup.add(u.x, 2.9, u.z, 0.14, 0.3, 0.14, '#d4af37');
      const tx = u.x + cy * 2.2, tz = u.z + sy * 2.2;
      umbSoup.add(tx, 0.08, tz, 1.8, 0.06, 0.8, u.color, u.ry);
      umbSoup.add(tx, 0.1, tz, 0.5, 0.06, 0.8, '#f5efe0', u.ry);
      if (hash2(Math.round(u.x), Math.round(u.z), 51) < 0.6) {
        balls.push({ x: u.x + 1.5, z: u.z + 1.2, color: ballColor(u.color) });
      }
    }
    scene.add(umbSoup.build(lambertVertex()));
    const ballGeo = new THREE.SphereGeometry(0.32, 8, 6);
    this.balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, balls.length));
    balls.forEach((b, i) => { dummy.position.set(b.x, 0.32, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.balls.setMatrixAt(i, dummy.matrix); this.balls.setColorAt(i, tmpColor.set(b.color)); });
    this.balls.count = balls.length;
    scene.add(this.balls);

    // --- street props: bins, benches, planters, cones, beach dressing ---
    const propSoup = new BoxSoup();
    for (const pr of L.props) {
      if (pr.kind === 'bin') {
        propSoup.add(pr.x, 0.55, pr.z, 0.7, 1.1, 0.7, '#3d5a3a', pr.ry);
        propSoup.add(pr.x, 1.15, pr.z, 0.75, 0.1, 0.75, '#2c4630', pr.ry);
      } else if (pr.kind === 'bench') {
        propSoup.add(pr.x, 0.45, pr.z, 2.2, 0.12, 0.6, '#8a6a42', pr.ry);
        propSoup.add(pr.x, 0.85, pr.z - 0.28, 2.2, 0.7, 0.1, '#8a6a42', pr.ry);
        propSoup.add(pr.x - 0.9, 0.2, pr.z, 0.12, 0.4, 0.5, '#3a3a3a', pr.ry);
        propSoup.add(pr.x + 0.9, 0.2, pr.z, 0.12, 0.4, 0.5, '#3a3a3a', pr.ry);
      } else if (pr.kind === 'planter') {
        propSoup.add(pr.x, 0.35, pr.z, 1.1, 0.7, 1.1, '#9a938a', pr.ry);
        propSoup.add(pr.x, 0.85, pr.z, 0.95, 0.35, 0.95, '#4a7a3a', pr.ry);
        propSoup.add(pr.x, 1.1, pr.z, 0.5, 0.3, 0.5, '#5d9c4a', pr.ry);
      } else if (pr.kind === 'towel') {
        const tc = ['#e07a5f', '#4fc3f7', '#f2c94c', '#f28482'][Math.floor(hash2(Math.round(pr.x), Math.round(pr.z), 53) * 4) % 4];
        propSoup.add(pr.x, 0.08, pr.z, 1.8, 0.06, 0.8, tc, pr.ry);
        propSoup.add(pr.x, 0.1, pr.z, 0.5, 0.06, 0.8, '#f5efe0', pr.ry);
      } else if (pr.kind === 'rock') {
        propSoup.add(pr.x, 0.25, pr.z, 0.6, 0.5, 0.5, '#8a8d84', pr.ry);
        propSoup.add(pr.x + 0.3, 0.15, pr.z + 0.2, 0.35, 0.3, 0.3, '#7a7d74', pr.ry);
      } else if (pr.kind === 'shell') {
        propSoup.add(pr.x, 0.08, pr.z, 0.3, 0.16, 0.3, '#f5e6d0', pr.ry);
      } else {
        propSoup.add(pr.x, 0.35, pr.z, 0.5, 0.7, 0.5, '#e85d04', pr.ry);
        propSoup.add(pr.x, 0.75, pr.z, 0.28, 0.15, 0.28, '#f5efe0', pr.ry);
      }
    }
    scene.add(propSoup.build(lambertVertex()));

    // --- 36 seaweed tufts along the waterline: crossed blades, merged ---
    const weedSoup = new BoxSoup();
    const WEED_COLS = ['#2f6b3a', '#3a7d44', '#256b32'];
    for (let t = 0; t < 36; t++) {
      const wx = -320 + t * 18 + (hash2(t, 1, 61) - 0.5) * 10;
      const wz = 300 + hash2(t, 2, 61) * 8;
      for (let blade = 0; blade < 3; blade++) {
        const bh = 0.5 + hash2(t, blade, 62) * 0.45;
        const tilt = (hash2(t, blade, 63) - 0.5) * 0.7;
        weedSoup.add(wx, bh / 2, wz, 0.12, bh, 0.12, WEED_COLS[(t + blade) % 3], hash2(t, blade, 64) * Math.PI, tilt);
      }
    }
    scene.add(weedSoup.build(lambertVertex()));

    // --- parked cars: static instanced pools on the road edges (5 draw
    // calls for the whole fleet — body, glass, rear glass, roof, wheels) ---
    if (L.parked.length) {
      const pkBody = new THREE.InstancedMesh(taperedBody(4.4, 1.9, 0.75), new THREE.MeshLambertMaterial({ color: 0xffffff }), L.parked.length);
      const pkGlassGeo = new THREE.BoxGeometry(0.1, 0.62, 1.66); pkGlassGeo.rotateZ(-0.42);
      const pkGlass = new THREE.InstancedMesh(pkGlassGeo, new THREE.MeshLambertMaterial({ color: 0x16202c }), L.parked.length);
      const pkRearGeo = new THREE.BoxGeometry(0.1, 0.55, 1.6); pkRearGeo.rotateZ(0.4);
      const pkRear = new THREE.InstancedMesh(pkRearGeo, new THREE.MeshLambertMaterial({ color: 0x16202c }), L.parked.length);
      const pkRoof = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.12, 1.72), new THREE.MeshLambertMaterial({ color: 0xffffff }), L.parked.length);
      const pkWheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10); pkWheelGeo.rotateX(Math.PI / 2);
      const pkWheels = new THREE.InstancedMesh(pkWheelGeo, new THREE.MeshLambertMaterial({ color: 0x14161a }), L.parked.length * 4);
      L.parked.forEach((pk, i) => {
        const fx = Math.cos(pk.ry), fz = -Math.sin(pk.ry);
        dummy.rotation.set(0, pk.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.position.set(pk.x, 0.62, pk.z); dummy.updateMatrix();
        pkBody.setMatrixAt(i, dummy.matrix); pkBody.setColorAt(i, tmpColor.set(pk.color));
        dummy.position.set(pk.x + fx * 0.85, 1.05, pk.z + fz * 0.85); dummy.updateMatrix();
        pkGlass.setMatrixAt(i, dummy.matrix);
        dummy.position.set(pk.x - fx * 0.95, 1.02, pk.z - fz * 0.95); dummy.updateMatrix();
        pkRear.setMatrixAt(i, dummy.matrix);
        dummy.position.set(pk.x - fx * 0.1, 1.38, pk.z - fz * 0.1); dummy.updateMatrix();
        pkRoof.setMatrixAt(i, dummy.matrix); pkRoof.setColorAt(i, tmpColor.set(pk.color));
        for (let wI = 0; wI < 4; wI++) {
          const wx = wI < 2 ? 1.45 : -1.45, wz = (wI % 2 === 0 ? -0.85 : 0.85);
          dummy.position.set(pk.x + fx * wx - Math.sin(pk.ry) * wz, 0.36, pk.z + fz * wx - Math.cos(pk.ry) * wz);
          dummy.updateMatrix();
          pkWheels.setMatrixAt(i * 4 + wI, dummy.matrix);
        }
      });
      scene.add(pkBody, pkGlass, pkRear, pkRoof, pkWheels);
    }

    // --- street-name signs: pole + green board + white band, merged ---
    const signSoup = new BoxSoup();
    for (const sg of L.signs) {
      signSoup.add(sg.x, 1.5, sg.z, 0.12, 3, 0.12, '#2f3540', sg.ry);
      signSoup.add(sg.x, 2.9, sg.z, 1.7, 0.55, 0.08, '#1f6f3a', sg.ry);
      signSoup.add(sg.x, 2.9, sg.z, 1.5, 0.1, 0.1, '#f5efe0', sg.ry);
    }
    scene.add(signSoup.build(lambertVertex()));

    // --- street lamps: pole + arm + head + glow ---
    const lampSoup = new BoxSoup();
    const lampGlow = [];
    for (const lp of L.lamps) {
      lampSoup.add(lp.x, 2.6, lp.z, 0.16, 5.2, 0.16, '#2f3540');
      lampSoup.add(lp.x, 5.1, lp.z + 0.9, 0.14, 0.14, 1.9, '#2f3540');
      lampSoup.add(lp.x, 5.0, lp.z + 1.7, 0.5, 0.18, 0.3, '#3a4048');
      lampGlow.push({ x: lp.x, y: 4.9, z: lp.z + 1.7 });
    }
    scene.add(lampSoup.build(lambertVertex()));
    const glowGeo = new THREE.SphereGeometry(0.3, 8, 6);
    this.lampGlows = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffd98a }), lampGlow.length);
    lampGlow.forEach((g, i) => { dummy.position.set(g.x, g.y, g.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.lampGlows.setMatrixAt(i, dummy.matrix); });
    scene.add(this.lampGlows);

    // --- stadium bowl + floodlights ---
    const stSoup = new BoxSoup();
    const cx = STADIUM.x, cz = STADIUM.z;
    for (let aI = 0; aI < 20; aI++) {
      const a = (aI / 20) * Math.PI * 2;
      stSoup.add(cx + Math.cos(a) * 26, 4, cz + Math.sin(a) * 26, 8, 8, 3, '#b08968', -a);
      stSoup.add(cx + Math.cos(a) * 26, 8.5, cz + Math.sin(a) * 26, 8, 1, 3, '#e9c46a', -a);
    }
    stSoup.add(cx, 0.2, cz, 34, 0.4, 22, '#5d9c4a');
    for (const [fx, fz] of [[-30, -20], [30, -20], [-30, 20], [30, 20]]) {
      stSoup.add(cx + fx, 9, cz + fz, 0.4, 18, 0.4, '#3a3a3a');
      stSoup.add(cx + fx, 18.2, cz + fz, 3.4, 1.6, 0.4, '#2f3540');
    }
    scene.add(stSoup.build(lambertVertex()));
    const floodGeo = new THREE.BoxGeometry(3.2, 1.4, 0.2);
    this.floods = new THREE.InstancedMesh(floodGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c0 }), 4);
    [[-30, -20], [30, -20], [-30, 20], [30, 20]].forEach(([fx, fz], i) => {
      dummy.position.set(cx + fx, 18.2, cz + fz); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      this.floods.setMatrixAt(i, dummy.matrix);
    });
    scene.add(this.floods);

    // --- pier: planks + posts + rails, and marina boats ---
    const pierSoup = new BoxSoup();
    for (let x = GRID_MAX; x <= PIER.x; x += 1.3) {
      pierSoup.add(x, 0.12, CAUSEWAY_Z, 1.2, 0.25, 7, hash2(Math.round(x), 1, 61) < 0.5 ? '#8a6a42' : '#7a5a38');
    }
    for (let x = GRID_MAX + 6; x <= PIER.x; x += 12) {
      pierSoup.add(x, 0.7, CAUSEWAY_Z - 3.6, 0.3, 1.4, 0.3, '#5a4630');
      pierSoup.add(x, 0.7, CAUSEWAY_Z + 3.6, 0.3, 1.4, 0.3, '#5a4630');
      pierSoup.add(x, 1.5, CAUSEWAY_Z - 3.6, 0.2, 0.2, 0.2, '#6b4a2f');
      pierSoup.add(x, 1.5, CAUSEWAY_Z + 3.6, 0.2, 0.2, 0.2, '#6b4a2f');
    }
    pierSoup.add(PIER.x, 0.12, CAUSEWAY_Z, 16, 0.3, 16, '#8a6a42');
    for (let i = 0; i < 8; i++) {
      const bx = 310 + i * 16, bz = -70 + i * 30;
      pierSoup.add(bx, 0.5, bz, 6, 1, 2.4, i % 2 ? '#e9e4d8' : '#c0392b');
      pierSoup.add(bx, 1.6, bz - 0.6, 5.4, 0.5, 0.4, '#2f3540');
      pierSoup.add(bx + 1, 4.5, bz, 0.14, 7, 0.14, '#6b4a2f');
      pierSoup.add(bx + 1, 3.4, bz + 1.2, 0.08, 3.4, 2.2, '#f5efe0', 0, 0.35);
    }
    // sailboats out on the open sea so the water reads inhabited, not empty
    for (const [sx, sz] of [[-140, 345], [30, 355], [190, 342]]) {
      pierSoup.add(sx, 0.6, sz, 5, 1, 2, '#e9e4d8');
      pierSoup.add(sx, 1.4, sz, 4.4, 0.5, 1.6, '#2f3540');
      pierSoup.add(sx, 4.5, sz, 0.14, 8, 0.14, '#6b4a2f');
      pierSoup.add(sx + 0.8, 4.2, sz, 0.1, 4.5, 2.6, '#f5efe0', 0, 0.3);
    }
    // --- beach pier: a wooden pier jutting south off the sand at x = -6,
    // with the SOLMARINA sign at its end. Planks + posts go into the
    // merged pier soup (+0 draw calls); the neon text is one
    // canvas-texture plane (text drawn on canvas, not letter geometry).
    for (let z = 300; z <= 338; z += 1.3) {
      pierSoup.add(-6, 0.12, z, 7, 0.25, 1.2, hash2(Math.round(z), 1, 63) < 0.5 ? '#8a6a42' : '#7a5a38');
    }
    for (let z = 306; z <= 338; z += 12) {
      pierSoup.add(-6 - 3.4, 0.7, z, 0.3, 1.6, 0.3, '#5a4630');
      pierSoup.add(-6 + 3.4, 0.7, z, 0.3, 1.6, 0.3, '#5a4630');
    }
    // sign posts + wooden board at the pier end, facing the beach (north).
    // Posts sit at the board's outer edges (x -11.9 / -0.1): the old posts
    // at -10.5 / -1.5 stood inside the text span and cut the S and the A.
    pierSoup.add(-11.9, 3.4, 312, 0.5, 6.8, 0.5, '#4a3520');
    pierSoup.add(-0.1, 3.4, 312, 0.5, 6.8, 0.5, '#4a3520');
    pierSoup.add(-6, 4.9, 312, 12.5, 2.6, 0.35, '#6b4a2f');
    pierSoup.add(-6, 6.35, 312, 12.7, 0.3, 0.45, '#4a3520');
    scene.add(pierSoup.build(lambertVertex()));
    // neon SOLMARINA text: pink glow on canvas, one plane in front of the
    // board (board face at z = 311.825, plane at 311.8, facing north)
    const sc = document.createElement('canvas');
    sc.width = 1024; sc.height = 224;
    const sctx = sc.getContext('2d');
    sctx.clearRect(0, 0, 1024, 224);
    sctx.font = '900 148px system-ui, sans-serif';
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    sctx.shadowColor = '#ff2a6d'; sctx.shadowBlur = 42;
    sctx.fillStyle = '#ff5e8a';
    sctx.fillText('SOLMARINA', 512, 116);
    sctx.shadowBlur = 12; sctx.fillStyle = '#ffe3ee';
    sctx.fillText('SOLMARINA', 512, 116);
    const signTex = new THREE.CanvasTexture(sc);
    signTex.colorSpace = THREE.SRGBColorSpace;
    this.solmarinaSign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 2.4),
      new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
    );
    this.solmarinaSign.position.set(-6, 4.9, 311.8);
    this.solmarinaSign.rotation.y = Math.PI;
    scene.add(this.solmarinaSign);
    R7_dressing(this.scene, L);
    K12_heroBeach(this.scene);
    // K10_ boulevard palms: six simplified palms lining both sides of
    // the coast road (z = 240) so the cover reads as a palm boulevard.
    // Fresh K10_ code with its own hash — trunk 3 segments + 2 bands +
    // a 5-frond crown = 10 boxes per palm, 6 palms = 60 boxes = 720 tris.
    const K10_hash = (n) => {
      const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const K10_trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
    const K10_bandMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
    const K10_frondMat = new THREE.MeshLambertMaterial({ color: 0x2f7a2e });
    const K10_frondGeo = new THREE.BoxGeometry(2.4, 0.07, 0.55);
    K10_frondGeo.translate(1.2, 0, 0);
    const K10_spots = [
      [-35, 234, 9.2], [-60, 234, 8.6], [-85, 234, 9.5],
      [-20, 247, 8.9], [-50, 247, 9.4], [-80, 247, 8.7],
    ];
    for (let i = 0; i < K10_spots.length; i++) {
      const [K10_px, K10_pz, K10_ph] = K10_spots[i];
      const K10_lean = (K10_hash(i * 3 + 1) - 0.5) * 0.12;
      for (let seg = 0; seg < 3; seg++) {
        const K10_segH = K10_ph / 3;
        const K10_trunk = new THREE.Mesh(
          new THREE.BoxGeometry(0.36 - seg * 0.04, K10_segH + 0.08, 0.36 - seg * 0.04),
          K10_trunkMat,
        );
        K10_trunk.position.set(K10_px + K10_lean * seg, K10_segH * (seg + 0.5), K10_pz);
        this.scene.add(K10_trunk);
      }
      for (const K10_bf of [0.38, 0.72]) {
        const K10_band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.46), K10_bandMat);
        K10_band.position.set(K10_px + K10_lean, K10_ph * K10_bf, K10_pz);
        this.scene.add(K10_band);
      }
      for (let f = 0; f < 5; f++) {
        const K10_frond = new THREE.Mesh(K10_frondGeo, K10_frondMat);
        K10_frond.position.set(K10_px + K10_lean * 2, K10_ph, K10_pz);
        K10_frond.rotation.set(0, (f / 5) * Math.PI * 2 + K10_hash(i * 7 + f) * 0.5, -0.45 - K10_hash(i + f * 3) * 0.15);
        this.scene.add(K10_frond);
      }
    }
  }

  pushWindow(dark, lit, mull, b, x, y, z, ry, h, side = false) {
    const px = side ? x : b.x + x;
    const pz = side ? b.z + z : z;
    const roll = hash2(Math.round(px), Math.round(y), Math.round(pz));
    // Three in five windows glow warm at dusk; the brightest sixth of
    // those burns a paler gold. The rest stay dark glass.
    const litUp = roll < 0.6;
    const shade = litUp ? (roll < 0.16 ? '#ffd98a' : '#ffb347') : '#2a3648';
    (litUp ? lit : dark).push({ x: px, y, z: pz, ry, color: shade });
    // K16_ mullion thinning, rewritten from scratch. One thin proud
    // bar per window pane on low-rise (h<=20): 3,980 bars x 12 tris =
    // 47,760 tris, the biggest single low-value pool in the scene —
    // a 0.09 m bar is sub-pixel at cover distance and under 2 px at
    // street level, so it buys nothing the glass itself does not
    // already give. K16 keeps a bar only when a fresh hash (salt 71,
    // per pane position) falls under 0.95: 3,980 -> 3,808 bars,
    // -2,064 tris, with 19 of 20 panes still barred and the strand
    // row (cover-visible) effectively untouched. Window glass, lit
    // colours and counts are unchanged.
    if (b.h <= 20 && hash2(Math.round(px), Math.round(pz), 71) < 0.95) {
      const K16_offX = (ry === 0 || ry === Math.PI) ? 0 : Math.sin(ry) * 0.1;
      const K16_offZ = ry === 0 ? 0.08 : ry === Math.PI ? -0.08 : 0;
      mull.push({ x: px + K16_offX, y, z: pz + K16_offZ, ry });
    }
  }

  K8_buildSky() {
    // Kumala sky: deep purple-to-gold sunset, big low sun with anamorphic
    // glare, bright sun-path glitter on the sea, tall overlapping cloud
    // puffs. Deterministic hash variation only — no random calls anywhere.
    const K8_h = (n) => {
      const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
      return s - Math.floor(s);
    };
    const K8_canvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    const K8_radial = (ctx, x, y, r, stops) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    };

    // ---- sky dome: rich sunset gradient painted once here; update()
    // repaints this same canvas per 0.25h bucket with the live palette.
    this.skyCanvas = K8_canvas(512, 256);
    const sctx = this.skyCanvas.getContext('2d');
    const sgrad = sctx.createLinearGradient(0, 0, 0, 256);
    sgrad.addColorStop(0.0, '#3a1c58');
    sgrad.addColorStop(0.22, '#5e2560');
    sgrad.addColorStop(0.42, '#8f2f66');
    sgrad.addColorStop(0.58, '#c14a63');
    sgrad.addColorStop(0.72, '#ef7a4e');
    sgrad.addColorStop(0.84, '#ffb347');
    sgrad.addColorStop(0.93, '#ffd27a');
    sgrad.addColorStop(1.0, '#ff9e57');
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 512, 256);
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    // No mipmaps: the sphere's UV seam (u 0/1) makes the sampler jump to
    // the 1x1 mip there, painting a soft orange vertical band — the dome's
    // average colour — right next to the sun. Linear filtering on the
    // full-res texture keeps the seam invisible.
    this.skyTex.generateMipmaps = false;
    this.skyTex.minFilter = THREE.LinearFilter;
    this.skyBucket = -1;
    const domeGeo = new THREE.SphereGeometry(1200, 32, 18);
    const domeMat = new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
    this.skyDome = new THREE.Mesh(domeGeo, domeMat);
    // Turn the UV seam to the east, behind the city, away from the sunset.
    this.skyDome.rotation.y = Math.PI;
    this.scene.add(this.skyDome);

    // ---- sun: bigger solid disc, wide warm halo, huge anamorphic glare.
    const discC = K8_canvas(256, 256);
    const dctx = discC.getContext('2d');
    K8_radial(dctx, 128, 128, 128, [
      [0, 'rgba(255,253,244,1)'],
      [0.42, 'rgba(255,232,176,1)'],
      [0.68, 'rgba(255,178,92,1)'],
      [0.86, 'rgba(255,138,58,0.55)'],
      [1, 'rgba(255,120,40,0)'],
    ]);
    const discTex = new THREE.CanvasTexture(discC);
    discTex.colorSpace = THREE.SRGBColorSpace;
    this.sunDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(118, 118),
      new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, fog: false })
    );
    this.sunDisc.renderOrder = 4;
    this.scene.add(this.sunDisc);

    const haloC = K8_canvas(256, 256);
    const hctx = haloC.getContext('2d');
    K8_radial(hctx, 128, 128, 128, [
      [0, 'rgba(255,198,122,0.6)'],
      [0.35, 'rgba(255,168,96,0.34)'],
      [0.68, 'rgba(255,138,72,0.14)'],
      [1, 'rgba(255,130,70,0)'],
    ]);
    const haloTex = new THREE.CanvasTexture(haloC);
    haloTex.colorSpace = THREE.SRGBColorSpace;
    this.sunHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(390, 390),
      new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0.9, depthWrite: false, fog: false })
    );
    this.sunHalo.renderOrder = 5;
    this.scene.add(this.sunHalo);

    const glareC = K8_canvas(512, 512);
    const gctx = glareC.getContext('2d');
    K8_radial(gctx, 256, 256, 256, [
      [0, 'rgba(255,228,172,0.85)'],
      [0.22, 'rgba(255,198,122,0.5)'],
      [0.5, 'rgba(255,164,92,0.2)'],
      [0.78, 'rgba(255,140,70,0.06)'],
      [1, 'rgba(255,140,70,0)'],
    ]);
    gctx.save();
    gctx.translate(256, 256);
    gctx.scale(1, 0.16);
    const hstreak = gctx.createRadialGradient(0, 0, 0, 0, 0, 252);
    hstreak.addColorStop(0, 'rgba(255,242,204,0.6)');
    hstreak.addColorStop(0.45, 'rgba(255,204,132,0.26)');
    hstreak.addColorStop(1, 'rgba(255,180,100,0)');
    gctx.fillStyle = hstreak;
    gctx.fillRect(-256, -256, 512, 512);
    gctx.restore();
    const glareTex = new THREE.CanvasTexture(glareC);
    glareTex.colorSpace = THREE.SRGBColorSpace;
    this.sunGlare = new THREE.Mesh(
      new THREE.PlaneGeometry(720, 720),
      new THREE.MeshBasicMaterial({ map: glareTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
    );
    this.sunGlare.renderOrder = 6;
    this.scene.add(this.sunGlare);

    // ---- sea glitter: a confined sun-path, dimmer now — the old hot sheet
    // washed the whole beach white. Ends fade out so the bright path
    // stays in the middle of the plane. update() lays this flat on the
    // sea and aims its long axis at the sun.
    const glitC = K8_canvas(512, 256);
    const lctx = glitC.getContext('2d');
    const band = lctx.createLinearGradient(0, 88, 0, 168);
    band.addColorStop(0, 'rgba(255,186,104,0)');
    band.addColorStop(0.5, 'rgba(255,196,116,0.38)');
    band.addColorStop(1, 'rgba(255,186,104,0)');
    lctx.fillStyle = band;
    lctx.fillRect(0, 88, 512, 80);
    const core = lctx.createLinearGradient(0, 116, 0, 140);
    core.addColorStop(0, 'rgba(255,214,140,0)');
    core.addColorStop(0.5, 'rgba(255,240,196,0.65)');
    core.addColorStop(1, 'rgba(255,214,140,0)');
    lctx.fillStyle = core;
    lctx.fillRect(0, 116, 512, 24);
    for (let i = 0; i < 60; i++) {
      const gx = K8_h(i * 3 + 1) * 512;
      const gy = 128 + (K8_h(i * 7 + 2) - 0.5) * 72;
      const gw = 4 + K8_h(i * 5 + 3) * 22;
      const gh = 1 + K8_h(i * 11 + 4) * 2;
      const ga = 0.12 + K8_h(i * 13 + 5) * 0.3;
      lctx.fillStyle = 'rgba(255,224,158,' + ga.toFixed(3) + ')';
      lctx.fillRect(gx - gw / 2, gy - gh / 2, gw, gh);
    }
    lctx.globalCompositeOperation = 'destination-in';
    const fade = lctx.createLinearGradient(0, 0, 512, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.18, 'rgba(0,0,0,1)');
    fade.addColorStop(0.82, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = fade;
    lctx.fillRect(0, 0, 512, 256);
    lctx.globalCompositeOperation = 'source-over';
    this.glitterTex = new THREE.CanvasTexture(glitC);
    this.glitterTex.colorSpace = THREE.SRGBColorSpace;
    const glitGeo = new THREE.PlaneGeometry(470, 150);
    glitGeo.rotateX(-Math.PI / 2);
    this.glitter = new THREE.Mesh(
      glitGeo,
      new THREE.MeshBasicMaterial({ map: this.glitterTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    this.glitter.renderOrder = 3;
    this.scene.add(this.glitter);

    // ---- K17_ clouds: soft wispy strata, not faceted spheres. The
    // K16_ low-segment spheres read as pale hexagons at 2K, so the
    // clusters are rebuilt here as merged soft-alpha planes facing the
    // city (K17_buildClouds, same 12 clusters / 12 draw calls, ~290
    // triangles instead of ~9,200). Tint/opacity still driven in
    // update() via this.K17_cloudMats.
    const K17_clouds = K17_buildClouds(this.scene);
    this.clouds = K17_clouds.groups;
    this.K17_cloudMats = K17_clouds.materials;

    // ---- stars: upper hemisphere, invisible by day (update() fades in).
    const starN = 340;
    const starPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const a = K8_h(i * 3 + 1) * Math.PI * 2;
      const y = 130 + K8_h(i * 3 + 2) * 950;
      const rr = Math.sqrt(Math.max(60 * 60, 1150 * 1150 - y * y));
      starPos[i * 3] = Math.cos(a) * rr;
      starPos[i * 3 + 1] = y;
      starPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff3cf, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = 2;
    this.scene.add(this.stars);
  }
  rebuildShadows(hour) {
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    if (elev < 0.08) { this.shadowMesh.visible = false; return; }
    const dirLen = Math.hypot(Math.cos(ang), 0.45);
    const sx = -Math.cos(ang) / dirLen, sz = -0.45 / dirLen;
    const tanElev = Math.max(0.05, elev / Math.max(0.2, Math.sqrt(1 - elev * elev)));
    const pos = [];
    const idx = [];
    let base = 0;
    const hull = (pts) => {
      const sorted = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lower = [];
      for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
      const upper = [];
      for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
      lower.pop(); upper.pop();
      return lower.concat(upper);
    };
    for (const b of this.camBlockers) {
      const len = Math.min(b.h / tanElev, 60);
      const corners = [
        [b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1],
      ];
      const projected = corners.map(([cx, cz]) => [cx + sx * len, cz + sz * len]);
      const poly = hull(corners.concat(projected));
      if (poly.length < 3) continue;
      for (const [px, pz] of poly) pos.push(px, 0.05, pz);
      for (let k = 1; k < poly.length - 1; k++) idx.push(base, base + k, base + k + 1);
      base += poly.length;
    }
    this.shadowMesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.shadowMesh.geometry = g;
    this.shadowMesh.visible = pos.length > 0;
  }

  // ---- dynamic pools: traffic, hero, peds, heli, shells ----
  buildDynamic() {
    const scene = this.scene;
    // capacities: 60 traffic (42 sedan-kind + 6 van + 12 scooter) + 6 police
    // sedans + the gold van = 48 sedans, 7 vans, 12 scooters at most;
    // wheels are 4 per car over all kinds
    const N = 56; // sedan-kind bodies / glass / roofs / lights
    const NV = 12; // van bodies
    const NS = 12; // scooter bodies
    const NW = 320; // wheels + hubs, 4 per car
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const darkGlass = new THREE.MeshLambertMaterial({ color: 0x16202c });
    const mk = (geo, mat, count) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.carBodySedan = mk(taperedBody(4.4, 1.9, 0.75), white.clone(), N);
    this.carBodyVan = mk(taperedBody(5.2, 2.0, 1.5, 0.9), white.clone(), NV);
    this.carBodyScooter = mk(new THREE.BoxGeometry(1.9, 0.5, 0.7), white.clone(), NS);
    const glassGeo = new THREE.BoxGeometry(0.1, 0.62, 1.66);
    glassGeo.rotateZ(-0.42);
    this.carGlass = mk(glassGeo, darkGlass, N);
    const rearGeo = new THREE.BoxGeometry(0.1, 0.55, 1.6);
    rearGeo.rotateZ(0.4);
    this.carGlassRear = mk(rearGeo, darkGlass, N);
    this.carRoof = mk(new THREE.BoxGeometry(2.1, 0.12, 1.72), white.clone(), N);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10);
    wheelGeo.rotateX(Math.PI / 2);
    this.carWheels = mk(wheelGeo, new THREE.MeshLambertMaterial({ color: 0x14161a }), NW);
    const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8);
    hubGeo.rotateX(Math.PI / 2);
    this.carHubs = mk(hubGeo, new THREE.MeshLambertMaterial({ color: 0xb8bec8 }), NW);
    this.carHead = mk(new THREE.BoxGeometry(0.1, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }), N * 2);
    this.carTail = mk(new THREE.BoxGeometry(0.1, 0.14, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), N * 2);
    this.carTaxi = mk(new THREE.BoxGeometry(0.7, 0.2, 0.34), new THREE.MeshBasicMaterial({ color: 0xf1c40f }), N);
    this.carBar = mk(new THREE.BoxGeometry(0.3, 0.16, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff }), 12);
    this.carPush = mk(new THREE.BoxGeometry(0.5, 0.34, 1.8), new THREE.MeshLambertMaterial({ color: 0x1c1f24 }), 12);
    // sedan grille + side mirrors, pooled: one dark grille slab on the
    // nose and a mirror on each front door, so a sedan reads as a car
    // with a face instead of a smooth coloured wedge
    this.carGrille = mk(new THREE.BoxGeometry(0.1, 0.22, 1.1), new THREE.MeshLambertMaterial({ color: 0x22262c }), N);
    this.carMirror = mk(new THREE.BoxGeometry(0.22, 0.12, 0.16), new THREE.MeshLambertMaterial({ color: 0x22262c }), N * 2);

    // hero sports car — one detailed group, not an instance
    this.heroCar = new THREE.Group();
    const heroMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
    const body = new THREE.Mesh(taperedBody(4.6, 2.0, 0.72, 0.78), heroMat);
    body.position.y = 0.62;
    this.heroCar.add(body);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 1.7), new THREE.MeshLambertMaterial({ color: 0xc0392b }));
    hood.position.set(1.55, 0.95, 0);
    this.heroCar.add(hood);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x101c28 });
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 1.7), glassMat);
    shield.position.set(0.75, 1.15, 0); shield.rotation.z = -0.5;
    this.heroCar.add(shield);
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 1.65), glassMat);
    rearGlass.position.set(-0.95, 1.12, 0); rearGlass.rotation.z = 0.45;
    this.heroCar.add(rearGlass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.6), heroMat);
    roof.position.set(-0.1, 1.42, 0);
    this.heroCar.add(roof);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.9), new THREE.MeshLambertMaterial({ color: 0x1c1f24 }));
    spoiler.position.set(-2.15, 1.25, 0);
    this.heroCar.add(spoiler);
    for (const sx of [-0.08, 0.08]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), spoiler.material);
      strut.position.set(-2.15, 1.05, sx * 8);
      this.heroCar.add(strut);
    }
    // K10_ rear-deck louvers: five thin dark slats across the exposed red
    // deck strip just ahead of the spoiler, like the vented deck on the
    // orange sports car — 5 boxes = 60 tris. (First try at x -1.6 sat
    // under the black rear window and was invisible; the strip at x -2.0
    // is the deck the cover/chase cameras can actually see, through the
    // gap under the spoiler.)
    for (let li = 0; li < 5; li++) {
      const K10_slat = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.22), spoiler.material);
      K10_slat.position.set(-2.0, 1.05, -0.48 + li * 0.24);
      K10_slat.rotation.z = 0.1;
      this.heroCar.add(K10_slat);
    }
    // grille, bumpers, mirrors, skirts, lights
    const bumperMat = new THREE.MeshLambertMaterial({ color: 0x22262c });
    for (const [bx, bw] of [[2.28, 0.3], [-2.28, 0.3]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 1.9), bumperMat);
      b.position.set(bx, 0.45, 0);
      this.heroCar.add(b);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 1.1), bumperMat);
    grille.position.set(2.32, 0.72, 0);
    this.heroCar.add(grille);
    for (const mz of [-1.02, 1.02]) {
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.16), bumperMat);
      mir.position.set(0.7, 1.05, mz);
      this.heroCar.add(mir);
    }
    for (const sz of [-0.95, 0.95]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.1), bumperMat);
      skirt.position.set(0, 0.32, sz);
      this.heroCar.add(skirt);
    }
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
    for (const hz of [-0.62, 0.62]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.4), headMat);
      h.position.set(2.32, 0.78, hz);
      this.heroCar.add(h);
    }
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    for (const tz of [-0.62, 0.62]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.4), tailMat);
      t.position.set(-2.32, 0.78, tz);
      this.heroCar.add(t);
    }
    // full-width LED light bars: the hero car reads at thumbnail size —
    // a single red bar across the rear + a white bar across the nose
    const rearBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 1.7), tailMat);
    rearBar.position.set(-2.33, 0.82, 0);
    this.heroCar.add(rearBar);
    const frontBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 1.7), headMat);
    frontBar.position.set(2.33, 0.82, 0);
    this.heroCar.add(frontBar);
    const wheelG = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
    wheelG.rotateX(Math.PI / 2);
    const wheelM = new THREE.MeshLambertMaterial({ color: 0x14161a });
    const hubM = new THREE.MeshLambertMaterial({ color: 0xd8dde6 });
    for (const [wx, wz] of [[1.5, -0.95], [1.5, 0.95], [-1.5, -0.95], [-1.5, 0.95]]) {
      const w = new THREE.Mesh(wheelG, wheelM);
      w.position.set(wx, 0.38, wz);
      this.heroCar.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.32, 8).rotateX(Math.PI / 2), hubM);
      hub.position.set(wx, 0.38, wz);
      this.heroCar.add(hub);
    }
    scene.add(this.heroCar);

    // hero on foot — detailed figure (tee, belt, shoes, skin arms, hair)
    this.heroWalk = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
    const tee = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
    const pantsM = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    const addBox = (parent, w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    this.heroLegL = addBox(this.heroWalk, 0.17, 0.8, 0.17, pantsM, 0, 0.4, 0.11);
    this.heroLegR = addBox(this.heroWalk, 0.17, 0.8, 0.17, pantsM, 0, 0.4, -0.11);
    addBox(this.heroWalk, 0.2, 0.1, 0.2, new THREE.MeshLambertMaterial({ color: 0xf5f0e6 }), 0, 0.05, 0.11);
    addBox(this.heroWalk, 0.2, 0.1, 0.2, new THREE.MeshLambertMaterial({ color: 0xf5f0e6 }), 0, 0.05, -0.11);
    addBox(this.heroWalk, 0.56, 0.72, 0.34, tee, 0, 1.16, 0);
    addBox(this.heroWalk, 0.58, 0.1, 0.36, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), 0, 0.82, 0);
    this.heroArmL = addBox(this.heroWalk, 0.15, 0.62, 0.15, skin, 0, 1.2, 0.26);
    this.heroArmR = addBox(this.heroWalk, 0.15, 0.62, 0.15, skin, 0, 1.2, -0.26);
    addBox(this.heroWalk, 0.34, 0.34, 0.32, skin, 0, 1.72, 0);
    addBox(this.heroWalk, 0.36, 0.12, 0.34, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), 0, 1.92, 0);
    scene.add(this.heroWalk);

    // peds: instanced pools, white materials so setColorAt shows.
    // Sized from the live ped count (48 sidewalk + 24 market + 24 beach
    // + 12 vendors = 108) so the pools never clip the crowd.
    const pedWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const P = this.world.state.peds.length;
    this.pedTorso = mk(new THREE.BoxGeometry(0.34, 0.68, 0.56), pedWhite.clone(), P);
    this.pedHead = mk(new THREE.BoxGeometry(0.32, 0.32, 0.3), pedWhite.clone(), P);
    this.pedHair = mk(new THREE.BoxGeometry(0.34, 0.13, 0.32), pedWhite.clone(), P);
    const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.14);
    armGeo.translate(0, -0.3, 0);
    this.pedArmL = mk(armGeo, pedWhite.clone(), P);
    this.pedArmR = mk(armGeo, pedWhite.clone(), P);
    const legGeo = new THREE.BoxGeometry(0.16, 0.74, 0.16);
    legGeo.translate(0, -0.37, 0);
    this.pedLegL = mk(legGeo, pedWhite.clone(), P);
    this.pedLegR = mk(legGeo, pedWhite.clone(), P);
    this.pedColorsSet = false;

    // Helicopter — built as a machine, not a speck: a slim body, a long
    // tail boom and a tall fin, so the silhouette still reads as a
    // helicopter from below-front, where the cover camera sees it.
    this.heli = new THREE.Group();
    const heliWhite = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
    const heliDark = new THREE.MeshLambertMaterial({ color: 0x2f3540 });
    const heliPart = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.heli.add(m);
      return m;
    };
    const heliBox = (w, h, d, mat, x, y, z) => heliPart(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    const heliBody = heliPart(taperedBody(3.6, 1.7, 1.5, 0.85), heliWhite, 0, 0, 0);
    heliBody.position.y = 0;
    heliBox(1.3, 1.0, 1.7, new THREE.MeshLambertMaterial({ color: 0x101c28 }), 1.4, 0.1, 0);
    heliBox(0.08, 1.0, 0.1, heliWhite, 1.4, 0.1, 0);
    heliBox(3.7, 0.22, 1.72, new THREE.MeshLambertMaterial({ color: 0xd4af37 }), 0, 0.55, 0);
    heliBox(4.2, 0.4, 0.4, heliWhite, -3.6, 0.35, 0);
    heliBox(1.1, 1.6, 0.12, heliWhite, -5.5, 1.0, 0);
    heliBox(0.7, 0.1, 2.2, heliWhite, -4.6, 0.4, 0);
    for (const sz of [-0.8, 0.8]) {
      heliBox(3.0, 0.08, 0.08, heliDark, 0, -1.0, sz);
      for (const sx of [-1.1, 1.1]) heliBox(0.08, 0.4, 0.08, heliDark, sx, -0.8, sz);
    }
    this.rotor = new THREE.Group();
    for (const a of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 7.6), new THREE.MeshLambertMaterial({ color: 0x1c1f24 }));
      bar.rotation.y = a;
      this.rotor.add(bar);
    }
    this.rotor.position.y = 1.15;
    this.heli.add(this.rotor);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 1.15;
    this.heli.add(disc);
    this.rotorDisc = disc; // cover staging brightens it (bigger rotor blur)
    heliPart(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), -5.5, 0.2, -0.3);
    heliPart(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0x2aff5a }), -5.5, 0.2, 0.3);
    // K16_ searchlight: two nested cones, apex UP at the heli, widening
    // toward the ground — a real searchlight, not the old inverted wedge
    // (wide at the heli, point at the road) that read as a solid white
    // triangle. Outer cone radius 1.0 at the ground, inner core 0.45;
    // both carry a vertical alpha-gradient texture (bright at the heli,
    // fading out before the ground) so the beam has soft edges and never
    // dominates the frame. Staging opacities live in update().
    const K16_beamGrad = (() => {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 128;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 4, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const K16_beamOuter = new THREE.Mesh(
      new THREE.ConeGeometry(1.0, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff6c8, map: K16_beamGrad, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    );
    K16_beamOuter.position.set(1.2, -7, 0);
    this.heli.add(K16_beamOuter);
    const K16_beamInner = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfffbe8, map: K16_beamGrad, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    K16_beamInner.position.set(1.2, -7, 0);
    this.heli.add(K16_beamInner);
    this.heliBeam = K16_beamOuter; // cover staging brightens it (visible searchlight)
    this.heliBeamInner = K16_beamInner; // K16_: narrow bright core
    this.heli.visible = false;
    scene.add(this.heli);

    // golden shells
    this.shells = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.4),
      new THREE.MeshBasicMaterial({ color: 0xffd700 }),
      20,
    );
    this.shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shells.frustumCulled = false;
    scene.add(this.shells);

    // drift smoke: 28 pooled soft puffs behind the hero car, one
    // InstancedMesh, zero per-frame allocation. The puffs cycle on
    // renderer time (the staged sim is frozen), so the cloud is fully
    // formed from the first captured frame. Billboards, not spheres: a
    // soft radial-gradient disc reads as smoke, while hard spheres read
    // as white balls against the dark asphalt.
    const smc = document.createElement('canvas');
    smc.width = smc.height = 128;
    const smctx = smc.getContext('2d');
    const smg = smctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    smg.addColorStop(0, 'rgba(255,255,255,0.85)');
    smg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    smg.addColorStop(1, 'rgba(255,255,255,0)');
    smctx.fillStyle = smg;
    smctx.fillRect(0, 0, 128, 128);
    const smokeTex = new THREE.CanvasTexture(smc);
    this.smoke = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 12),
      new THREE.MeshBasicMaterial({ map: smokeTex, color: 0xefe9dc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
      28,
    );
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    scene.add(this.smoke);

    // gunmen — small dark groups
    this.gunmen = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const dark = new THREE.MeshLambertMaterial({ color: 0x2c2c34 });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.7, 0.56), dark);
      torso.position.y = 1.15;
      g.add(torso);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), skin);
      head.position.y = 1.7;
      g.add(head);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      gun.position.set(0.3, 1.3, 0.2);
      g.add(gun);
      for (const lz of [-0.11, 0.11]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.16), dark);
        leg.position.set(0, 0.39, lz);
        g.add(leg);
      }
      g.visible = false;
      scene.add(g);
      this.gunmen.push(g);
    }

    // objective marker: gold diamond that bobs over the target
    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1),
      new THREE.MeshBasicMaterial({ color: 0xf2c94c }),
    );
    scene.add(this.marker);
    // waypoint marker: smaller cyan diamond over the map waypoint
    this.wpMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.8),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
    );
    scene.add(this.wpMarker);
    // safehouse ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(22, 24, 40),
      new THREE.MeshBasicMaterial({ color: 0x90be6d, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-72, 0.06, 48);
    scene.add(ring);
  }

  setCamOverride(pos, look) {
    this.camOverride = pos ? {
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      look: new THREE.Vector3(look.x, look.y, look.z),
    } : null;
  }

  /** Keep the follow camera from sitting behind a building relative to
   * the hero: if the hero→camera segment enters a building (1 m margin),
   * pull the camera to just before the entry point; a camera already
   * inside a footprint is pulled halfway toward the hero (it converges
   * over frames). Pure function of state — deterministic. */
  clampCam(pos, hx, hz) {
    const dx = pos.x - hx, dz = pos.z - hz;
    let best = 1;
    for (const b of this.camBlockers) {
      if (pos.y >= b.h + 1) continue;
      const x0 = b.x0 - 1, x1 = b.x1 + 1, z0 = b.z0 - 1, z1 = b.z1 + 1;
      if (pos.x > x0 && pos.x < x1 && pos.z > z0 && pos.z < z1) { best = Math.min(best, 0.55); continue; }
      let t0 = 0, t1 = 1, ok = true;
      if (Math.abs(dx) < 1e-9) { if (hx < x0 || hx > x1) ok = false; }
      else {
        let ta = (x0 - hx) / dx, tb = (x1 - hx) / dx;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (ok) {
        if (Math.abs(dz) < 1e-9) { if (hz < z0 || hz > z1) ok = false; }
        else {
          let ta = (z0 - hz) / dz, tb = (z1 - hz) / dz;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        }
      }
      if (ok && t0 <= t1 && t0 > 0.02 && t0 < 1 && t1 > 0) best = Math.min(best, t0 * 0.92);
    }
    if (best < 1) {
      pos.x = hx + dx * best;
      pos.z = hz + dz * best;
    }
  }

  /** Snap the follow camera onto the hero at once (staged shots). */
  snapFollow() {
    const s = this.world.state;
    const p = s.player, car = s.heroCar;
    const hx = p.mode === 'car' ? car.x : p.x;
    const hz = p.mode === 'car' ? car.z : p.z;
    const forward = p.mode === 'car' ? car.heading : p.heading;
    const dist = p.mode === 'car' ? 13.5 : 8.5;
    const height = p.mode === 'car' ? 5.2 : 3.6;
    this.camPos.set(hx - Math.cos(forward) * dist, height, hz + Math.sin(forward) * dist);
    this.clampCam(this.camPos, hx, hz);
    this.camLook.set(hx + Math.cos(forward) * 7, 1.6, hz - Math.sin(forward) * 7);
  }

  update(dt) {
    const s = this.world.state;
    this.time += dt;
    const hour = s.hour;
    const pal = paletteAt(hour);
    this.scene.background = pal.bg;
    this.scene.fog.color = pal.fog;
    this.hemi.color = pal.hemiSky;
    this.hemi.groundColor = pal.hemiGround;
    this.hemi.intensity = pal.hemiI;
    this.sun.color = pal.sun;
    this.sun.intensity = pal.sunI;
    const ang = ((hour - 6) / 12) * Math.PI;
    const sunDir = sunDirTmp.set(Math.cos(ang), Math.max(0.08, Math.sin(ang)), 0.45).normalize();
    const hx = s.player.x, hz = s.player.z;
    this.sun.position.set(hx + sunDir.x * 160, sunDir.y * 160, hz + sunDir.z * 160);
    this.sun.target.position.set(hx, 0, hz);
    this.sun.target.updateMatrixWorld();
    // sun disc on the horizon in the direction of the sun
    this.sunDisc.position.set(hx + sunDir.x * 620, Math.max(12, sunDir.y * 620), hz + sunDir.z * 620);
    this.sunDisc.lookAt(this.camera.position);
    this.sunHalo.position.copy(this.sunDisc.position);
    this.sunHalo.lookAt(this.camera.position);
    this.sunGlare.position.copy(this.sunDisc.position);
    this.sunGlare.lookAt(this.camera.position);
    // sunset factor: 1 at 18.3, fading to 0 by ~15.8 / ~20.8
    const sunsetF = clamp(1 - Math.abs(hour - 18.3) / 2.5, 0, 1);
    const nightAmt = hour < 5.5 || hour > 19.5 ? 1 : hour > 18.5 ? (hour - 18.5) : hour < 6.5 ? (6.5 - hour) : 0;
    // Outer glare: 0.12 base, +0.5 at full dusk, gone at night.
    this.sunGlare.material.opacity = (0.12 + 0.5 * sunsetF) * (1 - nightAmt);
    // The sky dome gradient, repainted only when the hour bucket moves.
    // A sunset wants a purple zenith, a pink mid-sky and a deep orange
    // band just above the horizon. The visible sky is the top half of
    // the canvas (the horizon sits at v = 0.5), so the orange stops sit
    // at 0.42-0.50; a stop below the horizon would be invisible and the
    // sky would read as one flat pink slab.
    const bucket = Math.round(hour * 4);
    if (bucket !== this.skyBucket) {
      this.skyBucket = bucket;
      const ctx = this.skyCanvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      const zenith = pal.bg.clone().multiplyScalar(0.42);
      zenith.lerp(SUNSET_ZENITH, sunsetF);
      const middle = pal.bg.clone();
      middle.lerp(SUNSET_MID, sunsetF);
      const horizon = pal.fog.clone();
      horizon.lerp(SUNSET_SEA, sunsetF);
      const gold = pal.fog.clone().lerp(new THREE.Color(0xffc46b), sunsetF);
      const upper = zenith.clone().lerp(middle, 0.55);
      grad.addColorStop(0.34, '#' + upper.getHexString());
      grad.addColorStop(0.86, '#' + gold.getHexString());
      const groundHex = pal.hemiGround.getHexString();
      grad.addColorStop(0, `#${zenith.getHexString()}`);
      grad.addColorStop(0.3, `#${middle.getHexString()}`);
      grad.addColorStop(0.42, `#${horizon.getHexString()}`);
      grad.addColorStop(0.5, `#${horizon.getHexString()}`);
      grad.addColorStop(0.55, `#${groundHex}`);
      grad.addColorStop(1, `#${groundHex}`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 4, 256);
      this.skyTex.needsUpdate = true;
    }
    // Long shadows rebuild on the same 15-minute bucket.
    if (bucket !== this.shadowBucket) {
      this.shadowBucket = bucket;
      this.rebuildShadows(hour);
    }
    this.skyDome.position.set(hx, 0, hz);
    // K17_ clouds: cooler sunset tint (less pink — the old warm wash is
    // what made the balls read as balloons) and lower opacity, so the
    // thin strata stay translucent instead of solid. Same tint on all
    // three K17_ wisp materials.
    tmpColor.set(0xffffff).lerp(pal.fog, sunsetF * 0.45);
    tmpColor.lerp(SUNSET_SEA, sunsetF * 0.10);
    tmpColor.multiplyScalar((1 - nightAmt * 0.7) * (1 - sunsetF * 0.10));
    for (const K17_m of this.K17_cloudMats) {
      K17_m.color.copy(tmpColor);
      K17_m.opacity = (0.38 - nightAmt * 0.15) * (1 - sunsetF * 0.2);
    }
    // The sea warms toward the sunset so it is a lit band, not a dark slit.
    tmpColor.set(0xffffff).lerp(SUNSET_SEA, sunsetF * 0.6);
    tmpColor.multiplyScalar(1 - nightAmt * 0.75);
    this.seaMat.color.copy(tmpColor);
    // sun glitter: only where the sun ray from the player actually crosses
    // the sea rectangle. From downtown the ray exits over land, so hide it
    // instead of floating a glowing strip across the city.
    this.glitter.rotation.y = Math.atan2(-sunDir.z, sunDir.x);
    let glit = 0;
    if (sunsetF > 0 && sunDir.z > 0.01) {
      const tZ0 = (SEA_Z - hz) / sunDir.z, tZ1 = (SEA_Z + 260 - hz) / sunDir.z;
      let tX0 = (-290 - hx) / sunDir.x, tX1 = (410 - hx) / sunDir.x;
      if (tX0 > tX1) { const t = tX0; tX0 = tX1; tX1 = t; }
      const tIn = Math.max(tZ0, tX0, 60), tOut = Math.min(tZ1, tX1);
      if (tOut > tIn) {
        const tc = (tIn + tOut) / 2;
        this.glitter.position.set(hx + sunDir.x * tc, 0.55, hz + sunDir.z * tc);
        glit = sunsetF * 1.0;
      }
    }
    this.glitter.material.opacity = glit;
    this.stars.material.opacity = hour < 5.5 || hour > 19 ? 0.9 : hour > 18 ? 0.5 : 0;
    this.seaMat.map.offset.x = (this.time * 0.004) % 1;
    // K17_ foam wash drifts slowly along the waterline; the sea scrolls
    // with it so the two never shear apart.
    this.K17_foamTex.offset.x = (this.time * 0.008) % 1;
    for (const c of this.clouds) {
      c.position.x += dt * 1.2;
      if (c.position.x > 380) c.position.x = -380;
    }

    // ---- hero ----
    const p = s.player, car = s.heroCar;
    if (p.mode === 'car') {
      this.heroCar.visible = true;
      this.heroWalk.visible = false;
      this.heroCar.position.set(car.x, 0, car.z);
      this.heroCar.rotation.y = car.heading;
      this.heroCar.position.y = Math.sin(this.time * 22) * 0.02 * Math.min(1, Math.abs(car.speed) / 20);
      // damage smoke tint: tilt slightly when wrecked
      this.heroCar.rotation.z = car.damage > 70 ? 0.04 : 0;
    } else {
      this.heroCar.visible = true; // parked hero car stays in the world
      this.heroCar.position.set(car.x, 0, car.z);
      this.heroCar.rotation.y = car.heading;
      this.heroWalk.visible = true;
      this.heroWalk.position.set(p.x, 0, p.z);
      this.heroWalk.rotation.y = p.heading;
      const swing = Math.sin(p.walkPhase) * 0.55;
      this.heroArmL.rotation.x = swing;
      this.heroArmR.rotation.x = -swing;
      this.heroLegL.rotation.x = -swing;
      this.heroLegR.rotation.x = swing;
    }

    // ---- traffic + police + van through the instanced pools ----
    const cars = [];
    for (const c of s.traffic) cars.push({ x: c.x, z: c.z, h: c.heading, kind: c.kind, color: c.color, police: false });
    for (const pc of s.police) cars.push({ x: pc.x, z: pc.z, h: pc.heading, kind: 'sedan', color: '#e8e8e8', police: true });
    cars.push({ x: s.van.x, z: s.van.z, h: s.van.heading, kind: 'van', color: '#d4af37', police: false });
    let nSedan = 0, nVan = 0, nScoot = 0, nBar = 0;
    for (const c of cars) {
      const isVan = c.kind === 'van', isScoot = c.kind === 'scooter';
      dummy.rotation.set(0, c.h, 0);
      dummy.scale.set(1, 1, 1);
      const setM = (mesh, idx, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, c.h + ry, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
      };
      if (isVan) {
        const i = nVan++;
        setM(this.carBodyVan, i, c.x, 1.05, c.z);
        this.carBodyVan.setColorAt(i, tmpColor.set(c.color));
      } else if (isScoot) {
        const i = nScoot++;
        setM(this.carBodyScooter, i, c.x, 0.55, c.z);
        this.carBodyScooter.setColorAt(i, tmpColor.set(c.color));
      } else {
        const i = nSedan++;
        setM(this.carBodySedan, i, c.x, 0.62, c.z);
        this.carBodySedan.setColorAt(i, tmpColor.set(c.color));
        // sloped windshield + rear glass
        dummy.position.set(c.x + Math.cos(c.h) * 0.85, 1.05, c.z - Math.sin(c.h) * 0.85);
        dummy.rotation.set(0, c.h, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.carGlass.setMatrixAt(i, dummy.matrix);
        dummy.position.set(c.x - Math.cos(c.h) * 0.95, 1.02, c.z + Math.sin(c.h) * 0.95);
        dummy.updateMatrix();
        this.carGlassRear.setMatrixAt(i, dummy.matrix);
        setM(this.carRoof, i, c.x - Math.cos(c.h) * 0.1, 1.38, c.z + Math.sin(c.h) * 0.1);
        this.carRoof.setColorAt(i, tmpColor.set(c.color));
        // grille on the nose + a mirror on each front door
        setM(this.carGrille, i, c.x + Math.cos(c.h) * 2.24, 0.72, c.z - Math.sin(c.h) * 2.24);
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? -1.02 : 1.02;
          const mx = c.x + Math.cos(c.h) * 0.7 - Math.sin(c.h) * side;
          const mz = c.z - Math.sin(c.h) * 0.7 - Math.cos(c.h) * side;
          dummy.position.set(mx, 1.05, mz);
          dummy.rotation.set(0, c.h, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.carMirror.setMatrixAt(i * 2 + k, dummy.matrix);
        }
        // headlights / taillights (two each)
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? -0.62 : 0.62;
          const fx = Math.cos(c.h) * 2.24 - Math.sin(c.h) * side;
          const fz = -Math.sin(c.h) * 2.24 - Math.cos(c.h) * side;
          dummy.position.set(c.x + fx, 0.72, c.z + fz);
          dummy.rotation.set(0, c.h, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.carHead.setMatrixAt(i * 2 + k, dummy.matrix);
          const bx = -Math.cos(c.h) * 2.24 - Math.sin(c.h) * side;
          const bz = Math.sin(c.h) * 2.24 - Math.cos(c.h) * side;
          dummy.position.set(c.x + bx, 0.72, c.z + bz);
          dummy.updateMatrix();
          this.carTail.setMatrixAt(i * 2 + k, dummy.matrix);
        }
        // taxi sign only for taxis
        dummy.position.set(c.x, 1.62, c.z);
        dummy.rotation.set(0, c.h, 0);
        dummy.scale.set(c.kind === 'taxi' ? 1 : 0.001, c.kind === 'taxi' ? 1 : 0.001, c.kind === 'taxi' ? 1 : 0.001);
        dummy.updateMatrix();
        this.carTaxi.setMatrixAt(i, dummy.matrix);
        if (c.police) {
          const bi = nBar++;
          dummy.position.set(c.x - Math.cos(c.h) * 0.1, 1.56, c.z + Math.sin(c.h) * 0.1);
          dummy.rotation.set(0, c.h, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.carBar.setMatrixAt(bi, dummy.matrix);
          this.carBar.setColorAt(bi, tmpColor.set((Math.floor(this.time * 3) + bi) % 2 ? 0xff2a2a : 0x2a5aff));
          dummy.position.set(c.x + Math.cos(c.h) * 2.3, 0.5, c.z - Math.sin(c.h) * 2.3);
          dummy.updateMatrix();
          this.carPush.setMatrixAt(bi, dummy.matrix);
        }
      }
      // wheels (all kinds, 4 per car — scooters get 2 visible, 2 hidden)
      const wheelCount = isScoot ? 2 : 4;
      for (let wI = 0; wI < 4; wI++) {
        const wx = wI < 2 ? 1.45 : -1.45;
        const wz = (wI % 2 === 0 ? -0.85 : 0.85);
        const idx = (nSedan + nVan + nScoot - 1) * 4 + wI;
        dummy.position.set(c.x + Math.cos(c.h) * wx - Math.sin(c.h) * wz, 0.36, c.z - Math.sin(c.h) * wx - Math.cos(c.h) * wz);
        dummy.rotation.set(0, c.h, 0);
        dummy.scale.set(wI < wheelCount ? 1 : 0.001, wI < wheelCount ? 1 : 0.001, wI < wheelCount ? 1 : 0.001);
        dummy.updateMatrix();
        this.carWheels.setMatrixAt(idx, dummy.matrix);
        this.carHubs.setMatrixAt(idx, dummy.matrix);
      }
    }
    this.carBodySedan.count = nSedan;
    this.carBodyVan.count = nVan;
    this.carBodyScooter.count = nScoot;
    this.carGlass.count = nSedan;
    this.carGlassRear.count = nSedan;
    this.carRoof.count = nSedan;
    this.carGrille.count = nSedan;
    this.carMirror.count = nSedan * 2;
    this.carWheels.count = (nSedan + nVan + nScoot) * 4;
    this.carHubs.count = (nSedan + nVan + nScoot) * 4;
    this.carHead.count = nSedan * 2;
    this.carTail.count = nSedan * 2;
    this.carTaxi.count = nSedan;
    this.carBar.count = nBar;
    this.carPush.count = nBar;
    for (const m of [this.carBodySedan, this.carBodyVan, this.carBodyScooter, this.carGlass, this.carGlassRear, this.carRoof, this.carGrille, this.carMirror, this.carWheels, this.carHubs, this.carHead, this.carTail, this.carTaxi, this.carBar, this.carPush]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // ---- peds ----
    if (!this.pedColorsSet) {
      s.peds.forEach((pd, i) => {
        this.pedTorso.setColorAt(i, tmpColor.set(pd.shirt));
        this.pedHead.setColorAt(i, tmpColor.set(pd.skin));
        this.pedHair.setColorAt(i, tmpColor.set(pd.hair));
        this.pedArmL.setColorAt(i, tmpColor.set(pd.skin));
        this.pedArmR.setColorAt(i, tmpColor.set(pd.skin));
        this.pedLegL.setColorAt(i, tmpColor.set(pd.pants));
        this.pedLegR.setColorAt(i, tmpColor.set(pd.pants));
      });
      this.pedColorsSet = true;
    }
    s.peds.forEach((pd, i) => {
      const vis = pd.alive ? 1 : 0.001;
      const sc = vis * (pd.scale || 1);
      const swing = Math.sin(pd.phase) * 0.5;
      const setPart = (mesh, x, y, z, rz = 0, rx = 0) => {
        dummy.position.set(x, y * sc, z);
        dummy.rotation.set(rx, pd.heading, rz);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      };
      setPart(this.pedTorso, pd.x, 1.14, pd.z);
      setPart(this.pedHead, pd.x, 1.68, pd.z);
      setPart(this.pedHair, pd.x, 1.88, pd.z);
      setPart(this.pedArmL, pd.x + Math.sin(pd.heading) * 0.26, 1.48, pd.z + Math.cos(pd.heading) * 0.26, 0, swing);
      setPart(this.pedArmR, pd.x - Math.sin(pd.heading) * 0.26, 1.48, pd.z - Math.cos(pd.heading) * 0.26, 0, -swing);
      setPart(this.pedLegL, pd.x + Math.sin(pd.heading) * 0.1, 0.78, pd.z + Math.cos(pd.heading) * 0.1, 0, -swing);
      setPart(this.pedLegR, pd.x - Math.sin(pd.heading) * 0.1, 0.78, pd.z - Math.cos(pd.heading) * 0.1, 0, swing);
    });
    for (const m of [this.pedTorso, this.pedHead, this.pedHair, this.pedArmL, this.pedArmR, this.pedLegL, this.pedLegR]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // ---- heli ----
    const heli = s.heli;
    this.heli.visible = heli.active;
    if (heli.active) {
      this.heli.position.set(heli.x, heli.alt, heli.z);
      // A staged shot may pin the heli's yaw (heli.angle): the cover
      // shot turns it side-on to the camera, so the boom, fin and skids
      // read instead of a foreshortened nose-on box. Unstaged play keeps
      // facing the player.
      const pinnedYaw = heli.staged && heli.angle !== undefined;
      this.heli.rotation.y = pinnedYaw ? heli.angle : Math.atan2(-(hz - heli.z), hx - heli.x);
      this.rotor.rotation.y = this.time * 22;
      // Staging also scales the heli up (heli.scale) and brightens the
      // rotor blur and the searchlight; real play carries neither field
      // in its reset state, so it is untouched.
      // K16_ beam staging (re-witnessed, values unchanged): outer
      // 0.06 staged / 0.04 play, inner core 0.10 staged / 0.07 play.
      this.heli.scale.setScalar(heli.scale || 1);
      this.heliBeam.material.opacity = heli.staged ? 0.06 : 0.04;
      this.heliBeamInner.material.opacity = heli.staged ? 0.10 : 0.07;
      this.rotorDisc.material.opacity = heli.staged ? 0.3 : 0.16;
    }

    // ---- drift smoke: only the cover shot sets s.smokeFx ----
    if (s.smokeFx && p.mode === 'car') {
      this.smoke.count = 28;
      const fwdX = Math.cos(car.heading), fwdZ = -Math.sin(car.heading);
      const sideX = Math.sin(car.heading), sideZ = Math.cos(car.heading);
      for (let i = 0; i < 28; i++) {
        const age = (this.time * 0.45 + i / 28) % 1;
        const spread = (hash2(i, 7, 1) - 0.5) * 5;
        // Small, faint and short-lived: the trail runs straight back
        // along the road toward the cover camera, so big puffs once
        // formed a wall that hid the hero car. The trail starts 3 m
        // behind the car, runs 4.5 m, and tops out smaller, so no puff
        // sits on the hero's silhouette.
        const back = 3.0 + age * 4.5;
        const widen = spread * (0.4 + age);
        const px = car.x - fwdX * back + sideX * widen;
        const pz = car.z - fwdZ * back + sideZ * widen;
        const fade = age > 0.6 ? Math.max(0.001, (1 - age) / 0.4) : 1;
        const size = (0.6 + age * 1.3) * fade;
        dummy.position.set(px, 0.4 + age * 1.6, pz);
        dummy.lookAt(this.camera.position);
        dummy.scale.set(size, size, size);
        dummy.updateMatrix();
        this.smoke.setMatrixAt(i, dummy.matrix);
      }
      this.smoke.instanceMatrix.needsUpdate = true;
    } else if (this.smoke.count !== 0) {
      this.smoke.count = 0;
    }

    // ---- shells + gunmen + marker ----
    s.shells.forEach((sh, i) => {
      dummy.position.set(sh.x, 0.7 + Math.sin(this.time * 2 + i) * 0.15, sh.z);
      dummy.rotation.set(0, this.time + i, 0);
      dummy.scale.set(sh.taken ? 0.001 : 1, sh.taken ? 0.001 : 1, sh.taken ? 0.001 : 1);
      dummy.updateMatrix();
      this.shells.setMatrixAt(i, dummy.matrix);
    });
    this.shells.instanceMatrix.needsUpdate = true;
    s.gunmen.forEach((g, i) => {
      const grp = this.gunmen[i];
      grp.visible = g.alive;
      grp.position.set(g.x, g.hitFlash > 0 ? 0.1 : 0, g.z);
      grp.rotation.y = Math.atan2(-(hz - g.z), hx - g.x);
    });
    const o = s.objective;
    this.marker.position.set(o.x, 7 + Math.sin(this.time * 2.5) * 0.8, o.z);
    this.marker.rotation.y = this.time * 1.5;
    this.marker.visible = s.screen === 'play' && s.missions.started;
    // waypoint marker follows the map waypoint
    if (s.waypoint) {
      this.wpMarker.position.set(s.waypoint.x, 5 + Math.sin(this.time * 2.5) * 0.6, s.waypoint.z);
      this.wpMarker.rotation.y = this.time * 1.5;
    }
    this.wpMarker.visible = !!s.waypoint;

    // ---- camera: third-person follow, smoothed ----
    if (this.camOverride) {
      this.camera.position.copy(this.camOverride.pos);
      this.camera.lookAt(this.camOverride.look);
    } else {
      const forward = p.mode === 'car' ? car.heading : p.heading;
      const dist = p.mode === 'car' ? 13.5 : 8.5;
      const height = p.mode === 'car' ? 5.2 : 3.6;
      const tx = hx - Math.cos(forward) * dist;
      const tz = hz + Math.sin(forward) * dist;
      this.camPos.x += (tx - this.camPos.x) * Math.min(1, dt * 5);
      this.camPos.y += (height - this.camPos.y) * Math.min(1, dt * 5);
      this.camPos.z += (tz - this.camPos.z) * Math.min(1, dt * 5);
      this.clampCam(this.camPos, hx, hz);
      this.camLook.x += (hx + Math.cos(forward) * 7 - this.camLook.x) * Math.min(1, dt * 7);
      this.camLook.y += (1.6 - this.camLook.y) * Math.min(1, dt * 7);
      this.camLook.z += (hz - Math.sin(forward) * 7 - this.camLook.z) * Math.min(1, dt * 7);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
    }
    this.renderer.render(this.scene, this.camera);
  }

  stats() {
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles };
  }
}

function ballColor(c) {
  return ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff924c'][Math.floor(hash2(c.length, 7, 3) * 5) % 5];
}
