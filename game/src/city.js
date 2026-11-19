// Solmarina's city, generated from one seed and nothing else: the same seed always
// builds the same streets, the same towers, the same signs. This module knows no
// THREE and no DOM — it only returns plain data the renderer and the sim both read.
import { CITY, DISTRICTS, PALETTE, SHELLS } from './config.js';

const ROADS = [];
for (let v = CITY.gridMin; v <= CITY.gridMax; v += CITY.roadStep) ROADS.push(v);

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function roadCoord(random) {
  return ROADS[Math.floor(random() * ROADS.length)];
}

/** The district a point stands in; first match wins, so edges belong to the earlier row. */
export function districtAt(x, z) {
  for (let i = 0; i < DISTRICTS.length; i += 1) {
    const d = DISTRICTS[i];
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return i;
  }
  return 0;
}

/** Distance from a point to the nearest road centre line (grid roads + causeway). */
export function distToRoad(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    best = Math.min(best, Math.abs(x - r), Math.abs(z - r));
  }
  // The causeway is the z=-6 road east of the grid.
  if (x > CITY.gridMax && x < CITY.pier.x + 20) best = Math.min(best, Math.abs(z - -6));
  return best;
}

/** Snap a point onto the nearest road centre line. */
export function snapToRoad(x, z) {
  let bx = x;
  let bz = z;
  let bd = Infinity;
  for (const r of ROADS) {
    if (Math.abs(x - r) < bd) { bd = Math.abs(x - r); bx = r; bz = z; }
    if (Math.abs(z - r) < bd) { bd = Math.abs(z - r); bx = x; bz = r; }
  }
  if (x > CITY.gridMax && Math.abs(z - -6) < bd) { bx = x; bz = -6; }
  return { x: bx, z: bz };
}

/** A point on a road, chosen at random — where cars and walkers start. */
export function randomRoadPoint(random) {
  if (random() < 0.12) {
    return { x: CITY.gridMax + random() * 80, z: -6 };
  }
  if (random() < 0.5) return { x: roadCoord(random), z: CITY.gridMin + random() * (CITY.gridMax - CITY.gridMin) };
  return { x: CITY.gridMin + random() * (CITY.gridMax - CITY.gridMin), z: roadCoord(random) };
}

export function buildCity(random) {
  const buildings = [];
  const palms = [];
  const lamps = [];
  const signs = [];
  const shells = [];

  // One block per grid cell: 1–3 towers, kept off the roads by a 9 m margin.
  for (let gx = CITY.gridMin; gx < CITY.gridMax; gx += CITY.roadStep) {
    for (let gz = CITY.gridMin; gz < CITY.gridMax; gz += CITY.roadStep) {
      const count = 1 + Math.floor(random() * 3);
      for (let n = 0; n < count; n += 1) {
        const w = 14 + random() * 18;
        const d = 14 + random() * 18;
        const x = gx + 9 + w / 2 + random() * Math.max(1, CITY.roadStep - 18 - w);
        const z = gz + 9 + d / 2 + random() * Math.max(1, CITY.roadStep - 18 - d);
        const h = 8 + random() * random() * 52;
        buildings.push({
          x, z, w, d, h,
          color: pick(random, PALETTE.building),
          roof: random() < 0.3,
          lit: random() < 0.7,
        });
      }
      // Palms line the south edge of most blocks; lamps stand on the corners.
      if (random() < 0.55) {
        palms.push({ x: gx + 6 + random() * 4, z: gz + CITY.roadStep - 8, lean: (random() - 0.5) * 0.3, h: 5 + random() * 2 });
      }
      if (random() < 0.8) lamps.push({ x: gx + 7, z: gz + 7 });
    }
  }

  // Landmark signs: big readable names at the places missions go, plus the skyline.
  const signDefs = [
    { x: -58, z: -176, text: 'DOWNTOWN', sub: 'NIGHT MARKET' },
    { x: -162, z: 132, text: 'SOLMARINA STADIUM', sub: 'HOME OF THE WAVES' },
    { x: 254, z: 82, text: 'MARINA', sub: 'BOATS · MONEY' },
    { x: 380, z: -24, text: 'THE PIER', sub: 'END OF THE ROAD' },
    { x: -280, z: -280, text: 'OLD HARBOR', sub: 'FISH · SALT · RUST' },
    { x: 120, z: 280, text: 'PALM BEACH', sub: 'SURF · SUNSET' },
    { x: 0, z: -300, text: 'SOLMARINA', sub: 'A CITY THAT NEVER SLOWS DOWN' },
  ];
  for (const s of signDefs) signs.push(s);

  // Golden shells: 20, tucked against building corners and the beach strip.
  for (let i = 0; i < SHELLS; i += 1) {
    if (i < 6) {
      shells.push({ x: -280 + random() * 560, z: 250 + random() * 50, taken: false });
    } else {
      const b = buildings[Math.floor(random() * buildings.length)];
      shells.push({ x: b.x + (random() < 0.5 ? -1 : 1) * (b.w / 2 + 2), z: b.z + (b.d / 2 + 2) * (random() < 0.5 ? -1 : 1), taken: false });
    }
  }

  return {
    roads: ROADS.slice(),
    buildings, palms, lamps, signs, shells,
    spawn: { ...CITY.spawn },
    pier: { ...CITY.pier },
    safehouse: { ...CITY.safehouse },
  };
}
