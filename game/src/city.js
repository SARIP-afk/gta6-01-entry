// Solmarina, the city itself: a seeded procedural grid built from instanced meshes.
// Finishing (v3.8-structural, recording #4): file re-written in this session; gates re-run on this exact content — see BATCH2-FINISH-REPORT.md.
// Everything here is deterministic — every size, colour and position comes from the
// seeded random passed in, never from Math.random. The city is one group of meshes plus
// a list of 2D colliders (building footprints, channel banks, pier) and a driving route.
// Instanced meshes are named, so play tests can hide a layer (roads, crosswalks, ...)
// when hunting the frame-rate bottleneck. Phase 1: the bridge over the marina channel
// is one deck spanning the channel along the east-west road at z -6.
// Phase 2: buildCity also returns `map`, a flat 2D summary (roads, building footprints,
// water, landmarks, route) that the HUD draws as the minimap — no 3D data needed there.
// Phase 3.5 (visual pass): procedural canvas textures (asphalt, paving, sand, sea,
// wood — all seeded, all painted with fillRect + gradients only, so the Node test
// stub can run them), window grids on all four faces, roof variants, district accent
// colours, palm variation. Textures are created once at load; the dossier stays
// byte-identical across runs because every pixel comes from the seeded stream.
// Phase 3.6 (visual pass 2): bolder palettes (~50% strong colour), more roof
// variants (parapet rims, stepped roofs, solar panels, water tanks, antennas),
// rooftop landmarks (generic signs + food stacks, our own shapes), ground-floor
// doors + awnings + a denser ground window row, and street props (benches,
// planters, hydrants, sign poles) — chasing the reference city's colour and
// detail density from the chase camera, not its top-down framing.
// Batch 2, Phase C: the road cross-section (curbs + edge lines + stop lines;
// the ±8 m crosswalk gap in the curb IS the curb ramp), arm lamps, traffic
// lights on the two main avenues, bus stops, bins, bollards, a second
// broadleaf tree, a second prop per block, and a segmented frond palm
// (5 stacked trunk cylinders + 7 axis-aligned fronds + coconuts). The palm
// fronds are stepped axis-aligned boxes, NOT a baked merged geometry: the
// Node test stub has no Matrix4 rotation and no BufferGeometry, so a merged
// palm cannot be built in city.js — the silhouette still reads as a palm
// from both gameplay cameras. All new placements are hash-derived (no new
// random() calls); the palm mesh block keeps EXACTLY 4 random() calls per
// palm, in the same order as v3.7, so the seeded stream is untouched.
// Batch 1 (v3.7-sharp): anisotropic filtering on (the blur diagnosis proved the
// road texture collapsed to flat colour at the chase camera's ~7.6° grazing
// angle because anisotropy was never set), asphalt + paving canvases 256 → 512.
// The texture painters keep the SAME random-call counts as v3.6 (every size /
// position is doubled, nothing added) so the seeded stream — and therefore the
// whole city layout — is byte-identical to v3.6: a true apples-to-apples
// before/after.
// Batch 2, Phase B (v3.8-structural): layered building massing — podium base
// bands, cornices, setback crowns, framed ground+1 window units (0.3 m relief,
// past the 0.21 m shadow texel), glass storefronts + fascia, railed balconies,
// curtain-glass tower strips, suburb chimneys. ALL variation is hash-derived
// from (bx, bz, n): NO new random() calls anywhere in this phase, and the new
// meshes use fixed colours or the stored building colour — the seeded stream,
// the city layout and the sim trace (S7) stay byte-identical to v3.7.
import { CITY, PALETTE, districtOf } from './config.js';

/** Road centre lines, each way: 11 internal roads plus the perimeter ring. */
export function roadLines() {
  const lines = [];
  for (let k = 0; k < 11; k += 1) lines.push(-266 + 52 * k);
  return lines;
}

function blockCentre(i) {
  return -292 + 52 * i;
}

function blockRange(i) {
  return { min: -312 + 52 * i, max: -312 + 52 * i + 40 };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function makeSkyTexture(THREE) {
  // A vertical gradient painted once on a canvas: warm horizon, blue top.
  // Batch 2, Phase D: the canvas is 512x512 (was 4x256) so procedural
  // clouds can be painted into it — 8 soft clusters of overlapping
  // translucent white circles, at hash-derived positions (no random() calls,
  // so the seeded stream is untouched). The gradient is vertical, so the
  // wider canvas does not change it.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, PALETTE.skyTop);
  gradient.addColorStop(0.62, '#a8c8e2');
  gradient.addColorStop(0.82, PALETTE.skyHorizon);
  gradient.addColorStop(1, '#ffcf96');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  for (let c = 0; c < 8; c += 1) {
    const cx = (c * 167 + 40) % 512;
    const cy = 50 + ((c * 53) % 130);
    const r = 26 + ((c * 29) % 22);
    for (let b = 0; b < 5; b += 1) {
      const bx = cx + ((b * 37 + c * 11) % 70) - 35;
      const by = cy + ((b * 23 + c * 7) % 24) - 12;
      const br = r * (0.55 + ((b * 13) % 10) / 20);
      ctx.fillStyle = `rgba(255,255,255,${0.10 + ((b * 7 + c) % 3) * 0.05})`;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A hex colour lightened/darkened by `factor` (1 = unchanged). */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

/** Scatter `count` small rects of the given colours: speckle, grain, wear. */
function speckle(ctx, random, w, h, count, colors, sizeMin, sizeMax) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const s = sizeMin + random() * (sizeMax - sizeMin);
    ctx.fillRect(random() * w, random() * h, s, s);
  }
}

/**
 * One canvas texture, repeat-wrapped. The wrap/repeat assignments are guarded:
 * the Node test stub has no RepeatWrapping and no repeat vector (it never
 * renders), while the browser always has both — so the same code runs in both.
 */
function canvasTexture(THREE, w, h, repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Batch 1 (v3.7-sharp): anisotropy 8 at creation — the blur diagnosis proved
  // the road texture collapsed to its average colour at the chase camera's
  // ~7.6° grazing angle because anisotropy was never set (default 1). main.js
  // upgrades this to the GPU's capability (capped at 8) once the renderer
  // exists; clones inherit it via Texture.copy.
  texture.anisotropy = 8;
  if (THREE.RepeatWrapping !== undefined) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  if (texture.repeat && repeatX !== undefined) texture.repeat.set(repeatX, repeatY);
  return { ctx, texture };
}

/** Clone a texture with its own repeat (the bridge deck, the beach strip). */
function cloneTexture(tex, repeatX, repeatY) {
  if (!tex.clone) return tex;
  const t = tex.clone();
  if (t.repeat) t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  return t;
}

function makeAsphaltTexture(THREE, random) {
  // One tile = one 24 m road segment, so the grain reads at driving scale.
  // Batch 1: canvas 256 → 512 (10.7 → 21.4 px/m) with the SAME random-call
  // count (speckle 2600, cracks 14) — every size/position doubled, so the
  // seeded stream and the city layout are unchanged from v3.6.
  const { ctx, texture } = canvasTexture(THREE, 512, 512);
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, 512, 512);
  // Batch 2, Phase D: the speckle palette is lifted with the asphalt base
  // (same random-call count — only the colour literals change, so the seeded
  // stream and the city layout are untouched).
  speckle(ctx, random, 512, 512, 2600, ['#4a4642', '#5a554e', '#413d3a', '#5f5950'], 2, 6);
  // Hairline cracks: thin dark rects, mostly along the driving direction.
  ctx.fillStyle = '#38342f';
  for (let i = 0; i < 14; i += 1) {
    ctx.fillRect(random() * 512, random() * 512, 40 + random() * 120, 2);
  }
  return texture;
}

function makePavingTexture(THREE, random) {
  // One tile = one 40 m sidewalk slab, repeated 4x4: pavers read ~2.5 m.
  // Batch 1: canvas 256 → 512, same random-call count (16 cell shades,
  // speckle 500) — sizes doubled, city layout unchanged.
  const { ctx, texture } = canvasTexture(THREE, 512, 512, 4, 4);
  ctx.fillStyle = PALETTE.sidewalk;
  ctx.fillRect(0, 0, 512, 512);
  const cell = 128;
  for (let gy = 0; gy < 4; gy += 1) {
    for (let gx = 0; gx < 4; gx += 1) {
      ctx.fillStyle = shade(PALETTE.sidewalk, 0.92 + random() * 0.16);
      ctx.fillRect(gx * cell + 4, gy * cell + 4, cell - 8, cell - 8);
    }
  }
  speckle(ctx, random, 512, 512, 500, ['#b8ab8d', '#d8ccb4'], 2, 4);
  return texture;
}

function makeSandTexture(THREE, random) {
  const { ctx, texture } = canvasTexture(THREE, 256, 256, 30, 40);
  ctx.fillStyle = PALETTE.groundSand;
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, random, 256, 256, 3000, ['#c9a370', '#e8c090', '#d9b380', '#b89a68'], 1, 3);
  return texture;
}

function makeSeaTexture(THREE, random) {
  const { ctx, texture } = canvasTexture(THREE, 256, 256, 20, 26);
  ctx.fillStyle = PALETTE.seaDeep;
  ctx.fillRect(0, 0, 256, 256);
  // Long faint streaks: swell lines, not a flat teal sheet.
  for (let i = 0; i < 42; i += 1) {
    ctx.fillStyle = `rgba(46,127,168,${0.12 + random() * 0.18})`;
    ctx.fillRect(random() * 256, random() * 256, 40 + random() * 160, 2 + random() * 4);
  }
  speckle(ctx, random, 256, 256, 400, ['#3a90b8', '#2a6a90'], 1, 2);
  // Batch 2, Phase D: sun glint + foam — a few bright horizontal streaks
  // and pale foam flecks, at hash-derived positions (no random() calls, so
  // the seeded stream is untouched). The sea stays Lambert (the Node stub
  // has no MeshStandardMaterial), so the life comes from the texture.
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = `rgba(255,244,214,${0.20 + ((i * 7) % 3) * 0.08})`;
    ctx.fillRect((i * 53) % 256, (i * 89) % 256, 30 + ((i * 31) % 90), 2);
  }
  for (let i = 0; i < 24; i += 1) {
    ctx.fillStyle = `rgba(235,245,250,${0.25 + ((i * 5) % 3) * 0.10})`;
    ctx.fillRect((i * 41 + 17) % 256, (i * 67 + 9) % 256, 3 + ((i * 11) % 8), 2);
  }
  return texture;
}

function makeWoodTexture(THREE, random) {
  // One tile = one 8 m pier deck piece: plank rows run along the pier.
  const { ctx, texture } = canvasTexture(THREE, 128, 128);
  ctx.fillStyle = PALETTE.pierWood;
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row += 1) {
    ctx.fillStyle = shade(PALETTE.pierWood, 0.9 + random() * 0.2);
    ctx.fillRect(0, row * 16 + 1, 128, 14);
  }
  ctx.fillStyle = '#6a4a2a';
  for (let row = 0; row < 8; row += 1) ctx.fillRect(0, row * 16, 128, 2);
  speckle(ctx, random, 128, 128, 200, ['#7a5a3a', '#9a7a52'], 1, 2);
  return texture;
}

/**
 * A rooftop sign board texture (Phase 3.6): one fixed word in bold white on a
 * flat colour — our own city words (HOTEL, SOLMARINA), no brand, no logo.
 * The text and colours are fixed, so the texture is deterministic; the 2D
 * context calls used here (fillRect, fillText, font/align assignment) are all
 * no-ops the Node test stub already tolerates.
 */
function makeSignTexture(THREE, text, bg) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#f2f6f2';
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildCity(THREE, random) {
  const group = new THREE.Group();
  group.name = 'solmarina-city';
  const colliders = [];
  const buildings = [];
  const roofs = [];
  const roofAC = [];
  const roofPeaks = [];
  // Phase 3.6: parapet rims (4 thin boxes each), stepped roof boxes, flat solar
  // panels, water tanks (+ cone lids), antennas (+ red tips), ground-floor
  // doors and awnings, street props (benches, planters, hydrants, sign poles).
  const roofParapet = [];
  const roofSteps = [];
  const roofSolar = [];
  const roofTanks = [];
  const roofTankTops = [];
  const roofAntennas = [];
  const antennaTips = [];
  const doors = [];
  const awnings = [];
  const benchSeats = [];
  const benchBacks = [];
  const planters = [];
  const shrubs = [];
  const hydrants = [];
  const signPoles = [];
  const signBoards = [];
  const windows = [];
  // Batch 2, Phase B: layered massing (see the header note — hash-derived,
  // no random() calls, fixed or stored colours only).
  const podiums = [];
  const cornices = [];
  const crowns = [];
  const windowFrames = [];
  const storefrontGlass = [];
  const fascias = [];
  const balconySlabs = [];
  const balconyRails = [];
  const chimneys = [];
  // Batch 2, Phase C: road cross-section, traffic lights, street furniture,
  // second tree species — all hash-derived, no random() calls.
  const curbs = [];
  const edgeLines = [];
  const stopLines = [];
  const trafficStructs = [];
  const trafficLenses = [];
  const busStops = [];
  const bins = [];
  const bollards = [];
  const broadleafTrunks = [];
  const broadleafBlobs = [];
  const sidewalks = [];
  const palms = [];
  const lamps = [];
  const dashes = [];
  const crosswalks = [];

  const lines = roadLines();
  // Phase 3.5: textured materials. The map already carries the base colour, so
  // the material colour stays white (it multiplies the map).
  const asphaltTex = makeAsphaltTexture(THREE, random);
  const pavingTex = makePavingTexture(THREE, random);
  const sandTex = makeSandTexture(THREE, random);
  const seaTex = makeSeaTexture(THREE, random);
  const woodTex = makeWoodTexture(THREE, random);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: sandTex });
  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: asphaltTex });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: pavingTex });
  const dashMat = new THREE.MeshLambertMaterial({ color: PALETTE.laneDash });
  const crossMat = new THREE.MeshLambertMaterial({ color: PALETTE.crosswalk });
  const seaMat = new THREE.MeshLambertMaterial({ color: PALETTE.sea });
  const seaDeepMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: seaTex });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: woodTex });
  // The bridge deck is one 140 m box, so it gets its own asphalt repeat (6x1)
  // instead of the road segments' 1x1 — otherwise the grain stretches 12:1.
  const deckMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, map: cloneTexture(asphaltTex, 6, 1),
  });

  function box(w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    return mesh;
  }

  // --- ground, sea, beach, channel water -------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1036, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-182, 0, 0);
  ground.receiveShadow = true;
  group.add(ground);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1064, 1400), seaDeepMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(336 + 532, -0.5, 0);
  sea.receiveShadow = true;
  group.add(sea);

  // A flat sand strip where the land meets the sea, slightly below road level.
  // Its own sand repeat (1x40): the shared ground repeat would stretch the
  // grain 40:1 along this 26 m strip.
  const beachMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, map: cloneTexture(sandTex, 1, 40),
  });
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(26, 1400), beachMat);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(348, -0.25, 0);
  group.add(beach);

  const channel = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.channel.x1 - CITY.channel.x0, CITY.channel.z1 - CITY.channel.z0),
    seaMat,
  );
  channel.rotation.x = -Math.PI / 2;
  channel.position.set(
    (CITY.channel.x0 + CITY.channel.x1) / 2,
    0.06,
    (CITY.channel.z0 + CITY.channel.z1) / 2,
  );
  group.add(channel);

  // --- sky dome ---------------------------------------------------------------
  // toneMapped: false — ACES must not dull the authored sky gradient.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 16, 12),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(THREE), side: THREE.BackSide, fog: false, toneMapped: false }),
  );
  group.add(sky);

  // --- roads: asphalt strips on the ground ------------------------------------
  // Phase 3.5: each strip is cut into 24 m segments, one texture tile each —
  // a single 648 m strip would stretch the asphalt grain 54:1. Still one
  // InstancedMesh (one draw call); the segments tile edge to edge, no gaps.
  const roadGeoms = [];
  for (const c of lines) {
    for (let p = -324; p < 324; p += 24) {
      roadGeoms.push({ x: c, z: p + 12, w: CITY.road, d: 24 });
      roadGeoms.push({ x: p + 12, z: c, w: 24, d: CITY.road });
    }
  }
  for (const edge of [-312, 312]) {
    for (let p = -324; p < 324; p += 24) {
      roadGeoms.push({ x: edge, z: p + 12, w: CITY.road, d: 24 });
      roadGeoms.push({ x: p + 12, z: edge, w: 24, d: CITY.road });
    }
  }
  const roadMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), asphaltMat, roadGeoms.length);
  roadMesh.name = 'roads';
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < roadGeoms.length; i += 1) {
      const r = roadGeoms[i];
      m.makeScale(r.w, 0.1, r.d);
      m.setPosition(r.x, 0.05, r.z);
      roadMesh.setMatrixAt(i, m);
    }
  }
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // --- lane dashes + crosswalk stripes ----------------------------------------
  for (const c of lines) {
    for (let p = -300; p <= 300; p += 16) {
      dashes.push({ x: c, z: p, w: 0.5, d: 5 });
      dashes.push({ x: p, z: c, w: 5, d: 0.5 });
    }
  }
  for (const cx of lines) {
    for (const cz of lines) {
      for (let s = -4; s <= 4; s += 2) {
        crosswalks.push({ x: cx + s, z: cz - 8.5, w: 1, d: 3 });
        crosswalks.push({ x: cx + s, z: cz + 8.5, w: 1, d: 3 });
        crosswalks.push({ x: cx - 8.5, z: cz + s, w: 3, d: 1 });
        crosswalks.push({ x: cx + 8.5, z: cz + s, w: 3, d: 1 });
      }
    }
  }
  // Batch 2, Phase C: the road cross-section. The curb runs along both edges
  // of every road (11 internal + the 2 perimeter lines, both orientations),
  // in pieces between the intersections — the ±8 m crosswalk zone is left
  // open, so the gap IS the curb ramp where the zebra meets the sidewalk.
  // The edge line is a white strip inside the curb. No random() calls.
  {
    const roadLinesAll = [...lines, -312, 312];
    const gaps = [];
    let prev = -324;
    for (const c of lines) {
      gaps.push([prev, c - 8]);
      prev = c + 8;
    }
    gaps.push([prev, 324]);
    for (const c of roadLinesAll) {
      for (const [g0, g1] of gaps) {
        const len = g1 - g0;
        const mid = (g0 + g1) / 2;
        curbs.push({ x: c - 6.075, z: mid, w: 0.15, d: len, h: 0.3 });
        curbs.push({ x: c + 6.075, z: mid, w: 0.15, d: len, h: 0.3 });
        edgeLines.push({ x: c - 5.5, z: mid, w: 0.15, d: len, h: 0.12 });
        edgeLines.push({ x: c + 5.5, z: mid, w: 0.15, d: len, h: 0.12 });
        curbs.push({ x: mid, z: c - 6.075, w: len, d: 0.15, h: 0.3 });
        curbs.push({ x: mid, z: c + 6.075, w: len, d: 0.15, h: 0.3 });
        edgeLines.push({ x: mid, z: c - 5.5, w: len, d: 0.15, h: 0.12 });
        edgeLines.push({ x: mid, z: c + 5.5, w: len, d: 0.15, h: 0.12 });
      }
    }
    // Stop lines: one bar per approach at the 121 internal intersections,
    // 11 m before the intersection centre (just before the zebra at ±8.5).
    for (const cx of lines) {
      for (const cz of lines) {
        stopLines.push({ x: cx + 2.75, z: cz - 11, w: 5.5, d: 0.6, h: 0.12 });
        stopLines.push({ x: cx - 2.75, z: cz + 11, w: 5.5, d: 0.6, h: 0.12 });
        stopLines.push({ x: cx - 11, z: cz + 2.75, w: 0.6, d: 5.5, h: 0.12 });
        stopLines.push({ x: cx + 11, z: cz - 2.75, w: 0.6, d: 5.5, h: 0.12 });
      }
    }
    // Traffic lights on the two main avenues (x = -6 north-south, z = -6
    // east-west): one per intersection, 21 in all (the shared corner -6,-6
    // counted once). Pole on the north-east corner, arm reaching over the
    // road, head hanging at the arm's end, 3 lenses facing the oncoming
    // lane — the lit one (red top or green bottom, by hash) is static.
    const addLight = (cx, cz, alongX) => {
      const px = cx + 7.5;
      const pz = cz + 7.5;
      trafficStructs.push({ x: px, z: pz, w: 0.3, d: 0.3, h: 6, y: 3 });
      const hx = alongX ? px - 2.5 : px;
      const hz = alongX ? pz : pz - 2.5;
      if (alongX) {
        trafficStructs.push({ x: px - 1.25, z: pz, w: 2.5, d: 0.15, h: 0.15, y: 5.9 });
      } else {
        trafficStructs.push({ x: px, z: pz - 1.25, w: 0.15, d: 2.5, h: 0.15, y: 5.9 });
      }
      trafficStructs.push({ x: hx, z: hz, w: 0.5, d: 0.5, h: 1.2, y: 5.3 });
      const litGreen = ((cx + cz) % 2 + 2) % 2 === 0;
      for (let li = 0; li < 3; li += 1) {
        const off = 0.35 - li * 0.35;
        const lit = (li === 0 && !litGreen) || (li === 2 && litGreen);
        const col = lit ? (li === 0 ? '#ff3a2a' : '#2aff5a') : '#1a1a1a';
        if (alongX) {
          trafficLenses.push({ x: hx, z: hz - 0.26, w: 0.2, d: 0.06, h: 0.2, y: 5.3 + off, color: col });
        } else {
          trafficLenses.push({ x: hx - 0.26, z: hz, w: 0.06, d: 0.2, h: 0.2, y: 5.3 + off, color: col });
        }
      }
    };
    for (const cz of lines) addLight(-6, cz, true);
    for (const cx of lines) {
      if (cx !== -6) addLight(cx, -6, false);
    }
  }
  function instancedBoxes(list, mat, y, name) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    mesh.name = name;
    const m = new THREE.Matrix4();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h ?? 0.12, b.d);
      m.setPosition(b.x, y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  instancedBoxes(dashes, dashMat, 0.12, 'dashes');
  instancedBoxes(crosswalks, crossMat, 0.12, 'crosswalks');

  // --- blocks: sidewalks, buildings, palms, lamps ------------------------------
  const stadiumBlocks = new Set(['1,8', '1,9', '1,10', '2,8', '2,9', '2,10', '3,8', '3,9', '3,10']);
  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      const cx = blockCentre(bx);
      const cz = blockCentre(bz);
      const xr = blockRange(bx);
      const zr = blockRange(bz);
      sidewalks.push({ x: cx, z: cz, w: 40, d: 40, h: 0.2 });
      if (stadiumBlocks.has(`${bx},${bz}`)) continue;
      if (bx === CITY.tower.bx && bz === CITY.tower.bz) continue;
      // Waterfront park along the channel: no buildings, palms only.
      if (Math.abs(cz) < 60 && cx > 150) {
        for (let p = 0; p < 3; p += 1) {
          palms.push({ x: xr.min + 4 + random() * 32, z: zr.min + 4 + random() * 32 });
        }
        continue;
      }
      const district = districtOf(bx, bz);
      const palette = district === 'downtown'
        ? PALETTE.buildingDowntown
        : district === 'marina' ? PALETTE.buildingMarina : PALETTE.buildingSuburb;
      const accent = district === 'downtown'
        ? PALETTE.buildingDowntownAccent
        : district === 'marina' ? PALETTE.buildingMarinaAccent : PALETTE.buildingSuburbAccent;
      const count = district === 'downtown' ? 1 : 2;
      for (let n = 0; n < count; n += 1) {
        const w = district === 'downtown' ? 24 + random() * 6 : 11 + random() * 7;
        const d = district === 'downtown' ? 24 + random() * 6 : 11 + random() * 7;
        const h = district === 'downtown'
          ? 30 + random() * 60
          : district === 'marina' ? 12 + random() * 18 : 6 + random() * 8;
        const x = count === 1 ? cx : xr.min + 8 + (n * 20) + (random() * 4 - 2);
        const z = count === 1 ? cz : zr.min + 8 + (n * 20) + (random() * 4 - 2);
        // Phase 3.6: ~50% of buildings take a strong colour (base lists carry
        // bold colours too now) — the reference city is half strong colour,
        // not a beige city with a few accents.
        const color = random() < 0.5 ? pick(random, accent) : pick(random, palette);
        buildings.push({ x, z, w, d, h, color, district });
        // Batch 2, Phase B: layered massing, hash-derived from (bx, bz, n) —
        // no random() calls, so the seeded stream is untouched. The podium is
        // the same footprint (a darker base band, no collider change); the
        // cornice caps the shaft just under the roof slab; the setback crown
        // breaks the flat roofline on ~1/3 of the taller buildings.
        const dark = shade(color, 0.72);
        // The podium is 6 cm wider than the shaft on each side: its faces
        // sit proud of the wall instead of coplanar with it (coplanar faces
        // z-fight), and 3 cm is far inside the 0.3 m collider margin.
        podiums.push({ x, z, w: w + 0.06, d: d + 0.06, h: 1.2, y: 0.6, color: dark });
        cornices.push({ x, z, w: w + 0.4, d: d + 0.4, h: 0.25, y: h - 0.125, color: dark });
        const crownHash = (bx * 7 + bz * 3 + n * 5) % 3;
        const isSuburbLow = district === 'suburb' && h < 12 && ((bx * 11 + bz * 7 + n * 3) % 3 === 0);
        if ((h > 15 || isSuburbLow) && crownHash === 0) {
          crowns.push({
            x, z, w: w * 0.55, d: d * 0.55,
            h: isSuburbLow ? 1.2 : 2.5, y: h + 0.7 + (isSuburbLow ? 0.6 : 1.25), color,
          });
        }
        // Building types, all hashed: storefront (downtown/marina commercial),
        // corner shop (storefront wrapping two faces), balcony residential,
        // curtain-glass tower (downtown, tall), suburb low-rise (chimney + cap).
        const isStorefront = district !== 'suburb' && ((bx * 5 + bz * 3 + n * 7) % 5 < 2);
        const isCornerShop = isStorefront && ((bx + bz + n) % 4 === 0);
        const hasBalcony = district !== 'downtown' && ((bx * 3 + bz * 5 + n) % 3 === 0);
        const isTower = district === 'downtown' && h > 40;
        roofs.push({ x, z, w: w + 0.8, d: d + 0.8, h: 0.7, y: h + 0.35 });
        colliders.push({ minX: x - w / 2 - 0.3, maxX: x + w / 2 + 0.3, minZ: z - d / 2 - 0.3, maxZ: z + d / 2 + 0.3 });
        // Roof furniture: an AC box on ~45% of roofs, a pyramid peak on ~20%
        // of low-rise roofs (never on downtown towers — they stay flat + AC).
        const roofRoll = random();
        if (roofRoll < 0.45) {
          roofAC.push({
            x: x + (random() * (w - 6) - (w - 6) / 2),
            z: z + (random() * (d - 6) - (d - 6) / 2),
            w: 2.5, d: 2, h: 1, y: h + 0.7 + 0.5,
          });
        } else if (roofRoll < 0.65 && district !== 'downtown') {
          roofPeaks.push({ x, z, w: w * 0.55, d: d * 0.55, h: 3, y: h + 0.7 + 1.5 });
        }
        // Window grid on ALL FOUR faces — the old build only striped the south
        // face, so the chase camera mostly saw blank walls. Small panes, one
        // per ~5 m across and ~4.5 m up, capped at 10 floors so a tower does
        // not drown the scene in glass. ~15% of panes are lit warm.
        // Phase 3.6: the ground row starts at y 2.4 (was 5 — the whole ground
        // floor was bare wall, the pass-1 cover gap) and is denser (one pane
        // per ~3 m, shopfront spacing); upper rows keep the 5 m grid.
        // Ground-floor door (Phase 3.6): face + offset from the block hash, so
        // no random is drawn here — the window layout stays deterministic.
        const doorFace = (bx * 7 + bz * 3 + n * 5) % 4;
        const doorSpan = doorFace < 2 ? w : d;
        const doorAlong = ((((bx * 13 + bz * 5 + n * 11) % 10) - 5) / 10) * doorSpan * 0.5;
        const rows = Math.min(10, Math.max(1, Math.floor((h - 3) / 4.5)));
        // Batch 2, Phase B: glass storefront + fascia on the door face (the
        // ground floor reads as shops from the street, not blank wall). The
        // glass replaces the ground-row windows on that face (skipped in the
        // window loop below, AFTER the lit roll is drawn) and the fascia
        // replaces the awning there. A corner shop wraps both faces.
        if (isStorefront) {
          const faces = [doorFace];
          if (isCornerShop) faces.push((doorFace + 1) % 4);
          for (const f of faces) {
            const span = f < 2 ? w : d;
            const gw = span - 2;
            if (f === 0) {
              storefrontGlass.push({ x, z: z + d / 2 + 0.15, w: gw, d: 0.1, h: 2.6, y: 1.3 });
              fascias.push({ x, z: z + d / 2 + 0.075, w: span - 1, d: 0.15, h: 0.5, y: 2.85 });
            } else if (f === 1) {
              storefrontGlass.push({ x, z: z - d / 2 - 0.15, w: gw, d: 0.1, h: 2.6, y: 1.3 });
              fascias.push({ x, z: z - d / 2 - 0.075, w: span - 1, d: 0.15, h: 0.5, y: 2.85 });
            } else if (f === 2) {
              storefrontGlass.push({ x: x + w / 2 + 0.15, z, w: 0.1, d: gw, h: 2.6, y: 1.3 });
              fascias.push({ x: x + w / 2 + 0.075, z, w: 0.15, d: span - 1, h: 0.5, y: 2.85 });
            } else {
              storefrontGlass.push({ x: x - w / 2 - 0.15, z, w: 0.1, d: gw, h: 2.6, y: 1.3 });
              fascias.push({ x: x - w / 2 - 0.075, z, w: 0.15, d: span - 1, h: 0.5, y: 2.85 });
            }
          }
        }
        for (let f = 0; f < 4; f += 1) {
          const span = f < 2 ? w : d;
          const cols = Math.max(2, Math.floor(span / 5));
          for (let r = 0; r < rows; r += 1) {
            const y = 2.4 + r * 4.5;
            if (y + 0.8 > h - 1) continue;
            const colsThis = r === 0 ? Math.max(2, Math.floor(span / 3)) : cols;
            for (let c = 0; c < colsThis; c += 1) {
              const along = -span / 2 + ((c + 0.5) * span) / colsThis;
              // No pane where the ground-floor door stands.
              if (r === 0 && f === doorFace && Math.abs(along - doorAlong) < 1.7) continue;
              const lit = random() < 0.15;
              // Batch 2, Phase B: the storefront glass replaces the ground
              // row on its face, and the tower's glass strips replace the
              // panes they cross — both AFTER the lit roll above, so the
              // seeded stream keeps its exact call count and the layout is
              // byte-identical to v3.7.
              if (isStorefront && r === 0 && f === doorFace) continue;
              if (isCornerShop && r === 0 && f === (doorFace + 1) % 4) continue;
              if (isTower && (Math.abs(along + span / 4) < 1.3 || Math.abs(along) < 1.3 || Math.abs(along - span / 4) < 1.3)) continue;
              // Framed units on ground + first floor (r <= 1): a dark frame
              // 0.3 m deep (past the 0.21 m shadow texel) with the pane
              // sitting proud of it at 0.42 m — the relief the blur diagnosis
              // asked for. Upper floors keep the flush 0.09 m panes.
              const deep = r <= 1;
              const out = deep ? 0.36 : 0.09;
              if (deep) {
                if (f === 0) windowFrames.push({ x: x + along, z: z + d / 2 + 0.16, w: 2.2, d: 0.3, h: 2.0, y });
                else if (f === 1) windowFrames.push({ x: x + along, z: z - d / 2 - 0.16, w: 2.2, d: 0.3, h: 2.0, y });
                else if (f === 2) windowFrames.push({ x: x + w / 2 + 0.16, z: z + along, w: 0.3, d: 2.2, h: 2.0, y });
                else windowFrames.push({ x: x - w / 2 - 0.16, z: z + along, w: 0.3, d: 2.2, h: 2.0, y });
              }
              if (f === 0) windows.push({ x: x + along, z: z + d / 2 + out, w: 1.8, d: 0.12, h: 1.6, y, lit });
              else if (f === 1) windows.push({ x: x + along, z: z - d / 2 - out, w: 1.8, d: 0.12, h: 1.6, y, lit });
              else if (f === 2) windows.push({ x: x + w / 2 + out, z: z + along, w: 0.12, d: 1.8, h: 1.6, y, lit });
              else windows.push({ x: x - w / 2 - out, z: z + along, w: 0.12, d: 1.8, h: 1.6, y, lit });
            }
          }
        }
        // Batch 2, Phase B: railed balconies above the entrance (floors 2-3),
        // curtain-glass tower strips, suburb chimney. All hash-derived.
        if (hasBalcony) {
          for (const r of [2, 3]) {
            if (r >= rows) continue;
            const by = 2.4 + r * 4.5 - 1.0;
            // Slab (2.0 x 0.9, centred on the door) + front + side rails.
            if (doorFace === 0) {
              balconySlabs.push({ x: x + doorAlong, z: z + d / 2 + 0.45, w: 2.0, d: 0.9, h: 0.15, y: by });
              balconyRails.push({ x: x + doorAlong, z: z + d / 2 + 0.875, w: 2.0, d: 0.05, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x + doorAlong - 0.975, z: z + d / 2 + 0.45, w: 0.05, d: 0.9, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x + doorAlong + 0.975, z: z + d / 2 + 0.45, w: 0.05, d: 0.9, h: 0.9, y: by + 0.5 });
            } else if (doorFace === 1) {
              balconySlabs.push({ x: x + doorAlong, z: z - d / 2 - 0.45, w: 2.0, d: 0.9, h: 0.15, y: by });
              balconyRails.push({ x: x + doorAlong, z: z - d / 2 - 0.875, w: 2.0, d: 0.05, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x + doorAlong - 0.975, z: z - d / 2 - 0.45, w: 0.05, d: 0.9, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x + doorAlong + 0.975, z: z - d / 2 - 0.45, w: 0.05, d: 0.9, h: 0.9, y: by + 0.5 });
            } else if (doorFace === 2) {
              balconySlabs.push({ x: x + w / 2 + 0.45, z: z + doorAlong, w: 0.9, d: 2.0, h: 0.15, y: by });
              balconyRails.push({ x: x + w / 2 + 0.875, z: z + doorAlong, w: 0.05, d: 2.0, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x + w / 2 + 0.45, z: z + doorAlong - 0.975, w: 0.9, d: 0.05, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x + w / 2 + 0.45, z: z + doorAlong + 0.975, w: 0.9, d: 0.05, h: 0.9, y: by + 0.5 });
            } else {
              balconySlabs.push({ x: x - w / 2 - 0.45, z: z + doorAlong, w: 0.9, d: 2.0, h: 0.15, y: by });
              balconyRails.push({ x: x - w / 2 - 0.875, z: z + doorAlong, w: 0.05, d: 2.0, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x - w / 2 - 0.45, z: z + doorAlong - 0.975, w: 0.9, d: 0.05, h: 0.9, y: by + 0.5 });
              balconyRails.push({ x: x - w / 2 - 0.45, z: z + doorAlong + 0.975, w: 0.9, d: 0.05, h: 0.9, y: by + 0.5 });
            }
          }
        }
        if (isTower) {
          for (let f = 0; f < 4; f += 1) {
            const span = f < 2 ? w : d;
            for (const c of [-0.25, 0, 0.25]) {
              const along = span * c;
              if (f === 0) storefrontGlass.push({ x: x + along, z: z + d / 2 + 0.15, w: 0.8, d: 0.15, h: h - 4, y: 2 + (h - 4) / 2 });
              else if (f === 1) storefrontGlass.push({ x: x + along, z: z - d / 2 - 0.15, w: 0.8, d: 0.15, h: h - 4, y: 2 + (h - 4) / 2 });
              else if (f === 2) storefrontGlass.push({ x: x + w / 2 + 0.15, z: z + along, w: 0.15, d: 0.8, h: h - 4, y: 2 + (h - 4) / 2 });
              else storefrontGlass.push({ x: x - w / 2 - 0.15, z: z + along, w: 0.15, d: 0.8, h: h - 4, y: 2 + (h - 4) / 2 });
            }
          }
        }
        if (isSuburbLow) {
          chimneys.push({ x: x + w / 4, z: z - d / 4, w: 0.8, d: 0.8, h: 1.5, y: h + 0.7 + 0.75 });
        }
        // Phase 3.6: roof variety — parapet rims (~30%), stepped roof boxes
        // (~20%), plus roof props: flat solar panels, water tanks with cone
        // lids, antennas with red tips. All seeded, all axis-aligned (the
        // Node test stub has no matrix rotation), all one instanced mesh each.
        const roofVariant = random();
        if (roofVariant < 0.3) {
          // Parapet rim: four thin walls around the roof edge.
          const py = h + 0.7 + 0.45;
          roofParapet.push({ x, z: z - d / 2 - 0.1, w: w + 0.8, d: 0.5, h: 0.9, y: py });
          roofParapet.push({ x, z: z + d / 2 + 0.1, w: w + 0.8, d: 0.5, h: 0.9, y: py });
          roofParapet.push({ x: x - w / 2 - 0.1, z, w: 0.5, d: d + 0.8, h: 0.9, y: py });
          roofParapet.push({ x: x + w / 2 + 0.1, z, w: 0.5, d: d + 0.8, h: 0.9, y: py });
        } else if (roofVariant < 0.5) {
          roofSteps.push({ x, z, w: w * 0.55, d: d * 0.55, h: 1.4, y: h + 0.7 + 0.7 });
        }
        const propRoll = random();
        if (propRoll < 0.18) {
          // Solar field: 2-4 flat dark panels spread over the roof.
          const panels = 2 + Math.floor(random() * 3);
          for (let p = 0; p < panels; p += 1) {
            roofSolar.push({
              x: x + (random() * (w - 6) - (w - 6) / 2),
              z: z + (random() * (d - 6) - (d - 6) / 2),
              w: 3, d: 2, h: 0.15, y: h + 0.7 + 0.1,
            });
          }
        } else if (propRoll < 0.32) {
          // Water tank: cylinder body + cone lid.
          const tx = x + (random() * (w - 6) - (w - 6) / 2);
          const tz = z + (random() * (d - 6) - (d - 6) / 2);
          roofTanks.push({ x: tx, z: tz, w: 2.4, d: 2.4, h: 2.2, y: h + 0.7 + 1.1 });
          roofTankTops.push({ x: tx, z: tz, w: 2.6, d: 2.6, h: 1, y: h + 0.7 + 2.2 + 0.5 });
        } else if (propRoll < 0.42) {
          // Antenna mast with a red tip.
          const ax = x + (random() * (w - 6) - (w - 6) / 2);
          const az = z + (random() * (d - 6) - (d - 6) / 2);
          roofAntennas.push({ x: ax, z: az, w: 0.3, d: 0.3, h: 7, y: h + 0.7 + 3.5 });
          antennaTips.push({ x: ax, z: az, w: 0.6, d: 0.6, h: 0.6, y: h + 0.7 + 7 + 0.3 });
        }
        // Ground-floor door + awning on the hashed face (see above).
        // Batch 2, Phase B: on a storefront the door sits proud of the glass
        // band (0.25 out instead of 0.12) and the fascia replaces the awning —
        // but the awning colour roll is still drawn, so the seeded stream is
        // untouched.
        const doorOut = isStorefront ? 0.25 : 0.12;
        const awningColor = pick(random, PALETTE.awningColors);
        if (doorFace === 0) {
          doors.push({ x: x + doorAlong, z: z + d / 2 + doorOut, w: 1.6, d: 0.18, h: 2.6, y: 1.3 });
          if (!isStorefront) awnings.push({ x: x + doorAlong, z: z + d / 2 + 0.55, w: 2.6, d: 1.1, h: 0.15, y: 3.0, color: awningColor });
        } else if (doorFace === 1) {
          doors.push({ x: x + doorAlong, z: z - d / 2 - doorOut, w: 1.6, d: 0.18, h: 2.6, y: 1.3 });
          if (!isStorefront) awnings.push({ x: x + doorAlong, z: z - d / 2 - 0.55, w: 2.6, d: 1.1, h: 0.15, y: 3.0, color: awningColor });
        } else if (doorFace === 2) {
          doors.push({ x: x + w / 2 + doorOut, z: z + doorAlong, w: 0.18, d: 1.6, h: 2.6, y: 1.3 });
          if (!isStorefront) awnings.push({ x: x + w / 2 + 0.55, z: z + doorAlong, w: 1.1, d: 2.6, h: 0.15, y: 3.0, color: awningColor });
        } else {
          doors.push({ x: x - w / 2 - doorOut, z: z + doorAlong, w: 0.18, d: 1.6, h: 2.6, y: 1.3 });
          if (!isStorefront) awnings.push({ x: x - w / 2 - 0.55, z: z + doorAlong, w: 1.1, d: 2.6, h: 0.15, y: 3.0, color: awningColor });
        }
        if (random() < 0.6) {
          palms.push({ x: xr.min + 3 + random() * 6, z: zr.min + 3 + random() * 6 });
        }
      }
      if (random() < 0.5) {
        lamps.push({ x: xr.min + 2, z: zr.min + 2 });
      }
    }
  }
  instancedBoxes(sidewalks, walkMat, 0.1, 'sidewalks');

  // Landmarks: the tallest downtown tower goes glass blue, the tallest marina
  // building goes teal — two strong accents the eye can find from any street.
  for (const [d, color] of [['downtown', '#3a6a9a'], ['marina', '#2e8a9a']]) {
    let tallest = null;
    for (const b of buildings) {
      if (b.district === d && (!tallest || b.h > tallest.h)) tallest = b;
    }
    if (tallest) tallest.color = color;
  }

  // Buildings: one instanced box per building, coloured per instance.
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      buildings.length,
    );
    mesh.name = 'buildings';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.h / 2, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(b.color));
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Roof caps, coloured per instance so the roofscape is not one brown slab.
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      roofs.length,
    );
    mesh.name = 'roofs';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < roofs.length; i += 1) {
      const r = roofs[i];
      m.makeScale(r.w, r.h, r.d);
      m.setPosition(r.x, r.y, r.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(pick(random, PALETTE.roofColors)));
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Roof AC boxes.
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: '#8a8f94' }),
      roofAC.length,
    );
    mesh.name = 'roof-ac';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofAC.length; i += 1) {
      const r = roofAC[i];
      m.makeScale(r.w, r.h, r.d);
      m.setPosition(r.x, r.y, r.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Roof pyramids (4-sided cones; the square base reads as a pyramid with no
  // per-instance rotation needed — its corners sit on the axes).
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.02, 1, 1, 4),
      new THREE.MeshLambertMaterial({ color: PALETTE.roof }),
      roofPeaks.length,
    );
    mesh.name = 'roof-peaks';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofPeaks.length; i += 1) {
      const r = roofPeaks[i];
      m.makeScale(r.w / 2, r.h, r.d / 2);
      m.setPosition(r.x, r.y, r.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Window panes on all four faces, coloured per instance (~15% lit warm).
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      windows.length,
    );
    mesh.name = 'windows';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < windows.length; i += 1) {
      const w = windows[i];
      m.makeScale(w.w, w.h, w.d);
      m.setPosition(w.x, w.y, w.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(w.lit ? PALETTE.windowLit : PALETTE.windowGlass));
    }
    group.add(mesh);
  }
  // Batch 2, Phase B: podium base bands, cornices, setback crowns — one
  // instanced mesh each, coloured per instance from the stored (already
  // darkened) building colour. No random() calls here, so the colours of the
  // meshes built after this one are exactly what v3.7 produced.
  for (const [list, name] of [[podiums, 'podiums'], [cornices, 'cornices'], [crowns, 'crowns']]) {
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      list.length,
    );
    mesh.name = name;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(b.color));
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Batch 2, Phase B: framed window units (dark, one mesh), storefront glass
  // + tower strips (pale blue glass, one mesh), fascia boards, balcony slabs
  // + rails, chimneys — all single-colour instanced meshes.
  for (const [list, name, colorHex, shadow] of [
    [windowFrames, 'window-frames', 0x2a2f36, true],
    [storefrontGlass, 'storefront-glass', 0x9fc4d4, false],
    [fascias, 'fascias', 0x2a2f36, true],
    [balconySlabs, 'balcony-slabs', 0xcfc8b8, true],
    [balconyRails, 'balcony-rails', 0x2a2f36, true],
    [chimneys, 'chimneys', 0x7a4a3a, true],
  ]) {
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: colorHex }),
      list.length,
    );
    mesh.name = name;
    const m = new THREE.Matrix4();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = shadow;
    group.add(mesh);
  }
  // Phase 3.6: parapet rims + stepped roofs, coloured per instance from the
  // roof palette (a few bold roofs among the brown ones).
  for (const [list, name] of [[roofParapet, 'roof-parapets'], [roofSteps, 'roof-steps']]) {
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      list.length,
    );
    mesh.name = name;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(pick(random, PALETTE.roofColors)));
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Phase 3.6: flat solar panels (dark blue slabs on the roofs).
  if (roofSolar.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: '#1a3a6a' }),
      roofSolar.length,
    );
    mesh.name = 'roof-solar';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofSolar.length; i += 1) {
      const b = roofSolar[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Phase 3.6: water tanks (cylinder bodies + cone lids) and antennas.
  if (roofTanks.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      new THREE.MeshLambertMaterial({ color: '#d8dde2' }),
      roofTanks.length,
    );
    mesh.name = 'roof-tanks';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofTanks.length; i += 1) {
      const b = roofTanks[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (roofTankTops.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.02, 0.5, 1, 8),
      new THREE.MeshLambertMaterial({ color: PALETTE.roof }),
      roofTankTops.length,
    );
    mesh.name = 'roof-tank-tops';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofTankTops.length; i += 1) {
      const b = roofTankTops[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (roofAntennas.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
      new THREE.MeshLambertMaterial({ color: '#3a3f46' }),
      roofAntennas.length,
    );
    mesh.name = 'roof-antennas';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofAntennas.length; i += 1) {
      const b = roofAntennas[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (antennaTips.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshLambertMaterial({ color: '#d8382a', emissive: 0xa02010, emissiveIntensity: 0.8 }),
      antennaTips.length,
    );
    mesh.name = 'antenna-tips';
    const m = new THREE.Matrix4();
    for (let i = 0; i < antennaTips.length; i += 1) {
      const b = antennaTips[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    group.add(mesh);
  }
  // Phase 3.6: ground-floor doors (one dark slab per building) + awnings
  // (coloured per instance, the shop colours).
  if (doors.length > 0) {
    instancedBoxes(doors, new THREE.MeshLambertMaterial({ color: '#3a2f28' }), 1.3, 'doors');
  }
  if (awnings.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      awnings.length,
    );
    mesh.name = 'awnings';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < awnings.length; i += 1) {
      const b = awnings[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(b.color));
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Batch 2, Phase C: segmented frond palm — 5 stacked trunk cylinders
  // (tapering 0.42 -> 0.16, banded shades like stacked rings) + a crown of
  // 7 axis-aligned fronds (4 cardinal, each a horizontal base + a drooping
  // tip, + 3 diagonal plates; the 4th diagonal is the hash-missing one) +
  // 2 coconuts under the crown. The fronds are stepped axis-aligned boxes:
  // the Node stub has no Matrix4 rotation and no BufferGeometry, so a baked
  // merged palm cannot be built here. Random() budget: EXACTLY 4 calls per
  // palm, in the same order as v3.7 (trunk height, frond spread, frond
  // width, leaf shade) — the seeded stream is untouched.
  {
    const trunkSegs = 5;
    const frondsPerPalm = 13;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      palms.length * trunkSegs,
    );
    trunk.name = 'palm-trunks';
    const frond = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      palms.length * frondsPerPalm,
    );
    frond.name = 'palm-fronds';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const leafShades = ['#3f7a3a', '#4a8a3a', '#35702f'];
    const trunkShades = ['#7a5a3a', '#8a6a45', '#6a4a30'];
    const diags = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let ti = 0;
    let fi = 0;
    for (let i = 0; i < palms.length; i += 1) {
      const p = palms[i];
      const trunkH = 6 * (0.85 + random() * 0.3);
      const cs = 1.2 + random() * 0.5;
      const fw = 0.55 * (0.85 + random() * 0.3);
      const leaf = pick(random, leafShades);
      for (let s = 0; s < trunkSegs; s += 1) {
        const r = 0.42 - 0.065 * s;
        m.makeScale(r, trunkH / trunkSegs, r);
        m.setPosition(p.x, ((s + 0.5) * trunkH) / trunkSegs, p.z);
        trunk.setMatrixAt(ti, m);
        trunk.setColorAt(ti, color.set(trunkShades[(i + s) % 3]));
        ti += 1;
      }
      const crownY = trunkH;
      const L = 2.2 * cs;
      const tipL = 1.1 * cs;
      for (const [dx, dz] of dirs) {
        m.makeScale(Math.abs(dx) * L + (dx === 0 ? fw : 0), 0.08, Math.abs(dz) * L + (dz === 0 ? fw : 0));
        m.setPosition(p.x + dx * L * 0.5, crownY + 0.3, p.z + dz * L * 0.5);
        frond.setMatrixAt(fi, m);
        frond.setColorAt(fi, color.set(leaf));
        fi += 1;
        m.makeScale(Math.abs(dx) * tipL + (dx === 0 ? fw * 0.85 : 0), 0.08, Math.abs(dz) * tipL + (dz === 0 ? fw * 0.85 : 0));
        m.setPosition(p.x + dx * (L + tipL * 0.5), crownY - 0.25, p.z + dz * (L + tipL * 0.5));
        frond.setMatrixAt(fi, m);
        frond.setColorAt(fi, color.set(leaf));
        fi += 1;
      }
      const missing = i % 4;
      for (let d = 0; d < 4; d += 1) {
        if (d === missing) continue;
        const [dx, dz] = diags[d];
        m.makeScale(1.5 * cs, 0.08, 1.5 * cs);
        m.setPosition(p.x + dx * 1.1 * cs, crownY - 0.1, p.z + dz * 1.1 * cs);
        frond.setMatrixAt(fi, m);
        frond.setColorAt(fi, color.set(leaf));
        fi += 1;
      }
      for (const [ox, oz] of [[0.35, 0.2], [-0.3, -0.25]]) {
        m.makeScale(0.28, 0.28, 0.28);
        m.setPosition(p.x + ox, crownY - 0.25, p.z + oz);
        frond.setMatrixAt(fi, m);
        frond.setColorAt(fi, color.set('#6a4a2a'));
        fi += 1;
      }
    }
    trunk.castShadow = true;
    frond.castShadow = true;
    group.add(trunk);
    group.add(frond);
  }
  // Streetlights: pole + arm reaching over the road + warm head at the arm's
  // end (Batch 2, Phase C — the old head sat directly above the pole, so the
  // light never hung over the road). The lamps stand 2 m inside the block,
  // so a 2.5 m arm puts the head just past the road edge.
  {
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 7, 6),
      new THREE.MeshLambertMaterial({ color: PALETTE.lampPole }),
      lamps.length,
    );
    pole.name = 'lamp-poles';
    const arm = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x2a2f36 }),
      lamps.length,
    );
    arm.name = 'lamp-arms';
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.3),
      new THREE.MeshLambertMaterial({ color: PALETTE.lampGlow, emissive: 0xffc861, emissiveIntensity: 0.7 }),
      lamps.length,
    );
    head.name = 'lamp-heads';
    const m = new THREE.Matrix4();
    for (let i = 0; i < lamps.length; i += 1) {
      const l = lamps[i];
      m.makeScale(1, 1, 1);
      m.setPosition(l.x, 3.5, l.z);
      pole.setMatrixAt(i, m);
      m.makeScale(2.5, 0.12, 0.12);
      m.setPosition(l.x - 1.25, 6.9, l.z);
      arm.setMatrixAt(i, m);
      m.makeScale(1, 1, 1);
      m.setPosition(l.x - 2.5, 6.8, l.z);
      head.setMatrixAt(i, m);
    }
    group.add(pole);
    group.add(arm);
    group.add(head);
  }

  // Phase 3.6: street props, seeded, on the sidewalks — benches, planters,
  // hydrants and sign poles. One spot per block corner, always inside the
  // block footprint (never on the road) and never with a collider: they are
  // visual only, so a pedestrian may clip one for a frame — cosmetic.
  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      if (stadiumBlocks.has(`${bx},${bz}`)) continue;
      if (bx === CITY.tower.bx && bz === CITY.tower.bz) continue;
      const xr = blockRange(bx);
      const zr = blockRange(bz);
      const corner = Math.floor(random() * 4);
      const px = corner % 2 === 0 ? xr.min + 2 : xr.max - 2;
      const pz = corner < 2 ? zr.min + 2 : zr.max - 2;
      const roll = random();
      if (roll < 0.35) {
        benchSeats.push({ x: px, z: pz, w: 1.8, d: 0.6, h: 0.15, y: 0.55 });
        benchBacks.push({ x: px, z: pz - 0.3, w: 1.8, d: 0.12, h: 0.6, y: 0.9 });
      } else if (roll < 0.65) {
        planters.push({ x: px, z: pz, w: 1, d: 1, h: 0.8, y: 0.4 });
        shrubs.push({ x: px, z: pz, w: 1.4, d: 1.4, h: 1.1, y: 1.1 });
      } else if (roll < 0.8) {
        hydrants.push({ x: px, z: pz, w: 0.5, d: 0.5, h: 0.9, y: 0.45 });
      } else {
        signPoles.push({ x: px, z: pz, w: 0.24, d: 0.24, h: 3, y: 1.5 });
        signBoards.push({ x: px, z: pz, w: 1.2, d: 0.12, h: 0.8, y: 3.0, color: pick(random, ['#2a6a9a', '#3a7a4a', '#c94a3a']) });
      }
      // Batch 2, Phase C: a second prop per block (opposite corner, hash type)
      // + a trash bin on ~1/3 of blocks (adjacent corner) — no random() calls,
      // so the seeded stream is untouched and the two props never overlap.
      const corner2 = (corner + 2) % 4;
      const px2 = corner2 % 2 === 0 ? xr.min + 2 : xr.max - 2;
      const pz2 = corner2 < 2 ? zr.min + 2 : zr.max - 2;
      const roll2 = (bx * 13 + bz * 7) % 4;
      if (roll2 === 0) {
        benchSeats.push({ x: px2, z: pz2, w: 1.8, d: 0.6, h: 0.15, y: 0.55 });
        benchBacks.push({ x: px2, z: pz2 - 0.3, w: 1.8, d: 0.12, h: 0.6, y: 0.9 });
      } else if (roll2 === 1) {
        planters.push({ x: px2, z: pz2, w: 1, d: 1, h: 0.8, y: 0.4 });
        shrubs.push({ x: px2, z: pz2, w: 1.4, d: 1.4, h: 1.1, y: 1.1 });
      } else if (roll2 === 2) {
        hydrants.push({ x: px2, z: pz2, w: 0.5, d: 0.5, h: 0.9, y: 0.45 });
      } else {
        signPoles.push({ x: px2, z: pz2, w: 0.24, d: 0.24, h: 3, y: 1.5 });
        signBoards.push({ x: px2, z: pz2, w: 1.2, d: 0.12, h: 0.8, y: 3.0, color: ['#2a6a9a', '#3a7a4a', '#c94a3a'][(bx + bz) % 3] });
      }
      if ((bx * 7 + bz * 11) % 3 === 0) {
        const corner3 = (corner + 1) % 4;
        bins.push({
          x: corner3 % 2 === 0 ? xr.min + 2 : xr.max - 2,
          z: corner3 < 2 ? zr.min + 2 : zr.max - 2,
          w: 0.5, d: 0.5, h: 0.7, y: 0.35,
        });
      }
    }
  }
  // Batch 2, Phase C: bus stops (4, on the south sidewalk of the z = -6
  // avenue), bollards along the pier edges, and the second tree species —
  // broadleaf trees along the marina promenade (x = 341, skipping the pier
  // mouth). All fixed/hash-derived, no random() calls.
  for (const sx of [-150, -50, 50, 150]) {
    busStops.push({ x: sx - 1.2, z: -13.5, w: 0.15, d: 0.15, h: 2.5, y: 1.25, color: '#2a2f36' });
    busStops.push({ x: sx + 1.2, z: -13.5, w: 0.15, d: 0.15, h: 2.5, y: 1.25, color: '#2a2f36' });
    busStops.push({ x: sx, z: -13.5, w: 3.2, d: 1.6, h: 0.15, y: 2.55, color: '#3a6a9a' });
    busStops.push({ x: sx, z: -13.1, w: 1.8, d: 0.6, h: 0.15, y: 0.55, color: '#7a5a3a' });
    busStops.push({ x: sx, z: -12.8, w: 1.8, d: 0.12, h: 0.6, y: 0.9, color: '#7a5a3a' });
  }
  for (let i = 0; i < 10; i += 1) {
    const x = 340 + 9 * i;
    bollards.push({ x, z: -11, w: 0.4, d: 0.4, h: 0.55, y: 0.275 });
    bollards.push({ x, z: -1, w: 0.4, d: 0.4, h: 0.55, y: 0.275 });
  }
  {
    const blobShades = ['#3f7a3a', '#4a8a3a', '#35702f'];
    for (let t = 0; t < 28; t += 1) {
      const z = -190 + 14 * t;
      if (Math.abs(z + 6) < 8) continue;
      const x = 341 + ((t * 5) % 3 - 1) * 1.5;
      const trunkH = 3 + ((t * 7) % 3) * 0.5;
      broadleafTrunks.push({ x, z, w: 0.5, d: 0.5, h: trunkH, y: trunkH / 2 });
      for (let b = 0; b < 3; b += 1) {
        const r = 1.6 + ((t + b * 3) % 3) * 0.3;
        broadleafBlobs.push({
          x: x + ((t * 3 + b * 5) % 3 - 1) * 0.8,
          z: z + ((t * 7 + b * 2) % 3 - 1) * 0.8,
          w: r, d: r, h: r * 0.75,
          y: trunkH + 0.6 + b * 0.7,
          color: blobShades[(t + b) % 3],
        });
      }
    }
  }
  if (benchSeats.length > 0) {
    const benchMat = new THREE.MeshLambertMaterial({ color: '#7a5a3a' });
    instancedBoxes(benchSeats, benchMat, 0.55, 'bench-seats');
    instancedBoxes(benchBacks, benchMat, 0.9, 'bench-backs');
  }
  if (planters.length > 0) {
    instancedBoxes(planters, new THREE.MeshLambertMaterial({ color: '#8a6a4a' }), 0.4, 'planters');
  }
  if (shrubs.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 7, 5),
      new THREE.MeshLambertMaterial({ color: '#4a8a3a' }),
      shrubs.length,
    );
    mesh.name = 'shrubs';
    const m = new THREE.Matrix4();
    for (let i = 0; i < shrubs.length; i += 1) {
      const b = shrubs[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (hydrants.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      new THREE.MeshLambertMaterial({ color: '#c93a2a' }),
      hydrants.length,
    );
    mesh.name = 'hydrants';
    const m = new THREE.Matrix4();
    for (let i = 0; i < hydrants.length; i += 1) {
      const b = hydrants[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (signPoles.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
      new THREE.MeshLambertMaterial({ color: '#3a3f46' }),
      signPoles.length,
    );
    mesh.name = 'sign-poles';
    const m = new THREE.Matrix4();
    for (let i = 0; i < signPoles.length; i += 1) {
      const b = signPoles[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    group.add(mesh);
  }
  if (signBoards.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      signBoards.length,
    );
    mesh.name = 'sign-boards';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < signBoards.length; i += 1) {
      const b = signBoards[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(b.color));
    }
    group.add(mesh);
  }

  // Batch 2, Phase C: the road cross-section + street furniture meshes.
  // instancedBoxes() above takes one fixed height for the whole list; these
  // lists carry a per-instance centre height (b.y) and, for the lenses /
  // bus stops / tree blobs, a per-instance colour (b.color).
  function instancedBoxesY(list, mat, name) {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    mesh.name = name;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h ?? 0.12, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      if (b.color) mesh.setColorAt(i, color.set(b.color));
    }
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  function instancedPrim(list, geometry, mat, name) {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
    mesh.name = name;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      if (b.color) mesh.setColorAt(i, color.set(b.color));
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  instancedBoxes(curbs, new THREE.MeshLambertMaterial({ color: 0x9a9a96 }), 0.15, 'curbs');
  instancedBoxes(edgeLines, new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }), 0.12, 'edge-lines');
  instancedBoxes(stopLines, new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }), 0.12, 'stop-lines');
  instancedBoxesY(trafficStructs, new THREE.MeshLambertMaterial({ color: 0x2a2f36 }), 'traffic-structs');
  instancedBoxesY(trafficLenses, new THREE.MeshLambertMaterial({ color: 0xffffff }), 'traffic-lenses');
  instancedBoxesY(busStops, new THREE.MeshLambertMaterial({ color: 0xffffff }), 'bus-stops');
  instancedPrim(bins, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), new THREE.MeshLambertMaterial({ color: 0x3a3f45 }), 'bins');
  instancedPrim(bollards, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }), 'bollards');
  instancedPrim(broadleafTrunks, new THREE.CylinderGeometry(0.5, 0.5, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6a4a30 }), 'broadleaf-trunks');
  instancedPrim(broadleafBlobs, new THREE.SphereGeometry(1, 6, 5), new THREE.MeshLambertMaterial({ color: 0xffffff }), 'broadleaf-blobs');

  // Phase 3.6: rooftop landmarks — generic signs and food stacks, our own
  // shapes, no brand. HOTEL board on the tallest marina roof, SOLMARINA board
  // on the tallest downtown roof, a burger stack and a fries box on low-rise
  // roofs. Chosen deterministically (tallest / first low-rise match).
  {
    const tallestMarina = buildings.filter((b) => b.district === 'marina')
      .reduce((a, b) => ((a && a.h > b.h) ? a : b), null);
    const tallestDowntown = buildings.filter((b) => b.district === 'downtown')
      .reduce((a, b) => ((a && a.h > b.h) ? a : b), null);
    const lowMarina = buildings.find((b) => b.district === 'marina' && b.h < 18 && b.w > 14);
    const lowSuburb = buildings.find((b) => b.district === 'suburb' && b.h < 14 && b.w > 14);
    // Backing slab on two posts + front plane with the word painted on canvas.
    const signBoard = (b, text, bg, w, h) => {
      const baseY = b.h + 0.7;
      for (const dx of [-w / 2 + 0.5, w / 2 - 0.5]) {
        box(0.3, 1.2, 0.3, new THREE.MeshLambertMaterial({ color: '#3a3f46' }), b.x + dx, baseY + 0.6, b.z + b.d / 2 + 0.1);
      }
      const slab = box(w, h, 0.3, new THREE.MeshLambertMaterial({ color: '#22303f' }), b.x, baseY + 1.2 + h / 2, b.z + b.d / 2 + 0.1);
      slab.castShadow = true;
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 0.4, h - 0.4),
        new THREE.MeshLambertMaterial({ map: makeSignTexture(THREE, text, bg) }),
      );
      face.position.set(b.x, baseY + 1.2 + h / 2, b.z + b.d / 2 + 0.28);
      group.add(face);
    };
    if (tallestMarina) signBoard(tallestMarina, 'HOTEL', '#1a2a4a', 8, 2);
    if (tallestDowntown) signBoard(tallestDowntown, 'SOLMARINA', '#2a5a8a', 11, 2.4);
    // Burger stack: bottom bun, patty, lettuce, cheese, squashed-sphere top bun.
    if (lowMarina) {
      const by = lowMarina.h + 0.7;
      const bunMat = new THREE.MeshLambertMaterial({ color: '#e8b06a' });
      const pattyMat = new THREE.MeshLambertMaterial({ color: '#5a3a22' });
      const lettuceMat = new THREE.MeshLambertMaterial({ color: '#5a9a3a' });
      const cheeseMat = new THREE.MeshLambertMaterial({ color: '#f2a83a' });
      const stack = [
        [new THREE.CylinderGeometry(2.2, 2.2, 0.8, 12), bunMat, 0.4],
        [new THREE.CylinderGeometry(2.3, 2.3, 0.5, 12), pattyMat, 1.05],
        [new THREE.CylinderGeometry(2.5, 2.5, 0.25, 12), lettuceMat, 1.4],
        [new THREE.CylinderGeometry(2.4, 2.4, 0.2, 12), cheeseMat, 1.6],
      ];
      for (const [geo, mat, dy] of stack) {
        const part = new THREE.Mesh(geo, mat);
        part.position.set(lowMarina.x, by + dy, lowMarina.z);
        part.castShadow = true;
        group.add(part);
      }
      const topBun = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), bunMat);
      topBun.scale.set(1, 0.55, 1);
      topBun.position.set(lowMarina.x, by + 2.6, lowMarina.z);
      topBun.castShadow = true;
      group.add(topBun);
    }
    // Fries box: red carton + five yellow sticks.
    if (lowSuburb) {
      const fy = lowSuburb.h + 0.7;
      const carton = box(3.2, 2.4, 1.2, new THREE.MeshLambertMaterial({ color: '#d84a35' }), lowSuburb.x, fy + 1.2, lowSuburb.z);
      carton.castShadow = true;
      const fryMat = new THREE.MeshLambertMaterial({ color: '#f2c94c' });
      for (let i = 0; i < 5; i += 1) {
        const fry = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2 + (i % 2) * 0.5, 0.35), fryMat);
        fry.position.set(lowSuburb.x - 1.2 + i * 0.6, fy + 2.4 + 0.6, lowSuburb.z);
        fry.castShadow = true;
        group.add(fry);
      }
    }
  }

  // --- landmarks ----------------------------------------------------------------
  // Solmarina Tower: the city's spike, downtown north.
  {
    const tx = blockCentre(CITY.tower.bx);
    const tz = blockCentre(CITY.tower.bz);
    const tower = box(18, CITY.tower.height, 18, new THREE.MeshLambertMaterial({ color: '#4a8ac0' }), tx, CITY.tower.height / 2, tz);
    tower.castShadow = true;
    box(20, 2, 20, new THREE.MeshLambertMaterial({ color: PALETTE.roof }), tx, CITY.tower.height + 1, tz);
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 2.2, 16, 6),
      new THREE.MeshLambertMaterial({ color: '#3a3f46' }),
    );
    spire.position.set(tx, CITY.tower.height + 10, tz);
    group.add(spire);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshLambertMaterial({ color: '#ff5a3c', emissive: 0xff3c1e, emissiveIntensity: 1.2 }),
    );
    beacon.position.set(tx, CITY.tower.height + 18, tz);
    group.add(beacon);
    colliders.push({ minX: tx - 9.3, maxX: tx + 9.3, minZ: tz - 9.3, maxZ: tz + 9.3 });
  }
  // Stadium: a low ring south-west, with floodlights.
  {
    const sx = blockCentre(CITY.stadium.bx);
    const sz = blockCentre(CITY.stadium.bz);
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(CITY.stadium.radius, CITY.stadium.radius + 4, 18, 20),
      new THREE.MeshLambertMaterial({ color: '#d9e2ea' }),
    );
    bowl.position.set(sx, 9, sz);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    group.add(bowl);
    const field = new THREE.Mesh(
      new THREE.CylinderGeometry(CITY.stadium.radius - 8, CITY.stadium.radius - 8, 1, 20),
      new THREE.MeshLambertMaterial({ color: '#4a8a4a' }),
    );
    field.position.set(sx, 18.2, sz);
    group.add(field);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 26, 6),
        new THREE.MeshLambertMaterial({ color: PALETTE.lampPole }),
      );
      pole.position.set(sx + dx * 46, 13, sz + dz * 46);
      group.add(pole);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(6, 2, 1),
        new THREE.MeshLambertMaterial({ color: PALETTE.lampGlow, emissive: 0xffc861, emissiveIntensity: 0.9 }),
      );
      lamp.position.set(sx + dx * 46, 26, sz + dz * 46);
      group.add(lamp);
    }
    colliders.push({
      minX: sx - CITY.stadium.radius - 4, maxX: sx + CITY.stadium.radius + 4,
      minZ: sz - CITY.stadium.radius - 4, maxZ: sz + CITY.stadium.radius + 4,
    });
  }
  // The bridge: one deck spanning the channel along the east-west road at z -6,
  // overlapping both banks so the road reads as continuous, with railings on both
  // edges. The water north of the deck (z 0..10) still blocks cars and feet.
  {
    const b = CITY.bridge;
    const deckLength = b.x1 - b.x0;
    const deckX = (b.x0 + b.x1) / 2;
    const deck = box(deckLength, 0.5, b.width, deckMat, deckX, 0.28, b.z);
    deck.receiveShadow = true;
    const railMat = new THREE.MeshLambertMaterial({ color: '#e8e2d2' });
    box(deckLength, 1.1, 0.5, railMat, deckX, 0.9, b.z - b.width / 2);
    box(deckLength, 1.1, 0.5, railMat, deckX, 0.9, b.z + b.width / 2);
    const c = CITY.channel;
    colliders.push({ minX: c.x0, maxX: c.x1, minZ: b.z + b.width / 2, maxZ: c.z1 });
  }
  // Pier: wooden deck east into the sea, with a lighthouse at its end.
  {
    for (let x = CITY.pier.x0 + 4; x < CITY.pier.x1; x += 8) {
      box(8, 0.6, CITY.pier.width, woodMat, x, 1.0, CITY.pier.z);
    }
    const light = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3, 16, 10),
      new THREE.MeshLambertMaterial({ color: '#f2ede2' }),
    );
    light.position.set(424, 9, CITY.pier.z);
    light.castShadow = true;
    group.add(light);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(2.35, 2.35, 3, 10),
      new THREE.MeshLambertMaterial({ color: '#d84a35' }),
    );
    band.position.set(424, 12, CITY.pier.z);
    group.add(band);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 8, 6),
      new THREE.MeshLambertMaterial({ color: '#ffe9a8', emissive: 0xffd27a, emissiveIntensity: 1.4 }),
    );
    lamp.position.set(424, 18, CITY.pier.z);
    group.add(lamp);
    colliders.push({ minX: CITY.pier.x0, maxX: CITY.pier.x1, minZ: CITY.pier.z - 7, maxZ: CITY.pier.z + 7 });
  }

  // Driving route for the autopilot: a rectangle loop along the roads, starting on
  // the spawn road (z -6) so the car joins it heading the right way. Every leg is a
  // road centre line; the corners are open intersections, so the car can swing wide.
  const route = [
    { x: -58, z: -6 }, { x: 150, z: -6 }, { x: 150, z: 150 },
    { x: -58, z: 150 }, { x: -58, z: -6 },
  ];

  return {
    group,
    colliders,
    route,
    // Spawn: on the east-west road at z -6, car facing east toward downtown and the bridge.
    spawn: { car: { x: -58, z: -6, heading: Math.PI / 2 }, player: { x: -58, z: -1 } },
    buildingCount: buildings.length,
    palmCount: palms.length,
    // Flat 2D summary for the minimap (Phase 2): footprints, not meshes.
    map: {
      roads: lines,
      buildings: buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
      channel: { ...CITY.channel },
      bridge: { ...CITY.bridge },
      tower: { x: blockCentre(CITY.tower.bx), z: blockCentre(CITY.tower.bz) },
      stadium: {
        x: blockCentre(CITY.stadium.bx),
        z: blockCentre(CITY.stadium.bz),
        r: CITY.stadium.radius,
      },
      pier: { ...CITY.pier },
      seaX: CITY.seaX,
      route,
    },
  };
}
