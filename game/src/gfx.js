// Solmarina (fresh build) — the renderer. Written fresh for the visual bar:
// blocky but DETAILED, never flat colours. Every surface carries a second
// layer (frame, trim, speckle, stripe, sign, prop). Static geometry is built
// once from merged vertex-coloured boxes; repeated things (windows, fronds,
// wheels, bulbs, peds) are InstancedMesh pools. Emissive-look detail lives in
// MeshBasicMaterial meshes so it stays readable at night without touching
// the day/night lighting model. Nothing here uses Math.random — all variation
// is a coordinate hash, so the sim trace is untouched by rendering.
import * as THREE from '../vendor/three.module.min.js';
import { hash2, clamp, lerp, wrapAngle } from './util.js';
import {
  ROAD_STEP, GRID_MIN, GRID_MAX, ROAD_HALF, BEACH_Z, SEA_Z, PIER,
  CAUSEWAY_Z, MARKET, STADIUM, WORLD, districtAt,
} from './layout.js';

const DAY = { sun: 0xffdf9e, hemiSky: 0xbfd9ff, hemiGround: 0x8a7a5a, fog: 0xcfe0ee, bg: 0x87b5d9, sunI: 1.25, hemiI: 0.85 };
const SUNSET = { sun: 0xff9a4d, hemiSky: 0xe8a06a, hemiGround: 0x5a4a3a, fog: 0xe8a06a, bg: 0xf2a35e, sunI: 1.05, hemiI: 0.75 };
const NIGHT = { sun: 0x8fa8ff, hemiSky: 0x1c2440, hemiGround: 0x0e0c10, fog: 0x141a2e, bg: 0x0d1226, sunI: 0.4, hemiI: 0.5 };
// fixed sunset accent colours: the gradient dome needs a purple zenith +
// pink mid-sky or the sunset reads as one flat orange slab (v2.4 audit)
const SUNSET_ZENITH = new THREE.Color(0x4a2358);
const SUNSET_MID = new THREE.Color(0xc94f6d);
const SUNSET_SEA = new THREE.Color(0xff8a4d);

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function shade(hex, f) {
  const [r, g, b] = hexRgb(hex);
  return [clamp(r * f, 0, 1), clamp(g * f, 0, 1), clamp(b * f, 0, 1)];
}

/** Accumulator for merged vertex-coloured boxes. */
export class BoxSoup {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.v = 0; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rz = 0, rx = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler(rx, ry, rz);
    m.makeRotationFromEuler(e);
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    const c = typeof color === 'string' ? hexRgb(color) : color;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      // top faces get a touch more light baked in, bottom faces less
      const f = n[i + 1] > 0.5 ? 1.12 : n[i + 1] < -0.5 ? 0.82 : 1;
      this.col.push(clamp(c[0] * f, 0, 1), clamp(c[1] * f, 0, 1), clamp(c[2] * f, 0, 1));
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

/** 4096 px ground canvas: roads, sidewalks, plaza tiles, sand, speckles. */
function groundTexture(layout) {
  const S = 4096;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const W = WORLD.x1 - WORLD.x0, H = WORLD.z1 - WORLD.z0;
  const px = (x) => ((x - WORLD.x0) / W) * S;
  const pz = (z) => ((z - WORLD.z0) / H) * S;
  const mpp = S / W; // px per metre
  // base: weathered concrete
  ctx.fillStyle = '#8f8f86'; ctx.fillRect(0, 0, S, S);
  // block interiors: alternating grass / concrete / dirt lots (hash-shaded)
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
      // speckle so no lot is one flat colour
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
  // --- beach sand: dune bands + footprints ---
  const sandZ = pz(BEACH_Z), sandH = pz(SEA_Z) - sandZ;
  ctx.fillStyle = '#e8d5a3'; ctx.fillRect(0, sandZ, S, sandH);
  for (let b = 0; b < 8; b++) {
    ctx.fillStyle = b % 2 ? 'rgba(190,160,110,0.35)' : 'rgba(255,240,200,0.3)';
    ctx.fillRect(0, sandZ + b * (sandH / 8), S, sandH / 16);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(120,95,60,${0.08 + hash2(i, 77, 1) * 0.12})`;
    ctx.fillRect(hash2(i, 3, 2) * S, sandZ + hash2(i, 5, 2) * sandH, 3, 2);
  }
  // --- roads: asphalt + edge lines + centre dashes + crosswalks ---
  ctx.fillStyle = '#3a3d42';
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) {
    ctx.fillRect(0, pz(v - ROAD_HALF), S, 2 * ROAD_HALF * mpp);
    ctx.fillRect(px(v - ROAD_HALF), 0, 2 * ROAD_HALF * mpp, S);
  }
  ctx.fillRect(px(GRID_MAX), pz(CAUSEWAY_Z - ROAD_HALF), px(PIER.x) - px(GRID_MAX), 2 * ROAD_HALF * mpp);
  ctx.fillStyle = '#f7f3e0';
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) {
    // edge lines
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
  // crosswalk stripes at every intersection
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

function seaTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2e7fa8'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + hash2(i, 1, 1) * 0.16})`;
    ctx.lineWidth = 1 + hash2(i, 2, 1) * 2;
    const y = hash2(i, 3, 1) * 512, x = hash2(i, 4, 1) * 512, len = 20 + hash2(i, 5, 1) * 60;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + (hash2(i, 6, 1) - 0.5) * 8); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
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

export class Renderer {
  constructor(world, canvas, quality = 'med') {
    this.world = world;
    this.canvas = canvas;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1280 / 720, 0.1, 1400);
    const scale = quality === 'low' ? 0.75 : quality === 'high' ? 1.5 : 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(1280, 720, false);
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
    this.buildSky();
  }

  // ---- static city ----
  buildStatic(L) {
    const scene = this.scene;
    // building footprints for the follow-camera clamp (v2.4: the play shot
    // caught the camera against a wall mid-turn)
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
    this.seaMat = new THREE.MeshLambertMaterial({ map: seaTexture(), transparent: true, opacity: 0.92 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 260), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(60, 0.4, SEA_Z + 130);
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

    // --- buildings: body + parapet + roof trim + windows + shopfronts ---
    for (const b of L.buildings) {
      const f = hash2(Math.round(b.x), Math.round(b.z), 13);
      solid.add(b.x, b.h / 2, b.z, b.w, b.h, b.d, shade(b.color, 0.92 + f * 0.16));
      // parapet + roof trim so no slab top reads flat
      solid.add(b.x, b.h + 0.5, b.z, b.w + 0.4, 1, b.d + 0.4, shade(b.roof, 1));
      solid.add(b.x, b.h + 0.15, b.z, b.w * 0.55, 0.7, b.d * 0.55, shade(b.roof, 0.8));
      if (b.sign) glow.add(b.x, b.h + 1.6, b.z + b.d / 2 + 0.1, Math.min(10, b.w * 0.6), 1.1, 0.3, b.signColor);
      // windows on all four faces
      const colsX = Math.max(2, Math.floor(b.w / 6.0));
      const colsZ = Math.max(2, Math.floor(b.d / 6.0));
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
      solid.add(b.x, 1.3, b.z + b.d / 2 + 0.08, 1.3, 2.5, 0.16, '#3a2e22');
      glow.add(b.x, 3.1, b.z + b.d / 2 + 0.12, b.w * 0.7, 0.5, 0.12, '#f2c94c');
      // sparse balconies on tall buildings
      if (b.h > 30 && hash2(Math.round(b.x), Math.round(b.z), 17) < 0.33) {
        for (let fl = 1; fl <= 2; fl++) {
          const y = 3.4 * fl + 2.6;
          solid.add(b.x, y, b.z + b.d / 2 + 0.7, b.w * 0.5, 0.25, 1.5, '#7a7568');
          solid.add(b.x, y + 0.6, b.z + b.d / 2 + 1.4, b.w * 0.5, 0.9, 0.08, '#4a4e57');
        }
      }
      // AC unit on the east face + roof water tank on low-rise, so no
      // facade reads as one bare slab from the street
      if (hash2(Math.round(b.x), Math.round(b.z), 19) < 0.55) {
        const fl = 1 + Math.floor(hash2(Math.round(b.x), 3, 19) * Math.max(1, b.floors - 1));
        const ay = 2.6 + fl * 3.4;
        if (ay < b.h - 1) solid.add(b.x + b.w / 2 + 0.3, ay, b.z + b.d * 0.2, 0.6, 0.5, 0.9, '#9a9a92');
      }
      if (b.h <= 20 && hash2(Math.round(b.x), Math.round(b.z), 23) < 0.5) {
        solid.add(b.x + b.w * 0.25, b.h + 1.6, b.z - b.d * 0.2, 1.7, 2.2, 1.7, '#7a7568');
        solid.add(b.x + b.w * 0.25, b.h + 2.8, b.z - b.d * 0.2, 1.9, 0.25, 1.9, '#5a5548');
      }
    }
    // lighthouse on the western headland, in the sea (ref-3 landmark):
    // rock base + banded tower + lamp that glows at dusk
    solid.add(-280, 1.2, 348, 16, 2.4, 14, '#6b5a4a');
    solid.add(-280, 3.2, 348, 11, 2, 10, '#7a6a58');
    solid.add(-280, 6, 348, 5, 5, 5, '#e8e0d0');
    solid.add(-280, 9.5, 348, 5, 3, 5, '#c0392b');
    solid.add(-280, 12.5, 348, 5, 3, 5, '#e8e0d0');
    solid.add(-280, 15, 348, 5.4, 1, 5.4, '#2f3540');
    glow.add(-280, 16.2, 348, 1.6, 1.6, 1.6, '#ffe9a8');
    scene.add(solid.build(lambertVertex()));
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
      // counter + posts
      const c0 = local(0, 0);
      stallSoup.add(c0.x, 0.55, c0.z, 5.6, 1.1, 2.2, '#6b4a2f', st.ry);
      stallSoup.add(c0.x, 1.15, c0.z, 5.8, 0.12, 2.4, shade(st.color, 0.85), st.ry);
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
      // crates beside
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
    // lantern glow boxes (basic)
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

    // --- palms: trunk bands + coconuts + two frond rings ---
    const palmSoup = new BoxSoup();
    const fronds = [];
    const nuts = [];
    for (const pl of L.palms) {
      const h = 5.2 * pl.s;
      for (let sI = 0; sI < 5; sI++) {
        const y = (sI + 0.5) * (h / 5);
        palmSoup.add(pl.x + Math.sin(sI * 1.7) * 0.12, y, pl.z, 0.34, h / 5 + 0.1, 0.34, sI % 2 ? '#8a6a42' : '#7a5a38');
      }
      palmSoup.add(pl.x, h * 0.45, pl.z, 0.44, 0.3, 0.44, '#6b4a2f');
      palmSoup.add(pl.x, h * 0.8, pl.z, 0.44, 0.3, 0.44, '#6b4a2f');
      for (let nI = 0; nI < 3; nI++) nuts.push({ x: pl.x + Math.cos(nI * 2.1) * 0.4, y: h - 0.3, z: pl.z + Math.sin(nI * 2.1) * 0.4 });
      // upper ring: 5 fronds pitched up; lower ring: 7 drooping
      for (let fI = 0; fI < 5; fI++) fronds.push({ x: pl.x, y: h + 0.15, z: pl.z, yaw: (fI / 5) * Math.PI * 2 + hash2(Math.round(pl.x), fI, 3), pitch: 0.45, len: 3.4 * pl.s, col: '#3f9e4d' });
      for (let fI = 0; fI < 7; fI++) fronds.push({ x: pl.x, y: h - 0.1, z: pl.z, yaw: (fI / 7) * Math.PI * 2 + hash2(Math.round(pl.z), fI, 4), pitch: -0.5, len: 3.0 * pl.s, col: '#2f8f3e' });
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
    const umbSoup = new BoxSoup();
    const balls = [];
    for (const u of L.umbrellas) {
      const cy = Math.cos(u.ry), sy = Math.sin(u.ry);
      umbSoup.add(u.x, 1.1, u.z, 0.09, 2.2, 0.09, '#e8e0cc');
      for (let sI = 0; sI < 4; sI++) {
        const a = (sI / 4) * Math.PI * 2 + u.ry;
        const cx = u.x + Math.cos(a) * 0.75, cz = u.z + Math.sin(a) * 0.75;
        umbSoup.add(cx, 2.25 + (sI % 2 ? 0.14 : 0), cz, 1.5, 0.08, 1.1, sI % 2 ? '#f5efe0' : u.color, -a, 0, 0);
      }
      umbSoup.add(u.x, 2.5, u.z, 0.14, 0.3, 0.14, '#d4af37');
      // striped towel
      const tx = u.x + cy * 2.2, tz = u.z + sy * 2.2;
      umbSoup.add(tx, 0.08, tz, 1.8, 0.06, 0.8, u.color, u.ry);
      umbSoup.add(tx, 0.1, tz, 0.5, 0.06, 0.8, '#f5efe0', u.ry);
      if (hash2(Math.round(u.x), Math.round(u.z), 51) < 0.6) {
        balls.push({ x: u.x + 1.5, z: u.z + 1.2, color: pick2(u.color) });
      }
    }
    scene.add(umbSoup.build(lambertVertex()));
    const ballGeo = new THREE.SphereGeometry(0.32, 8, 6);
    this.balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, balls.length));
    balls.forEach((b, i) => { dummy.position.set(b.x, 0.32, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.balls.setMatrixAt(i, dummy.matrix); this.balls.setColorAt(i, tmpColor.set(b.color)); });
    this.balls.count = balls.length;
    scene.add(this.balls);

    // --- street props: bins, benches, planters, cones ---
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
      } else {
        propSoup.add(pr.x, 0.35, pr.z, 0.5, 0.7, 0.5, '#e85d04', pr.ry);
        propSoup.add(pr.x, 0.75, pr.z, 0.28, 0.15, 0.28, '#f5efe0', pr.ry);
      }
    }
    scene.add(propSoup.build(lambertVertex()));

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
    scene.add(pierSoup.build(lambertVertex()));
  }

  pushWindow(dark, lit, mull, b, x, y, z, ry, h, side = false) {
    const px = side ? x : b.x + x;
    const pz = side ? b.z + z : z;
    const h1 = hash2(Math.round(px), Math.round(y), Math.round(pz));
    const warm = h1 < 0.42;
    const rec = { x: px, y, z: pz, ry, color: warm ? (h1 < 0.16 ? '#ffd98a' : '#ffb347') : '#2a3648' };
    (warm ? lit : dark).push(rec);
    if (b.h <= 20) mull.push({ x: px + (ry === 0 ? 0 : ry === Math.PI ? 0 : Math.sin(ry) * 0.1), y, z: pz + (ry === 0 ? 0.08 : ry === Math.PI ? -0.08 : 0), ry });
  }

  buildSky() {
    // sun disc + halo, clouds, stars — the sun is a subject at sunset
    // (ref 3), not a 14 m speck: disc 30 m, halo 85 m at 620 m distance.
    // The halo is a soft radial gradient, not a flat circle: a flat disc
    // reads as an orange balloon with a hard edge (v2.4 beach audit).
    const sunGeo = new THREE.CircleGeometry(30, 24);
    this.sunDisc = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
    const hc = document.createElement('canvas'); hc.width = hc.height = 256;
    const hctx = hc.getContext('2d');
    const hg = hctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    hg.addColorStop(0, 'rgba(255,190,100,0.9)');
    hg.addColorStop(0.35, 'rgba(255,150,60,0.45)');
    hg.addColorStop(1, 'rgba(255,140,50,0)');
    hctx.fillStyle = hg; hctx.fillRect(0, 0, 256, 256);
    const haloTex = new THREE.CanvasTexture(hc);
    haloTex.colorSpace = THREE.SRGBColorSpace;
    this.sunHalo = new THREE.Mesh(new THREE.CircleGeometry(85, 24), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
    this.scene.add(this.sunDisc, this.sunHalo);
    // gradient sky dome (zenith -> horizon -> below): a flat background
    // colour can never do a sunset. Regenerated only when the hour bucket
    // changes, so it costs one 4x256 canvas paint per ~15 min of game time.
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 4; this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(950, 24, 16),
      new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.skyDome.renderOrder = -10;
    this.scene.add(this.skyDome);
    this.skyBucket = null;
    // sun glitter path on the sea: warm translucent gradient, long axis
    // aimed at the sun azimuth, opacity driven by the sunset factor
    const gc = document.createElement('canvas');
    gc.width = 256; gc.height = 64;
    const gctx = gc.getContext('2d');
    const gx = gctx.createLinearGradient(0, 0, 256, 0);
    gx.addColorStop(0, 'rgba(255,170,80,0)');
    gx.addColorStop(0.35, 'rgba(255,190,100,0.75)');
    gx.addColorStop(0.6, 'rgba(255,220,150,1)');
    gx.addColorStop(0.85, 'rgba(255,170,80,0.6)');
    gx.addColorStop(1, 'rgba(255,170,80,0)');
    gctx.fillStyle = gx;
    gctx.fillRect(0, 0, 256, 64);
    gctx.globalCompositeOperation = 'destination-in';
    const gy = gctx.createLinearGradient(0, 0, 0, 64);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(0.5, 'rgba(0,0,0,1)');
    gy.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = gy;
    gctx.fillRect(0, 0, 256, 64);
    this.glitterTex = new THREE.CanvasTexture(gc);
    this.glitterTex.colorSpace = THREE.SRGBColorSpace;
    this.glitter = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 110),
      new THREE.MeshBasicMaterial({ map: this.glitterTex, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.glitter.rotation.order = 'YXZ';
    this.glitter.rotation.x = -Math.PI / 2;
    this.glitter.position.set(-150, 0.55, 400);
    this.glitter.renderOrder = -5;
    this.scene.add(this.glitter);
    this.clouds = [];
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
    const cloudMat = this.cloudMat;
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const n = 3 + (i % 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(26 + hash2(i, j, 71) * 30, 3.5, 12), cloudMat);
        // staggered heights so the group is a broken haze, not one flat slab
        m.position.set(j * 18 - n * 9, hash2(i, j, 72) * 8, hash2(i, j, 73) * 8 - 4);
        g.add(m);
      }
      g.position.set(-320 + hash2(i, 0, 74) * 640, 95 + hash2(i, 1, 74) * 55, -260 + hash2(i, 2, 74) * 680);
      this.clouds.push(g);
      this.scene.add(g);
    }
    const starPos = [];
    for (let i = 0; i < 320; i++) {
      const a = hash2(i, 1, 81) * Math.PI * 2, e = 0.25 + hash2(i, 2, 81) * 1.1, r = 700;
      starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, fog: false, transparent: true, opacity: 0 }));
    this.scene.add(this.stars);
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

    // helicopter — a machine, not a speck
    this.heli = new THREE.Group();
    const heliWhite = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
    const heliBody = new THREE.Mesh(taperedBody(3.6, 1.9, 1.5, 0.85), heliWhite);
    heliBody.position.y = 0;
    this.heli.add(heliBody);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.7), new THREE.MeshLambertMaterial({ color: 0x101c28 }));
    cockpit.position.set(1.4, 0.1, 0);
    this.heli.add(cockpit);
    const frameBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.1), heliWhite);
    frameBar.position.set(1.4, 0.1, 0);
    this.heli.add(frameBar);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.22, 1.92), new THREE.MeshLambertMaterial({ color: 0xd4af37 }));
    stripe.position.set(0, 0.55, 0);
    this.heli.add(stripe);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 0.4), heliWhite);
    boom.position.set(-3.2, 0.35, 0);
    this.heli.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.12), heliWhite);
    fin.position.set(-4.9, 0.9, 0);
    this.heli.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 2.2), heliWhite);
    stab.position.set(-4.2, 0.4, 0);
    this.heli.add(stab);
    for (const sz of [-0.8, 0.8]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0x2f3540 }));
      skid.position.set(0, -1.0, sz);
      this.heli.add(skid);
      for (const sx of [-1.1, 1.1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), skid.material);
        strut.position.set(sx, -0.8, sz);
        this.heli.add(strut);
      }
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
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    navR.position.set(-4.9, 0.2, -0.3);
    this.heli.add(navR);
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0x2aff5a }));
    navG.position.set(-4.9, 0.2, 0.3);
    this.heli.add(navG);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
    );
    beam.position.set(1.2, -7, 0);
    beam.rotation.z = Math.PI;
    this.heli.add(beam);
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

  /** Keep the follow camera from sitting behind a building relative to the
   * hero: if the hero→camera segment enters a building (1 m margin), pull
   * the camera to just before the entry point; a camera already inside a
   * footprint is pulled halfway toward the hero (it converges over
   * frames). Pure function of state — deterministic. */
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
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.max(0.08, Math.sin(ang)), 0.45).normalize();
    const hx = s.player.x, hz = s.player.z;
    this.sun.position.set(hx + sunDir.x * 160, sunDir.y * 160, hz + sunDir.z * 160);
    this.sun.target.position.set(hx, 0, hz);
    this.sun.target.updateMatrixWorld();
    // sun disc on the horizon in the direction of the sun
    this.sunDisc.position.set(hx + sunDir.x * 620, Math.max(12, sunDir.y * 620), hz + sunDir.z * 620);
    this.sunDisc.lookAt(this.camera.position);
    this.sunHalo.position.copy(this.sunDisc.position);
    this.sunHalo.lookAt(this.camera.position);
    // sunset factor: 1 at 18.3, fading to 0 by ~15.8 / ~20.8
    const sunsetF = clamp(1 - Math.abs(hour - 18.3) / 2.5, 0, 1);
    const nightAmt = hour < 5.5 || hour > 19.5 ? 1 : hour > 18.5 ? (hour - 18.5) : hour < 6.5 ? (6.5 - hour) : 0;
    // sky dome gradient, repainted only when the hour bucket changes.
    // A sunset needs a purple zenith + pink mid-sky: without them the
    // dome is one flat orange slab (v2.4 audit of the v2.3 frames).
    const bucket = Math.round(hour * 4);
    if (bucket !== this.skyBucket) {
      this.skyBucket = bucket;
      const ctx = this.skyCanvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      const zen = pal.bg.clone().multiplyScalar(0.72);
      zen.lerp(SUNSET_ZENITH, sunsetF);
      const mid = pal.bg.clone();
      mid.lerp(SUNSET_MID, sunsetF * 0.9);
      g.addColorStop(0, `#${zen.getHexString()}`);
      g.addColorStop(0.55, `#${mid.getHexString()}`);
      g.addColorStop(0.78, `#${pal.fog.getHexString()}`);
      g.addColorStop(1, `#${pal.hemiGround.getHexString()}`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
      this.skyTex.needsUpdate = true;
    }
    this.skyDome.position.set(hx, 0, hz);
    // clouds: warm at sunset, dark at night — thinner + dimmer at sunset
    // so they read as haze, never flat white slabs
    tmpColor.set(0xffffff).lerp(pal.fog, sunsetF * 0.85);
    tmpColor.multiplyScalar((1 - nightAmt * 0.7) * (1 - sunsetF * 0.2));
    this.cloudMat.color.copy(tmpColor);
    this.cloudMat.opacity = (0.55 - nightAmt * 0.2) * (1 - sunsetF * 0.55);
    // sea warms toward the sunset so it is a lit band, not a dark slit
    tmpColor.set(0xffffff).lerp(SUNSET_SEA, sunsetF * 0.45);
    this.seaMat.color.copy(tmpColor);
    // sun glitter: only where the sun ray from the player actually crosses
    // the sea rectangle. From downtown the ray exits over land, so hide it
    // instead of floating a glowing strip across the city (v2.4).
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
        glit = sunsetF * 0.8;
      }
    }
    this.glitter.material.opacity = glit;
    const nightF = clamp(1 - pal.sunI / 1.25, 0, 1);
    this.stars.material.opacity = hour < 5.5 || hour > 19 ? 0.9 : hour > 18 ? 0.5 : 0;
    this.seaMat.map.offset.x = (this.time * 0.004) % 1;
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
    this.carWheels.count = (nSedan + nVan + nScoot) * 4;
    this.carHubs.count = (nSedan + nVan + nScoot) * 4;
    this.carHead.count = nSedan * 2;
    this.carTail.count = nSedan * 2;
    this.carTaxi.count = nSedan;
    this.carBar.count = nBar;
    this.carPush.count = nBar;
    for (const m of [this.carBodySedan, this.carBodyVan, this.carBodyScooter, this.carGlass, this.carGlassRear, this.carRoof, this.carWheels, this.carHubs, this.carHead, this.carTail, this.carTaxi, this.carBar, this.carPush]) {
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
      this.heli.rotation.y = Math.atan2(-(hz - heli.z), hx - heli.x);
      this.rotor.rotation.y = this.time * 22;
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

function pick2(c) {
  return ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff924c'][Math.floor(hash2(c.length, 7, 3) * 5) % 5];
}
