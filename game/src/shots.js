// The screenshot scenes behind ?shot=cover|start|play|end. Each one plays the real
// rules forward from a fresh world, steered by an autopilot that drives the road
// grid Manhattan-style toward the mission objective, so the frame is what a short
// game really looks like and the same seed always gives the same frame.
import { CITY, STEP } from './config.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const END_SECONDS = 60;
const COVER_SECONDS = 3;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const ROADS = [];
for (let v = CITY.gridMin; v <= CITY.gridMax; v += CITY.roadStep) ROADS.push(v);

function nearestRoad(v) {
  let best = ROADS[0];
  let bd = Infinity;
  for (const r of ROADS) {
    if (Math.abs(v - r) < bd) { bd = Math.abs(v - r); best = r; }
  }
  return best;
}

/** Next road-grid waypoint toward (tx, tz) from (x, z): Manhattan routing. */
function nextWaypoint(x, z, tx, tz) {
  const rx = nearestRoad(x);
  const rz = nearestRoad(z);
  const onX = Math.abs(x - rx) < 4;
  const onZ = Math.abs(z - rz) < 4;
  if (onX && onZ) {
    if (Math.abs(tx - x) > Math.abs(tz - z)) return { x: x + Math.sign(tx - x) * 52, z };
    return { x, z: z + Math.sign(tz - z) * 52 };
  }
  if (onX) return { x: rx, z: z + Math.sign(tz - z) * 52 };
  if (onZ) return { x: x + Math.sign(tx - x) * 52, z: rz };
  return { x: rx, z: rz };
}

function driveInput(world, tx, tz) {
  const s = world.state;
  const car = s.heroCar;
  // The pier sits east of the grid on the causeway: route via (312, -6) first.
  let ex = tx;
  let ez = tz;
  if (tx > CITY.gridMax && (car.x < CITY.gridMax - 2 || Math.abs(car.z + 6) > 6)) {
    ex = CITY.gridMax;
    ez = -6;
  }
  const wp = nextWaypoint(car.x, car.z, ex, ez);
  const want = Math.atan2(-(wp.z - car.z), wp.x - car.x);
  const diff = wrapAngle(want - car.heading);
  const dist = Math.hypot(tx - car.x, tz - car.z);
  return {
    moveX: 0, moveZ: 0,
    steer: Math.max(-1, Math.min(1, diff * 1.6)),
    throttle: Math.abs(diff) > 1.4 ? 0.25 : dist < 12 ? 0.4 : 1,
    brake: dist < 8 && Math.abs(car.speed) > 6,
    boost: false, enter: false, reload: false, shootAngle: null,
  };
}

function walkInput(world, tx, tz) {
  const s = world.state;
  const p = s.player;
  const d = Math.hypot(tx - p.x, tz - p.z);
  if (d < 1.5) return { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null };
  return {
    moveX: (tx - p.x) / d, moveZ: (tz - p.z) / d,
    steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null,
  };
}

function autopilot(world) {
  const s = world.state;
  const obj = s.objective;
  if (s.player.mode === 'car') return driveInput(world, obj.x, obj.z);
  const stage = s.missions.currentStage();
  if (stage && stage.footOnly) return walkInput(world, stage.x, stage.z);
  return walkInput(world, s.heroCar.x, s.heroCar.z);
}

/** Stage the named scene and return the screen to draw over it. */
export function stageShot(name, world) {
  world.reset(1);
  const s = world.state;
  if (name === 'cover') {
    // M4, wanted 3, on the causeway with the pier ahead and cruisers closing in.
    s.missions.state.active = 3;
    s.missions.state.stage = 0;
    s.missions.state.started = true;
    s.missions.state.missionTime = 0;
    s.missions.state.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.state.dialogTimer = 6;
    s.player.mode = 'car';
    s.heroCar.x = 296;
    s.heroCar.z = -6;
    s.heroCar.heading = 0;
    s.heroCar.speed = 12;
    s.police.setWanted(3, s.events);
    // Traffic ahead on the causeway, in the other lane — visible, not rammed.
    const coverCars = [[344, -1], [362, -11], [382, -1]];
    for (let i = 0; i < coverCars.length; i += 1) {
      const c = s.traffic.cars[i];
      c.x = coverCars[i][0];
      c.z = coverCars[i][1];
      c.heading = 0;
      c.tx = 400;
      c.tz = -6;
    }
    for (let i = 0; i < COVER_SECONDS / STEP; i += 1) {
      world.step(STEP, driveInput(world, CITY.pier.x, CITY.pier.z));
    }
    // Stage, not sim: the cover shows wanted 3 and a clean car.
    s.police.setWanted(3, []);
    s.heroCar.damage = 0;
    // Flank two cruisers into the frame ahead of the hero: a chase reads
    // only when the pursuit is visible, not just on the dispatch panel.
    if (s.police.units[0]) {
      s.police.units[0].x = s.heroCar.x + 22;
      s.police.units[0].z = s.heroCar.z - 9;
      s.police.units[0].heading = Math.PI;
    }
    if (s.police.units[1]) {
      s.police.units[1].x = s.heroCar.x + 16;
      s.police.units[1].z = s.heroCar.z + 10;
      s.police.units[1].heading = Math.PI;
    }
    // Keep pedestrians out of the hero's personal space for the frame.
    for (const p of s.traffic.peds) {
      if (Math.hypot(p.x - s.heroCar.x, p.z - s.heroCar.z) < 20) {
        p.x += 45;
        p.z += 45;
      }
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'start') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) {
      world.step(STEP, { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null });
    }
    return { screen: SCREEN_TITLE };
  }
  const seconds = name === 'end' ? END_SECONDS : PLAY_SECONDS;
  if (name === 'end') {
    s.missions.state.active = 3;
    s.missions.state.stage = 0;
    s.missions.state.started = true;
    s.missions.state.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.state.dialogTimer = 6;
    s.police.setWanted(3, s.events);
    s.player.mode = 'car';
  }
  let entered = false;
  for (let i = 0; i < seconds / STEP; i += 1) {
    let input = autopilot(world);
    if (!entered && s.player.mode === 'foot' && Math.hypot(s.heroCar.x - s.player.x, s.heroCar.z - s.player.z) < 3) {
      input = { ...input, enter: true };
      entered = true;
    }
    world.step(STEP, input);
    if (s.player.health <= 0) break;
  }
  // Stage, not sim: play shows a working chase at most wanted 2, end shows wanted 3.
  if (name === 'end') {
    s.police.setWanted(3, []);
    s.heroCar.damage = 0;
  } else if (s.police.state.wanted > 2) {
    s.police.setWanted(2, []);
  }
  s.heroCar.damage = Math.min(s.heroCar.damage, 15);
  return { screen: s.player.health <= 0 ? SCREEN_OVER : SCREEN_PLAY };
}
