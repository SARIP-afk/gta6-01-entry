// Every tuning number, name and colour in one place. Solmarina is a sun-soaked coastal
// city: golden-hour light, warm walls, a marina and a pier on the east sea edge.
// The city is a 12x12 block grid (52 m pitch) centred on the origin; roads are the gaps.
// All randomness comes from the seeded generator, so the same seed builds the same city.

export const GAME = {
  title: 'Solmarina',
  city: 'Solmarina',
  hero: 'Rio',
  tagline: 'A courier. A debt. A city that never slows down.',
};

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Default seed when the URL gives none; ?seed=N fixes the city and the staged shots. */
export const DEFAULT_SEED = 1;

export const CITY = {
  blocks: 12,
  block: 40,
  road: 12,
  pitch: 52,
  half: 312,
  sidewalk: 3,
  // East of this x the land ends: promenade, then the sea.
  seaX: 336,
  // The marina channel: water cut east-west along z in [-10, 10], from x 200 to the sea.
  channel: { x0: 200, x1: 336, z0: -10, z1: 10 },
  // The one bridge over the channel: a deck spanning it along the east-west road at
  // z -6 (the road the car spawns on, facing east toward the bridge). It overlaps both
  // banks by 2 m so the road reads as continuous; the water north of the deck still
  // blocks cars and feet. (Phase 1 fix: the first build put two short slabs across
  // the channel that touched neither bank, so the car could never cross.)
  bridge: { x0: 198, x1: 338, z: -6, width: 12 },
  // Landmarks, by block centre.
  tower: { bx: 5, bz: 1, height: 112 },
  stadium: { bx: 2, bz: 9, radius: 42 },
  pier: { x0: 336, x1: 430, z: -6, width: 12 },
};

/** Districts, by block column/row: downtown towers north-centre, marina east, suburbs elsewhere. */
export function districtOf(bx, bz) {
  if (bx >= 4 && bx <= 7 && bz <= 3) return 'downtown';
  if (bx >= 8) return 'marina';
  return 'suburb';
}

export const CAR = {
  length: 4.4,
  width: 1.9,
  wheelbase: 2.8,
  accel: 16,
  brake: 30,
  reverseAccel: 10,
  maxSpeed: 34,
  maxReverse: 10,
  drag: 0.35,
  steerMax: 0.55,
  // Cap on the yaw rate (rad/s) at speed: full lock at low speed, but the wheel
  // angle shrinks as speed grows so the car never spins at 30+ m/s. (Phase 1 fix:
  // the old linear falloff still let the car yaw ~2.8 rad/s at 31 m/s.)
  steerYawCap: 1.4,
  handbrakeDecel: 22,
  // Colour of the player's car: coral red, so it reads in a screenshot.
  color: 0xe8543f,
  cabinColor: 0x2a3140,
  wheelColor: 0x14161a,
};

export const PLAYER = {
  radius: 0.55,
  height: 1.8,
  walkSpeed: 5,
  runSpeed: 9,
  accel: 40,
  color: 0xf2c94c,
  shirtColor: 0x2f6fb2,
  pantsColor: 0x33302a,
};

export const CAMERA = {
  driveDistance: 11,
  driveHeight: 4.6,
  footDistance: 7,
  footHeight: 3.4,
  fovBase: 60,
  fovSpeed: 15,
  smoothing: 5,
};

export const PALETTE = {
  skyTop: '#6ea8dd',
  skyHorizon: '#ffd9a0',
  fog: '#f2c98a',
  sun: '#ffb46b',
  groundSand: '#d9b380',
  asphalt: '#3d3a38',
  sidewalk: '#cfc3ab',
  crosswalk: '#f5efe0',
  laneDash: '#f2c94c',
  sea: '#2e7fa8',
  seaDeep: '#1f5f86',
  pierWood: '#8a6a4a',
  buildingDowntown: ['#e8dcc8', '#d9c9a8', '#c9b18c', '#e0cfae', '#b8a88e'],
  buildingMarina: ['#f2e6d0', '#e8cfae', '#d9b380', '#f0d9b8', '#e3c39a'],
  buildingSuburb: ['#f5ead6', '#e8d5b0', '#d9c39a', '#efe0c0', '#e0cba6'],
  roof: '#8a6a4a',
  window: '#2a3547',
  palmTrunk: '#7a5a3a',
  palmLeaf: '#3f7a3a',
  lampPole: '#3a3f46',
  lampGlow: '#ffd27a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best drive is kept between visits (this browser only). */
export const BEST_KEY = 'solmarina.best';
