// Solmarina — the city plan, rebuilt from one seed.
// Data only: no rendering code lives here, so the simulation and the
// renderer both read the same plan and the simulation trace never
// depends on anything visual. Roads run every 48 m; the beach closes
// the south edge, the marina and pier close the east edge, and the Old
// Pasaru night-market plaza sits on the block at (-72, -96).
import { mulberry32, hash2, pick, range, clamp } from './util.js';

export const STEP = 1 / 60;
export const ROAD_STEP = 48;
export const GRID_MIN = -288;
export const GRID_MAX = 288;
export const ROAD_HALF = 6;
export const WORLD = { x0: -336, z0: -336, x1: 432, z1: 336 };
export const BEACH_Z = 240;          // sand starts here, sea past z = 312
export const SEA_Z = 312;
export const PIER = { x: 384, z: 24 };
export const CAUSEWAY_Z = 24;        // east road out to the pier
export const SPAWN = { x: -72, z: 0, heading: 0 };
export const SAFEHOUSE = { x: -72, z: 48, radius: 24 };
export const MARKET = { x: -72, z: -96 };       // night-market plaza block
export const STADIUM = { x: -192, z: 144 };
export const MARINA_DROP = { x: 240, z: 120 };
export const DOWNTOWN_PICKUP = { x: -72, z: -144 };
export const PIER_END = { x: 384, z: 24 };

export const DISTRICTS = [
  { name: 'DOWNTOWN', tag: 'Glass towers and the night market', color: '#f2c94c', x0: -144, z0: -240, x1: 48, z1: -48 },
  { name: 'OLD HARBOR', tag: 'Warehouses and fish stalls', color: '#e07a5f', x0: -288, z0: -240, x1: -144, z1: -48 },
  { name: 'NORTHGATE', tag: 'The high road out of town', color: '#8ecae6', x0: -288, z0: -288, x1: 288, z1: -240 },
  { name: 'STADIUM ROW', tag: 'Floodlights and cheap seats', color: '#f28482', x0: -288, z0: 48, x1: -96, z1: 192 },
  { name: 'PALM BEACH', tag: 'Sand, surf and the long pier', color: '#90be6d', x0: -288, z0: 192, x1: 288, z1: 312 },
  { name: 'FOUNDRY', tag: 'Garages, yards and scrap', color: '#b08968', x0: 48, z0: -48, x1: 288, z1: 192 },
  { name: 'MARINA', tag: 'Boats, money and the causeway', color: '#4fc3f7', x0: 288, z0: -96, x1: 432, z1: 144 },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d;
  return DISTRICTS[0];
}

export function roadLines() {
  const lines = [];
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) lines.push(v);
  return lines;
}
export function nearestRoad(v) {
  let best = GRID_MIN, bd = Infinity;
  for (let r = GRID_MIN; r <= GRID_MAX; r += ROAD_STEP) {
    const d = Math.abs(v - r);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
export function onRoad(x, z) {
  const nearX = Math.abs(x - nearestRoad(x)) < ROAD_HALF + 1.5;
  const nearZ = Math.abs(z - nearestRoad(z)) < ROAD_HALF + 1.5;
  if (Math.abs(z - CAUSEWAY_Z) < ROAD_HALF + 1.5 && x > GRID_MAX && x < PIER.x) return true;
  return nearX || nearZ;
}

// Pastel facades: the brown/grey slabs are gone — same random draws as
// before, only the colour values changed, so building positions,
// heights and the sim trace are untouched.
const PASTEL_FACES = ['#f2c94c', '#f28482', '#81b29a', '#f4a261', '#a78bfa', '#a8dadc'];
const FACADE_SET = {
  tower: [...PASTEL_FACES, '#8ecae6', '#f6bd60'],
  low: [...PASTEL_FACES],
  roof: ['#4a4e69', '#3d405b', '#6c757d', '#495057'],
};

/** Every static placement for a seed, as plain data objects. */
export function buildLayout(seed = 1) {
  const draw = mulberry32(seed * 7919 + 13);
  const buildings = [];
  const lamps = [];
  const palms = [];
  const umbrellas = [];
  const stalls = [];
  const props = []; // {kind:'bin'|'bench'|'planter'|'cone', x, z, ry}
  const shells = [];
  const parked = []; // {x, z, ry, color} — static cars on the road edges
  const signs = []; // {x, z, ry} — green street-name signs at intersections

  // --- buildings: one block is the square between four roads ---
  for (let gx = GRID_MIN; gx < GRID_MAX; gx += ROAD_STEP) {
    for (let gz = GRID_MIN; gz < GRID_MAX; gz += ROAD_STEP) {
      const midX = gx + ROAD_STEP / 2, midZ = gz + ROAD_STEP / 2;
      if (midZ >= BEACH_Z) continue;                    // beach, no buildings
      if (Math.abs(midX - MARKET.x) < 30 && Math.abs(midZ - MARKET.z) < 30) continue; // market plaza
      if (Math.abs(midX - STADIUM.x) < 40 && Math.abs(midZ - STADIUM.z) < 40) continue; // stadium bowl
      if (midX > 288) continue;
      const slotRoll = hash2(gx, gz, 7);
      const towerCount = slotRoll < 0.25 ? 1 : slotRoll < 0.7 ? 2 : 3;
      for (let slot = 0; slot < towerCount; slot++) {
        const offX = (slot % 2 === 0 ? -10 : 10) + range(draw, -3, 3);
        const offZ = (slot < 2 ? (towerCount === 1 ? 0 : -10) : 10) + range(draw, -3, 3);
        const wide = range(draw, 16, 24), deep = range(draw, 16, 24);
        const downtown = Math.abs(midX) < 150 && Math.abs(midZ + 120) < 130;
        const rise = downtown ? range(draw, 28, 68) : range(draw, 10, 30);
        const face = downtown ? pick(draw, FACADE_SET.tower) : pick(draw, FACADE_SET.low);
        // Faces stay 8 m from the road line (road half-width 6 + 2 m of
        // sidewalk): unclamped, a face could sit 0.5 m from the
        // centreline, scraping the car on the road and putting the
        // follow camera against a wall. The block interior is 32 m
        // wide and w/d <= 24 m, so the shift always fits; the random
        // stream is untouched (pure arithmetic).
        const fixX = clamp(midX + offX, gx + 8 + wide / 2, gx + ROAD_STEP - 8 - wide / 2);
        const fixZ = clamp(midZ + offZ, gz + 8 + deep / 2, gz + ROAD_STEP - 8 - deep / 2);
        buildings.push({
          x: fixX, z: fixZ, w: wide, d: deep, h: rise, color: face,
          roof: pick(draw, FACADE_SET.roof),
          floors: Math.max(2, Math.floor(rise / 3.4)),
          sign: hash2(gx, gz, 11 + slot) < 0.4,
          signColor: pick(draw, ['#f2c94c', '#e07a5f', '#4fc3f7', '#90be6d', '#f28482']),
        });
      }
    }
  }

  // --- street lamps along every road, both sides, staggered ---
  for (const v of roadLines()) {
    for (let u = GRID_MIN; u <= GRID_MAX; u += ROAD_STEP) {
      if (hash2(u, v, 21) < 0.55) lamps.push({ x: u + 8, z: v + 8.5, ry: 0 });
      if (hash2(u, v, 22) < 0.55) lamps.push({ x: u - 8, z: v - 8.5, ry: Math.PI });
    }
  }

  // --- palms: beach rows + boulevard lines (dense — the coast road is
  // lined with them, not dotted) ---
  for (let x = -280; x <= 280; x += 12) {
    if (hash2(x, 1, 31) < 0.85) palms.push({ x: x + range(draw, -3, 3), z: 252 + range(draw, -2, 6), s: range(draw, 0.85, 1.25) });
    if (hash2(x, 2, 32) < 0.65) palms.push({ x: x + range(draw, -3, 3), z: 228 + range(draw, -2, 3), s: range(draw, 0.8, 1.15) });
  }
  for (let z = -240; z <= 180; z += 24) {
    if (hash2(3, z, 33) < 0.4) palms.push({ x: 296, z: z + range(draw, -3, 3), s: range(draw, 0.85, 1.2) });
  }

  // --- beach umbrellas + towels, fixed spots along the sand (two rows —
  // the beach is inhabited, not one dotted line) ---
  const UMBRELLA_COLORS = ['#e07a5f', '#4fc3f7', '#f2c94c', '#f28482', '#90be6d'];
  for (let x = -264; x <= 264; x += 24) {
    if (hash2(x, 4, 41) < 0.7) {
      umbrellas.push({
        x: x + range(draw, -4, 4), z: 262 + range(draw, -4, 10),
        color: pick(draw, UMBRELLA_COLORS),
        ry: range(draw, 0, Math.PI * 2),
      });
    }
    if (hash2(x, 6, 43) < 0.45) {
      umbrellas.push({
        x: x + 6 + range(draw, -4, 4), z: 298 + range(draw, -3, 3),
        color: pick(draw, UMBRELLA_COLORS),
        ry: range(draw, 0, Math.PI * 2),
      });
    }
  }

  // Beach dressing on the southern sand, placed by hand so the
  // beach-hero frame (and the beach shot) shows umbrellas in the
  // foreground instead of bare sand. Every entry is a literal — the
  // random stream is never touched, so buildings and the sim trace
  // stay exactly where they were. The first two sit west of the pier
  // in the hero's view cone; the rest fill the foreground strip,
  // each x kept off multiples of 12 so no umbrella lands on a palm.
  const southUmbrellas = [
    { x: -16, z: 309, color: '#e07a5f', ry: 0.6 },
    { x: -26, z: 306, color: '#4fc3f7', ry: 2.1 },
    { x: 2, z: 310, color: '#f2c94c', ry: 0.8 },
    { x: -20, z: 310, color: '#e07a5f', ry: 2.0 },
    { x: -44, z: 310, color: '#4fc3f7', ry: 1.2 },
    { x: -70, z: 309, color: '#f28482', ry: 0.4 },
    { x: -94, z: 311, color: '#90be6d', ry: 2.6 },
    { x: 30, z: 308, color: '#e07a5f', ry: 1.0 },
    { x: -56, z: 311, color: '#f2c94c', ry: 1.8 },
  ];
  for (const u of southUmbrellas) umbrellas.push(u);

  // A hand-placed palm row along the same southern strip (z around
  // 307-310, clear of the pier and of the beach road), so the beach
  // reads palm-lined from the hero camera. Jitter and scale come from
  // hash2 — a pure function, no random draws. Two gaps are kept open:
  // the pier mouth, and the strip right in front of the beach-hero
  // camera, where a trunk 7 m from the lens once filled a third of
  // the frame.
  for (let x = -120; x <= 120; x += 12) {
    if (Math.abs(x + 6) < 12) continue;
    if (x >= 4 && x <= 22) continue;
    palms.push({ x, z: 307 + hash2(x, 6, 31) * 3, s: 0.9 + hash2(x, 5, 31) * 0.35 });
  }

  // --- parked cars: mid-block, 7 m off the road centreline — just past
  // the asphalt edge (6 m) and clear of building faces (>= 8 m), lamps
  // (8.5 m) and ped sidewalks (9 m+). Spots sit 24 m mod 48, lamps sit
  // 8 m mod 48, so a parked car is never next to a lamp pole. Skipped
  // inside the market plaza and the stadium bowl (pedestrian areas).
  const insidePlaza = (x, z) => Math.abs(x - MARKET.x) < 26 && Math.abs(z - MARKET.z) < 26;
  const insideStadium = (x, z) => Math.abs(x - STADIUM.x) < 40 && Math.abs(z - STADIUM.z) < 40;
  const parkColors = ['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#2c3e50', '#e67e22', '#16a085', '#8e44ad', '#7f8c8d'];
  for (const v of roadLines()) {
    for (let u = GRID_MIN + 24; u <= GRID_MAX; u += ROAD_STEP) {
      if (hash2(u, v, 91) < 0.38) {
        const side = hash2(u, v, 92) < 0.5 ? 1 : -1;
        const px = u, pz = v + side * 7.0;
        if (!insidePlaza(px, pz) && !insideStadium(px, pz)) {
          parked.push({ x: px, z: pz, ry: side > 0 ? Math.PI : 0, color: pick(draw, parkColors) });
        }
      }
      if (hash2(v, u, 95) < 0.38) {
        const side = hash2(v, u, 96) < 0.5 ? 1 : -1;
        const px = v + side * 7.0, pz = u;
        if (!insidePlaza(px, pz) && !insideStadium(px, pz)) {
          parked.push({ x: px, z: pz, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2, color: pick(draw, parkColors) });
        }
      }
    }
  }

  // --- street-name signs: green boards on the (+,-) intersection corner,
  // the two corners lamps never use (lamps sit on (+,+) and (-,-)) ---
  for (let a = GRID_MIN; a <= GRID_MAX; a += ROAD_STEP) {
    for (let b = GRID_MIN; b <= GRID_MAX; b += ROAD_STEP) {
      if (hash2(a, b, 93) < 0.25) signs.push({ x: a + 7.5, z: b - 7.5, ry: hash2(a, b, 94) < 0.5 ? 0 : Math.PI / 2 });
    }
  }

  // --- night-market stalls: two rows of six in the plaza ---
  const stallColors = ['#e07a5f', '#f2c94c', '#4fc3f7', '#90be6d', '#f28482', '#e9c46a'];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 6; i++) {
      const x = MARKET.x - 30 + i * 12;
      const z = MARKET.z + (row === 0 ? -10 : 10);
      stalls.push({
        x, z, ry: row === 0 ? 0 : Math.PI,
        color: stallColors[(i + row * 2) % stallColors.length],
        goods: [pick(draw, ['#ff595e', '#ffca3a', '#8ac926', '#1982c4']), pick(draw, ['#ff924c', '#6a4c93', '#ffca3a', '#43aa8b'])],
      });
    }
  }

  // --- street props at fixed junctions (literals, no random draws) ---
  const propSpots = [
    { kind: 'bench', x: -64, z: 8, ry: 0 }, { kind: 'bench', x: -56, z: 8, ry: 0 },
    { kind: 'bin', x: -48, z: 8, ry: 0 }, { kind: 'planter', x: -80, z: 8, ry: 0 },
    { kind: 'bench', x: 8, z: -56, ry: Math.PI / 2 }, { kind: 'bin', x: 8, z: -48, ry: 0 },
    { kind: 'planter', x: 8, z: -64, ry: 0 },
    { kind: 'bench', x: -136, z: -88, ry: 0 }, { kind: 'bin', x: -128, z: -88, ry: 0 },
    { kind: 'cone', x: 40, z: -6, ry: 0 }, { kind: 'cone', x: 44, z: -6, ry: 0 },
    { kind: 'cone', x: 40, z: 6, ry: 0 },
    { kind: 'bench', x: 200, z: 16, ry: Math.PI }, { kind: 'bin', x: 208, z: 16, ry: 0 },
    { kind: 'planter', x: 216, z: 16, ry: 0 },
    { kind: 'bench', x: -200, z: 136, ry: 0 }, { kind: 'bin', x: -192, z: 136, ry: 0 },
    { kind: 'bench', x: 120, z: 232, ry: Math.PI }, { kind: 'bin', x: 128, z: 232, ry: 0 },
    { kind: 'planter', x: -72, z: -120, ry: 0 }, { kind: 'planter', x: -72, z: -72, ry: 0 },
    { kind: 'bench', x: -40, z: -96, ry: Math.PI / 2 },
  ];
  for (const spot of propSpots) props.push({ kind: spot.kind, x: spot.x, z: spot.z, ry: spot.ry });

  // Sand dressing for the beach-hero foreground: towels, rocks and
  // shells scattered on the southern strip so the sand is not one
  // empty brown slab. Same literal-only rule as the umbrellas above
  // — nothing here draws from the random stream.
  const sandDressing = [
    { kind: 'towel', x: 10, z: 309, ry: 0.4 }, { kind: 'towel', x: 20, z: 308, ry: 1.2 },
    { kind: 'towel', x: -8, z: 308, ry: 2.4 }, { kind: 'towel', x: -28, z: 311, ry: 0.9 },
    { kind: 'towel', x: 14, z: 311, ry: 1.6 },
    { kind: 'rock', x: -2, z: 307, ry: 0 }, { kind: 'rock', x: 16, z: 311, ry: 0 },
    { kind: 'rock', x: -44, z: 308, ry: 0 },
    { kind: 'shell', x: 6, z: 311, ry: 0 }, { kind: 'shell', x: -12, z: 309, ry: 0 },
    { kind: 'shell', x: 26, z: 310, ry: 0 }, { kind: 'shell', x: -58, z: 309, ry: 0 },
    { kind: 'shell', x: 18, z: 310, ry: 0 },
    // extra shells and pebbles so the foreground sand has small
    // things to catch the eye at thumbnail size
    { kind: 'shell', x: -34, z: 309, ry: 0 }, { kind: 'shell', x: 22, z: 309, ry: 0 },
    { kind: 'shell', x: -52, z: 311, ry: 0 }, { kind: 'shell', x: 34, z: 310, ry: 0 },
    { kind: 'rock', x: 24, z: 309, ry: 0 }, { kind: 'rock', x: -36, z: 310, ry: 0 },
    { kind: 'rock', x: -64, z: 308, ry: 0 },
  ];
  for (const spot of sandDressing) props.push({ kind: spot.kind, x: spot.x, z: spot.z, ry: spot.ry });

  // --- golden shells (collectibles) ---
  const shellSpots = [
    [-260, 270], [-180, 258], [-96, 276], [-20, 262], [60, 272], [140, 258], [220, 274], [272, 262],
    [-240, -240], [-120, 200], [40, -200], [160, 40], [240, 180], [300, 24], [384, 24], [-72, -96],
    [-192, 144], [264, 120], [-280, 40], [80, 120],
  ];
  for (const [x, z] of shellSpots) shells.push({ x, z, taken: false });

  return { buildings, lamps, palms, umbrellas, stalls, props, shells, parked, signs };
}
