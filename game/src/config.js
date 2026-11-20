// Solmarina — every tuning number in one place. The city is a road grid: roads run
// every 52 m from -312 to 312 on both axes, the marina causeway runs east from x=312
// to the pier at (400, -6), and the beach strip closes the south edge. All numbers
// here are sim constants: the renderer only reads them, it never re-tunes them.

export const STEP = 1 / 60;

/** The fixed sim step, and the two trace lengths the determinism check hashes. */
export const TRACE = { sampleEvery: 60, steps: 1800 };

export const CITY = {
  roadStep: 52,
  gridMin: -312,
  gridMax: 312,
  roadHalf: 6,
  pier: { x: 400, z: -6 },
  spawn: { x: -58, z: -6, heading: 0 },
  safehouse: { x: -58, z: 30, radius: 26 },
  // Landmark blocks the missions and the cover stage around.
  stadium: { x: -162, z: 150 },
  marinaDrop: { x: 254, z: 98 },
  downtownPickup: { x: -58, z: -162 },
};

export const DISTRICTS = [
  { name: 'DOWNTOWN', tag: 'Glass towers and the night market', color: '#f2c94c', x0: -156, z0: -260, x1: 52, z1: -52 },
  { name: 'OLD HARBOR', tag: 'Warehouses and fish stalls', color: '#e07a5f', x0: -312, z0: -260, x1: -156, z1: -52 },
  { name: 'NORTHGATE', tag: 'The high road out of town', color: '#8ecae6', x0: -312, z0: -312, x1: 312, z1: -260 },
  { name: 'PALM BEACH', tag: 'Sand, surf and the long pier', color: '#90be6d', x0: -312, z0: 208, x1: 312, z1: 312 },
  { name: 'STADIUM ROW', tag: 'Floodlights and cheap seats', color: '#f28482', x0: -312, z0: 52, x1: -104, z1: 208 },
  { name: 'FOUNDRY', tag: 'Garages, yards and scrap', color: '#b08968', x0: 52, z0: -52, x1: 312, z1: 208 },
  { name: 'MARINA', tag: 'Boats, money and the causeway', color: '#4fc3f7', x0: 208, z0: -104, x1: 420, z1: 104 },
];

export const PLAYER = {
  walkSpeed: 6.2,
  runSpeed: 9.0,
  turnRate: 9.0,
  radius: 0.9,
  health: 100,
  regenDelay: 5,
  regenRate: 6,
};

export const CAR = {
  accel: 15,
  brake: 30,
  reverseMax: 9,
  topSpeed: 34,
  boostTop: 42,
  steerRate: 1.9,
  grip: 0.94,
  radius: 2.1,
  length: 4.4,
  width: 1.9,
  damagePerHit: 7,
};

export const TRAFFIC = {
  cars: 30,
  peds: 50,
  carSpeedMin: 7,
  carSpeedMax: 13,
  pedSpeedMin: 1.1,
  pedSpeedMax: 1.9,
  spawnMin: 55,
  spawnMax: 190,
  despawn: 230,
};

export const ENEMY = { health: 100, shootInterval: 1.3, damage: 8, range: 55, reward: 150 };

// Blood on a hit: no numbers, no bars — red particles burst from the wound and a
// splatter stays on the ground, fading out. All of it is seeded, so a replay
// shows the same burst.
export const BLOOD = {
  particles: 22, // per hit; a kill bursts twice that
  life: 1.2, // seconds a particle flies / sticks
  decalLife: 4.5, // seconds a ground splatter stays
  gravity: 12,
  maxParticles: 160,
  maxDecals: 8,
};

export const WANTED_TIERS = [
  { stars: 0, label: 'CLEAR', cruisers: 0, loseTime: 0, searchTime: 0 },
  { stars: 1, label: 'PATROL ON ALERT', cruisers: 1, loseTime: 6, searchTime: 10 },
  { stars: 2, label: 'UNITS RESPONDING', cruisers: 2, loseTime: 7, searchTime: 11 },
  { stars: 3, label: 'CORDON ACTIVE', cruisers: 3, loseTime: 8, searchTime: 12 },
  { stars: 4, label: 'AIR SUPPORT', cruisers: 3, loseTime: 9, searchTime: 13 },
  { stars: 5, label: 'MAXIMUM FORCE', cruisers: 4, loseTime: 10, searchTime: 14 },
];
export const WANTED_MAX = 5;
export const WANTED_DECAY_SECONDS = 15;
export const BUST_CASH_LOSS = 0.25;

export const MISSIONS = [
  {
    id: 'M1', name: 'FIRST DROP', reward: 500, par: 150, xp: 500,
    brief: 'DANTE: "One package. Pier. Don\'t keep me waiting."',
    stages: [
      { name: 'PICK UP THE PACKAGE', text: 'Pick up the package downtown', x: -58, z: -162, radius: 10, footOnly: false },
      { name: 'DELIVER TO THE PIER', text: 'Deliver to the pier', x: 400, z: -6, radius: 70, footOnly: false },
    ],
  },
  {
    id: 'M2', name: 'THE HANDOFF', reward: 800, par: 180, xp: 600,
    brief: 'DANTE: "Sana only trusts a face she can see. Get out and walk."',
    stages: [
      { name: 'MEET SANA', text: 'Meet Sana at the stadium — on foot', x: -162, z: 150, radius: 8, footOnly: true },
      { name: 'DROP AT THE MARINA', text: 'Drop the package at the marina', x: 254, z: 98, radius: 10, footOnly: false },
    ],
  },
  {
    id: 'M3', name: 'TAIL THE VAN', reward: 1200, par: 240, xp: 800,
    brief: 'DANTE: "My van runs downtown to the marina. Stay on it. Don\'t be seen losing it."',
    stages: [
      { name: 'FIND DANTE\'S VAN', text: 'Close in on the gold van', vanDist: 40 },
      { name: 'STAY ON IT', text: 'Stay within 80 m of the van', vanDist: 80, loseSeconds: 5 },
    ],
  },
  {
    id: 'M4', name: 'LOSE THE HEAT', reward: 2000, par: 300, xp: 1200, title: 'WHEELMAN',
    brief: 'DANTE: "It\'s a trap. Lose them — then bring it home."',
    stages: [
      { name: 'LOSE THE COPS', text: 'Lose the cordon — wanted back to zero', wantedZero: true },
      { name: 'RUN TO THE PIER', text: 'Run to the pier before the clock dies', x: 400, z: -6, radius: 70, footOnly: false, timeLimit: 120 },
    ],
  },
];

export const RADIO = [
  { name: 'SOL 98.1 — COAST FM', desc: 'Island pop', bpm: 112, root: 220 },
  { name: 'BASS 94.6 — HARBOR', desc: 'Harbor bass', bpm: 96, root: 110 },
  { name: 'LO-FI 88.9 — TIDE', desc: 'Lo-fi lagoon', bpm: 76, root: 164.81 },
];

export const SHELLS = 20;
export const EXPORT_MODELS = ['VELA GT', 'CORTO', 'BRISA', 'MARLIN', 'TIDE RUNNER'];

export const CAR_MODELS = [
  { name: 'VELA GT', color: 0xd94f3d, top: 36 },
  { name: 'CORTO', color: 0x4fc3f7, top: 32 },
  { name: 'BRISA', color: 0xf2c94c, top: 31 },
  { name: 'MARLIN', color: 0x90be6d, top: 33 },
  { name: 'TIDE RUNNER', color: 0xe8e8e8, top: 30 },
];

export const PALETTE = {
  sky: 0x2b7cd3,
  horizon: 0xffc46b,
  fog: 0xefd9b8,
  ground: 0x9c8a6a,
  sand: 0xd9b380,
  sea: 0x1f5f7e,
  asphalt: 0x3a3f46,
  building: [0xe8b48c, 0xd94f3d, 0xe0a83c, 0x7fb3c8, 0x5fb3a3, 0xf5e6c4, 0xd67fa0],
  glass: 0x2c3e50,
  windowLit: 0xffd27a,
  palmTrunk: 0x8a6a4a,
  palmLeaf: 0x4e8a4a,
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const BEST_KEY = 'solmarina.best';
export const SAVE_KEY = 'solmarina.save';
export const MISSION_KEY = 'solmarina.missions';
