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
    // Sunset, M4, wanted 3, heli up — staged on the beach road looking north
    // up the boulevard: towers left, beach and sea right, sun setting over it.
    world.pinClock(18.4);
    s.missions.active = 3; s.missions.stage = 0; s.missions.started = true;
    s.missions.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.dialogTimer = 9;
    s.objective = { x: -72, z: 48, label: 'Lose the cordon — get CLEAR' };
    s.player.mode = 'car';
    s.heroCar.x = 0; s.heroCar.z = 240; s.heroCar.heading = Math.PI / 2; s.heroCar.speed = 0;
    s.player.x = 0; s.player.z = 240; s.player.heading = Math.PI / 2;
    s.wanted = 3; s.heli.active = true; s.heli.x = 20; s.heli.z = 180; s.heli.alt = 52; s.heli.angle = 0.6;
    for (let i = 0; i < 3; i++) {
      s.police.push({ x: 0, z: 268 + i * 10, heading: Math.PI / 2, speed: 12, search: 0, siren: i });
    }
    stepFor(world, 2, () => driveInput(world, 0, 96));
    s.heroCar.x = 0; s.heroCar.z = 228; s.heroCar.heading = Math.PI / 2;
    s.player.x = 0; s.player.z = 228;
    // the sim only flies the heli at wanted 4+; the cover stages it anyway —
    // close and low so it reads as a machine, not a speck
    s.heli.active = true; s.heli.x = 12; s.heli.z = 198; s.heli.alt = 22; s.heli.angle = 0.6;
    cam(0, 7, 252, 0, 2, 150);
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
    cam(MARKET.x - 6, 3.2, MARKET.z + 22, MARKET.x, 2, MARKET.z - 12);
    return 'play';
  }
  if (name === 'nightmarket') {
    world.pinClock(21.5);
    s.player.mode = 'walk';
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 20; s.player.heading = Math.PI / 2;
    stepFor(world, 3, () => walkInput(world, MARKET.x, MARKET.z));
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 16; s.player.heading = Math.PI / 2;
    cam(MARKET.x - 6, 3.2, MARKET.z + 22, MARKET.x, 2, MARKET.z - 12);
    return 'play';
  }
  if (name === 'beach') {
    // promenade, camera behind the hero facing the sand and the sea
    world.pinClock(16.0);
    s.player.mode = 'walk';
    s.player.x = 24; s.player.z = 240; s.player.heading = -Math.PI / 2;
    s.heroCar.x = 24; s.heroCar.z = 234; s.heroCar.heading = -Math.PI / 2;
    stepFor(world, 3, () => walkInput(world, 24, 262));
    s.player.x = 24; s.player.z = 246; s.player.heading = -Math.PI / 2;
    cam(24, 5, 230, 24, 1.5, 300);
    return 'play';
  }
  if (name === 'chase') {
    world.pinClock(16.0);
    s.player.mode = 'car';
    s.heroCar.x = -96; s.heroCar.z = 0; s.heroCar.heading = 0; s.heroCar.speed = 18;
    s.player.x = -96; s.player.z = 0;
    s.wanted = 4; s.heli.active = true; s.heli.x = -70; s.heli.z = -24; s.heli.alt = 50;
    for (let i = 0; i < 4; i++) {
      s.police.push({ x: -96 - 16 - i * 10, z: (i % 2 ? 4 : -4), heading: 0, speed: 16, search: 0, siren: i });
    }
    stepFor(world, 3, () => driveInput(world, 120, 0));
    s.heroCar.x = -40; s.heroCar.z = 0; s.heroCar.heading = 0;
    // heli over the road ahead of the hero, inside the frame
    s.heli.active = true; s.heli.x = -14; s.heli.z = 0; s.heli.alt = 26;
    cam(-78, 7, -4, -10, 2, 0);
    return 'play';
  }
  // default: plain play
  world.pinClock(17.5);
  stepFor(world, 10);
  renderer.setCamOverride(null);
  return 'play';
}
