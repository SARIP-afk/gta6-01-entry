// Solmarina (fresh build) — staged screenshot scenes. Each one plays the real
// rules forward from a fresh world, steered by an autopilot that drives the
// road grid Manhattan-style toward the objective, so the frame is what short
// play really looks like and the same seed always gives the same frame.
import { STEP } from './sim.js';
import { GRID_MIN, GRID_MAX, ROAD_STEP, MARKET, PIER } from './layout.js';
import { wrapAngle } from './util.js';

const ROADS = [];
for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) ROADS.push(v);
function nearestRoad(v) {
  let best = ROADS[0], bd = Infinity;
  for (const r of ROADS) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = r; } }
  return best;
}
function nextWaypoint(x, z, tx, tz) {
  const rx = nearestRoad(x), rz = nearestRoad(z);
  const onX = Math.abs(x - rx) < 4, onZ = Math.abs(z - rz) < 4;
  const step = (d) => Math.min(ROAD_STEP, Math.abs(d));
  if (onX && onZ) {
    if (Math.abs(tx - x) > 6) return { x: x + Math.sign(tx - x) * step(tx - x), z };
    return { x, z: z + Math.sign(tz - z) * step(tz - z) };
  }
  if (onX) return { x: rx, z: z + Math.sign(tz - z) * step(tz - z) };
  if (onZ) {
    if (Math.abs(tx - x) > 6) return { x: x + Math.sign(tx - x) * step(tx - x), z: rz };
    return { x: rx, z: rz }; // aligned in x: drive to the intersection, then turn
  }
  // off-grid: drive axis-aligned to the nearer road line, never diagonally
  return Math.abs(x - rx) < Math.abs(z - rz) ? { x: rx, z } : { x, z: rz };
}
function driveInput(world, tx, tz) {
  const s = world.state;
  const car = s.heroCar;
  let ex = tx, ez = tz;
  if (tx > GRID_MAX && (car.x < GRID_MAX - 2 || Math.abs(car.z - 24) > 6)) { ex = GRID_MAX; ez = 24; }
  const dist = Math.hypot(tx - car.x, tz - car.z);
  // navigate to the road-aligned target; inside 40 m drive straight at the
  // real target (it may sit mid-block, e.g. a building front). The pier is
  // reached via the causeway at z = 24, not the nearest road line.
  let navTx = nearestRoad(ex), navTz = nearestRoad(ez);
  if (tx > GRID_MAX) { navTx = GRID_MAX; navTz = 24; }
  const wp = dist < 40 ? { x: ex, z: ez } : nextWaypoint(car.x, car.z, navTx, navTz);
  const want = Math.atan2(-(wp.z - car.z), wp.x - car.x);
  const diff = wrapAngle(want - car.heading);
  const wpDist = Math.hypot(wp.x - car.x, wp.z - car.z);
  return {
    moveX: 0, moveZ: 0, steer: Math.max(-1, Math.min(1, diff * 1.6)),
    throttle: Math.abs(diff) > 1.4 ? 0.25 : dist < 12 ? 0.4 : 0.6,
    brake: (dist < 8 && Math.abs(car.speed) > 6) || (wpDist < 18 && Math.abs(diff) > 0.4 && Math.abs(car.speed) > 8),
    boost: false, enter: false, reload: false, shootAngle: null,
  };
}
function walkInput(world, tx, tz) {
  const s = world.state;
  const p = s.player;
  const d = Math.hypot(tx - p.x, tz - p.z);
  if (d < 1.5) return { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null };
  return { moveX: (tx - p.x) / d, moveZ: (tz - p.z) / d, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null };
}
function autopilot(world) {
  const s = world.state;
  if (s.player.mode === 'car') return driveInput(world, s.objective.x, s.objective.z);
  return walkInput(world, s.heroCar.x, s.heroCar.z);
}
function stepFor(world, seconds, inputFn) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) world.step(STEP, inputFn ? inputFn(world) : autopilot(world));
}

/** Stage a scene; returns the screen the HUD should draw over it. */
export function stageShot(name, world, renderer) {
  world.reset(1);
  const s = world.state;
  s.screen = 'play';
  const cam = (x, y, z, lx, ly, lz) => renderer.setCamOverride(
    { x, y, z }, { x: lx, y: ly, z: lz },
  );
  if (name === 'cover') {
    // Sunset chase on the coast road (ref 3): hero westbound toward the
    // sun over the sea, skyline right, palms lining the road, heli big
    // ahead-left over the water — the cover is the ref-3 composition.
    world.pinClock(18.0);
    s.missions.active = 3; s.missions.stage = 0; s.missions.started = true;
    s.missions.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.dialogTimer = 9;
    s.objective = { x: -72, z: 48, label: 'Lose the cordon — get CLEAR' };
    s.player.mode = 'car';
    s.heroCar.x = 0; s.heroCar.z = 240; s.heroCar.heading = Math.PI; s.heroCar.speed = 16;
    s.player.x = 0; s.player.z = 240; s.player.heading = Math.PI;
    s.wanted = 3; s.heli.active = true; s.heli.staged = true; s.heli.x = -22; s.heli.z = 250; s.heli.alt = 14; s.heli.angle = 0.6;
    for (let i = 0; i < 3; i++) {
      s.police.push({ x: 20 + i * 12, z: (i % 2 ? 236 : 244), heading: Math.PI, speed: 14, search: 0, siren: i });
    }
    stepFor(world, 2, () => driveInput(world, -120, 240));
    s.heroCar.x = 0; s.heroCar.z = 240; s.heroCar.heading = Math.PI; s.heroCar.speed = 16;
    s.player.x = 0; s.player.z = 240;
    // the sim only flies the heli at wanted 4+ and orbits it at alt ~48 —
    // the staged flag freezes it where put, so the cover keeps a BIG heli
    // ahead-left over the sea, in frame (v2.4: the v2.3 cover had no heli
    // at all — the sim deactivated it at wanted 3 every step)
    s.heli.active = true; s.heli.staged = true; s.heli.x = -22; s.heli.z = 250; s.heli.alt = 14; s.heli.angle = 0.6;
    cam(10, 4.2, 243, -70, 2.5, 236);
    return 'play';
  }
  if (name === 'start') {
    world.pinClock(17.5);
    s.player.mode = 'walk';
    s.player.x = -48; s.player.z = 52; s.player.heading = Math.PI / 2;
    s.heroCar.x = -48; s.heroCar.z = 42;
    cam(-48, 4.5, 62, -48, 1.5, 10);
    return 'play';
  }
  if (name === 'play') {
    world.pinClock(17.5);
    stepFor(world, 20);
    renderer.setCamOverride(null);
    renderer.snapFollow();
    return 'play';
  }
  if (name === 'end') {
    world.pinClock(18.6);
    s.missions.active = 3; s.missions.stage = 1; s.missions.started = true;
    s.missions.dialog = { speaker: 'DANTE', line: 'Pier run — 120 seconds. Go, Rio.' };
    s.missions.dialogTimer = 9;
    s.objective = { x: PIER.x, z: PIER.z, label: 'Run the pier in 120 seconds' };
    s.player.mode = 'car';
    s.heroCar.x = 300; s.heroCar.z = 24; s.heroCar.heading = 0; s.heroCar.speed = 0;
    s.player.x = 300; s.player.z = 24;
    s.wanted = 0;
    stepFor(world, 4, () => driveInput(world, PIER.x, PIER.z));
    s.heroCar.x = 330; s.heroCar.z = 24; s.heroCar.heading = 0;
    cam(306, 5.5, 40, 384, 2, 24);
    return 'play';
  }
  if (name === 'market') {
    world.pinClock(17.5);
    s.player.mode = 'walk';
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 20; s.player.heading = Math.PI / 2;
    stepFor(world, 3, () => walkInput(world, MARKET.x, MARKET.z));
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 16; s.player.heading = Math.PI / 2;
    // camera shifted east + look west so the hero sits at the left third,
    // not dead-centre with his back to the lens blocking the stalls (v2.4)
    cam(MARKET.x - 2, 3.2, MARKET.z + 22, MARKET.x - 8, 2, MARKET.z - 12);
    return 'play';
  }
  if (name === 'nightmarket') {
    world.pinClock(21.5);
    s.player.mode = 'walk';
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 20; s.player.heading = Math.PI / 2;
    stepFor(world, 3, () => walkInput(world, MARKET.x, MARKET.z));
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 16; s.player.heading = Math.PI / 2;
    // same off-centre hero as the day market (v2.4)
    cam(MARKET.x - 2, 3.2, MARKET.z + 22, MARKET.x - 8, 2, MARKET.z - 12);
    return 'play';
  }
  if (name === 'beach') {
    // sunset on the sand (ref 4): hero on foot ON the sand among the
    // northern umbrella row, camera just east of him looking
    // west-southwest — sun + lighthouse + sea at the left, umbrellas +
    // towels + beachgoers big in the foreground, sand underfoot. The
    // z = 288 road runs parallel to any westward view, so the trick is
    // distance: from the northern strip (camera z = 260) the road is
    // 22 m+ away and reads as a midground band, while the southern
    // strip (v2.2, camera z = 300) put the lens 12 m from it and the
    // road filled half the frame; the first try (hero z = 284) stood
    // ON the road itself.
    world.pinClock(18.2);
    s.player.mode = 'walk';
    s.player.x = -17; s.player.z = 266; s.player.heading = -2.7;
    s.heroCar.x = 24; s.heroCar.z = 234; s.heroCar.heading = -Math.PI / 2;
    // beachgoers on the sand: reposition 5 seeded peds to fixed spots
    // WEST of the hero (deterministic literals, slow stroll west along
    // the beach) so no bystander upstages him — the hero at 23 m is the
    // biggest figure in frame
    const goers = [
      [-48, 270, Math.PI, 0.5],
      [-58, 262, Math.PI, 0.6],
      [-64, 272, Math.PI, 0.4],
      [-40, 276, Math.PI, 0.5],
      [-70, 266, Math.PI, 0.6],
    ];
    goers.forEach(([x, z, h, sp], i) => {
      const pd = s.peds[i];
      pd.x = x; pd.z = z; pd.heading = h; pd.speed = sp; pd.alive = true;
    });
    stepFor(world, 3, () => walkInput(world, -17, 266));
    s.player.x = -17; s.player.z = 266; s.player.heading = -2.7;
    // v2.4: camera closer + lower (9.8 m from the hero, was 13.5 m) so the
    // hero reads at thumbnail size; sun + lighthouse stay left of frame
    cam(-8, 4.2, 262, -75, 2, 280);
    return 'play';
  }
  if (name === 'chase') {
    // coastal sunset chase (ref 3): westbound on the beach road at 18:00,
    // sun low ahead-left over the sea, skyline right, palms lining the
    // road, heli ahead over the water, police closing from behind
    world.pinClock(18.0);
    s.player.mode = 'car';
    s.heroCar.x = -40; s.heroCar.z = 240; s.heroCar.heading = Math.PI; s.heroCar.speed = 18;
    s.player.x = -40; s.player.z = 240;
    s.wanted = 4; s.heli.active = true; s.heli.staged = true; s.heli.x = -54; s.heli.z = 247; s.heli.alt = 13;
    for (let i = 0; i < 4; i++) {
      s.police.push({ x: -24 + i * 10, z: (i % 2 ? 236 : 244), heading: Math.PI, speed: 16, search: 0, siren: i });
    }
    stepFor(world, 3, () => driveInput(world, -200, 240));
    s.heroCar.x = -40; s.heroCar.z = 240; s.heroCar.heading = Math.PI;
    // heli big ahead-left over the sea, frozen by the staged flag — the
    // v2.3 orbit put it at alt ~48, a small speck clipped at the frame edge;
    // v2.4 first try (-48, 248, 12) was 22 m out and the rotor disc clipped
    // the top edge, so it sits 28 m out now
    s.heli.active = true; s.heli.staged = true; s.heli.x = -54; s.heli.z = 247; s.heli.alt = 13;
    cam(-28, 4.6, 242, -95, 2, 238);
    return 'play';
  }
  // default: plain play
  world.pinClock(17.5);
  stepFor(world, 10);
  renderer.setCamOverride(null);
  return 'play';
}
